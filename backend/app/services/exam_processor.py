"""
app/services/exam_processor.py
───────────────────────────────
Token-efficient pipeline for processing an uploaded exam.

Three independent passes — each cached so the work isn't repeated:

  1. extract_questions(text)
       ONE Gemini call per exam. Returns a list of
       {number, text, page, has_solution_inline, solution_text} dicts.
       This is the only "read the whole exam" pass; everything downstream
       operates on the structured output.

  2. tag_question(question, course)
       ONE small Gemini call per question. The system prompt only carries
       the existing per-course topic + question-type lists (string ids), so
       the prompt stays under ~1k tokens regardless of exam size. The
       tagger is allowed to invent NEW topic / question-type names when
       nothing fits — those are upserted into course_topics /
       course_question_types and become part of the taxonomy for the next
       exam tagged.
       Output also carries an AI-written reference_solution used by the
       Take/Grade flow in Phase 3.

  3. compute_difficulty_scores(course_id)
       NO LLM calls. For each question type that has questions in the
       course, compute the centroid of question embeddings and grade each
       question by its distance from that centroid (lonelier → harder).
       Normalized 0..1 within the type. Cheap, deterministic, improves as
       more exams arrive.

Embeddings for new questions are produced via Gemini text-embedding-004
(same model that powers RAG). One batch call per exam.
"""

from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.models.domain import (
    Course,
    CourseLecturer,
    CourseQuestionType,
    CourseTopic,
    Exam,
    ExamQuestion,
)
from app.services.llm_json import LLMJsonError, call_llm_for_json

log = logging.getLogger(__name__)

# Per-exam cap on concurrent Gemini calls during tagging. Five is a deliberate
# trade-off: high enough to make 25-question exams take ~10s instead of ~50s,
# low enough to leave headroom for other concurrent uploads on the same
# Gemini quota.
_TAG_PARALLELISM = 5


# ══════════════════════════════════════════════════════════════════════════
# Pass 1 — extract questions from raw exam text
# ══════════════════════════════════════════════════════════════════════════

_EXTRACTION_PROMPT = """\
You are an exam parser. Extract every question from the following past paper.
Return ONLY a valid JSON array — no markdown fences, no prose. Each element:

{{
  "number":               string,   // e.g. "1", "1a", "2"
  "text":                 string,   // the question itself
  "page":                 integer,  // page where the question starts
  "has_solution_inline":  boolean,  // true if the source already has a solution beneath it
  "solution_text":        string|null  // the existing solution if present, otherwise null
}}

Rules
─────
• Return EVERY question, in source order. Do not summarize, paraphrase, or skip.
• Subquestions that share a stem (e.g. "1a", "1b") are returned as separate
  rows; copy the shared stem into each one.
• If the exam only contains questions without solutions, set
  has_solution_inline=false and solution_text=null for every row.
• Keep formulas and code verbatim — including LaTeX.
• Hebrew text is supported. Return values in the source language.

Exam text
─────────
{text}
"""


def extract_questions(text: str) -> list[dict[str, Any]]:
    """Run Gemini in JSON mode to break an exam PDF into structured questions.

    Routes through `services.llm_json.call_llm_for_json`, which enforces:
      • Native JSON output (`ask_gemini_json` sets `response_mime_type`).
      • Up to 3 retries with stricter "JSON only" reminders on failure.
      • Type validation (we expect a `list`).

    Raises `LLMJsonError` if every attempt fails — the router translates
    that into a user-friendly 502 with `services.llm_json.user_message_for`.
    """
    if not text or not text.strip():
        return []

    # Lazy import — see syllabus_extractor for the same circular-import note.
    from app.services.document_service import ask_gemini_json

    # Same length cap as syllabus extractor — keeps cost predictable; longer
    # exams are rare and can be split client-side if needed.
    capped = text[:20_000]
    base_prompt = _EXTRACTION_PROMPT.format(text=capped)

    parsed = call_llm_for_json(
        llm_call=lambda p: ask_gemini_json(p, use_smart_model=True),
        base_prompt=base_prompt,
        max_attempts=3,
        expected_type=list,
        label="exam_extract_questions",
    )

    out: list[dict[str, Any]] = []
    for q in parsed:
        if not isinstance(q, dict):
            continue
        number = str(q.get("number", "")).strip()
        body   = str(q.get("text", "")).strip()
        if not number or not body:
            continue
        out.append({
            "number":              number,
            "text":                body,
            "page":                int(q.get("page", 0) or 0) or None,
            "has_solution_inline": bool(q.get("has_solution_inline", False)),
            "solution_text":       q.get("solution_text") or None,
        })
    return out


# ══════════════════════════════════════════════════════════════════════════
# Pass 2 — tag each question with topic(s) and a question type
# ══════════════════════════════════════════════════════════════════════════

_TAGGING_PROMPT = """\
You are a course-aware question tagger. Tag every question along TWO
INDEPENDENT axes — they must NEVER be merged or cross-contaminated.

──────────── Axis 1: TOPICS (subject matter) ────────────
What is the question ABOUT — which course concepts must one know to solve it?
Topics are nouns naming mathematical / scientific / domain ideas.
Examples (illustrative — use whatever fits this course):
  • "Hall's theorem"            • "Eigenvalues"
  • "Differential equations"    • "Bayesian inference"
  • "Graph coloring"            • "Lambda calculus"
  • "Linked lists"              • "RSA encryption"

──────────── Axis 2: QUESTION TYPE (response format) ────────────
What KIND of answer is expected — what response shape does the question demand?
Question types are nouns naming a question FORMAT, not subject matter.
Examples (illustrative):
  • "Proof"                     • "Multiple Choice"
  • "True / False"              • "Calculation"
  • "Open-ended explanation"    • "Counterexample request"
  • "Code completion"           • "Diagram drawing"
  • "Fill in the blank"         • "Short answer"

Available topics for this course
────────────────────────────────
{topics_block}

Available question types for this course
────────────────────────────────────────
{types_block}

Course context
──────────────
{course_context}

Question text
─────────────
{question}

{solution_block}

Return ONLY a valid JSON object — no markdown fences, no prose:

{{
  "topic_ids":          array of int,    // ids from the topics list above
  "topic_new":          array of str,    // 1-3 word topic names not in the list
  "question_type_id":   int | null,      // id from the question types list
  "question_type_new":  str | null,      // a NEW question-type name (only if nothing fits)
  "reference_solution": str              // the model's correct answer for this question
}}

HARD RULES — IMPORTANT
══════════════════════
1. NEVER put a question-type name (Proof / Multiple Choice / True-False /
   Calculation / etc.) into `topic_new` or `topic_ids`. These belong in
   `question_type_*` only.
2. NEVER put a topic name (Linear Algebra / Hall's theorem / etc.) into
   `question_type_new` or `question_type_id`. These belong in `topic_*` only.
3. Tag topics from BOTH the question and (when provided) its solution.
   If the solution uses a specific theorem or construction that the
   question doesn't name explicitly, that theorem IS a topic — tag it.
4. When no solution is provided, mentally sketch one before tagging.
   Tag every concept that sketch would invoke.
5. Prefer existing ids over new names. Add a new name only when the
   existing list genuinely lacks a match — duplicates pollute the
   taxonomy.
6. `topic_ids` + `topic_new` together must contain at least one entry.
7. `reference_solution` is required, must match the question's language,
   and must preserve LaTeX / code blocks verbatim. It will be shown to
   students later — write it as if for them.
"""


@dataclass(frozen=True)
class CourseSnapshot:
    """Read-only view of a course's tagging-relevant state.

    Captured BEFORE spawning tagging worker threads so worker code never
    touches the SQLAlchemy session (sessions are not thread-safe).
    The main thread then applies the workers' decisions to the DB after
    they all return.
    """
    title:          str
    course_code:    str | None
    institution:    str | None
    topic_pairs:    tuple[tuple[int, str], ...]   # (id, name)
    type_pairs:     tuple[tuple[int, str], ...]   # (id, name)


def _topics_block_from_pairs(pairs: tuple[tuple[int, str], ...]) -> str:
    if not pairs:
        return "(none yet)"
    return "\n".join(f"- {tid}: {name}" for tid, name in pairs)


def _types_block_from_pairs(pairs: tuple[tuple[int, str], ...]) -> str:
    if not pairs:
        return "(none yet)"
    return "\n".join(f"- {qid}: {name}" for qid, name in pairs)


def _course_context_block_from_snapshot(snapshot: CourseSnapshot) -> str:
    """Compact course header so the tagger knows the subject without bloat."""
    bits: list[str] = [f"Course: {snapshot.title}"]
    if snapshot.course_code:
        bits.append(f"Code: {snapshot.course_code}")
    if snapshot.institution:
        bits.append(snapshot.institution)
    return " · ".join(bits)


def _snapshot_course(course: Course) -> CourseSnapshot:
    extracted = course.syllabus_extracted or {}
    return CourseSnapshot(
        title=course.title,
        course_code=extracted.get("course_code"),
        institution=extracted.get("institution"),
        topic_pairs=tuple((t.id, t.name) for t in course.topics),
        type_pairs=tuple((qt.id, qt.name) for qt in course.question_types),
    )


def tag_question_pure(
    question_text: str,
    snapshot: CourseSnapshot,
    *,
    solution_text: str | None = None,
) -> dict[str, Any]:
    """Thread-safe tagger. Performs ONE Gemini call; touches NO database.

    `solution_text` is the inline solution the source PDF carried for this
    question, when available. Passing it lets the tagger pick up topics
    that the question text doesn't mention by name (e.g. the question
    asks "show this graph has a perfect matching", solution invokes
    Hall's theorem — without the solution, the model might miss "Hall's
    theorem" as a topic).

    Returns the model's raw decisions in a serialisable shape:

      {
        "topic_ids_existing": list[int],   ids picked from the snapshot
        "topic_names_new":    list[str],   names not present in the snapshot
        "type_id_existing":   int | None,
        "type_name_new":      str | None,
        "reference_solution": str,
      }

    The CALLER (running on the main thread, holding the DB session) is
    responsible for resolving these into final IDs and upserting any new
    topic / question-type rows. That sequencing keeps SQLAlchemy session
    access single-threaded, which is the only thread-safety story the ORM
    actually offers.
    """
    from app.services.document_service import ask_gemini_json

    # Solution block: only inject when we actually have one; otherwise the
    # prompt's rule-4 ("mentally sketch one before tagging") kicks in.
    if solution_text and solution_text.strip():
        solution_block = (
            "Solution from the source\n"
            "────────────────────────\n"
            f"{solution_text[:2_000]}"
        )
    else:
        solution_block = ""   # rule 4 in the prompt handles this case

    base_prompt = _TAGGING_PROMPT.format(
        topics_block=_topics_block_from_pairs(snapshot.topic_pairs),
        types_block=_types_block_from_pairs(snapshot.type_pairs),
        course_context=_course_context_block_from_snapshot(snapshot),
        question=question_text[:2_000],   # cap so tagging stays cheap
        solution_block=solution_block,
    )

    try:
        parsed = call_llm_for_json(
            llm_call=lambda p: ask_gemini_json(p, use_smart_model=False),
            base_prompt=base_prompt,
            max_attempts=2,
            expected_type=dict,
            label="exam_tag_question",
        )
    except LLMJsonError:
        # Single-question failure is non-fatal — return empty tags so the
        # main thread can still persist the question without metadata.
        return {
            "topic_ids_existing": [],
            "topic_names_new":    [],
            "type_id_existing":   None,
            "type_name_new":      None,
            "reference_solution": "",
        }

    # Filter against the snapshot: ids the model invents that aren't in the
    # snapshot are dropped, names go through the "new" path instead.
    existing_topic_ids = {tid for tid, _ in snapshot.topic_pairs}
    chosen_topic_ids: list[int] = [
        int(i) for i in (parsed.get("topic_ids") or [])
        if isinstance(i, int) and i in existing_topic_ids
    ]

    new_topic_names: list[str] = []
    for new_name in (parsed.get("topic_new") or []):
        nm = str(new_name).strip()
        if nm:
            new_topic_names.append(nm)

    qt_id_raw = parsed.get("question_type_id")
    type_id_existing: int | None = None
    if isinstance(qt_id_raw, int) and any(qid == qt_id_raw for qid, _ in snapshot.type_pairs):
        type_id_existing = qt_id_raw

    type_name_new: str | None = None
    if type_id_existing is None:
        raw_new = parsed.get("question_type_new")
        if isinstance(raw_new, str) and raw_new.strip():
            type_name_new = raw_new.strip()

    return {
        "topic_ids_existing": chosen_topic_ids,
        "topic_names_new":    new_topic_names,
        "type_id_existing":   type_id_existing,
        "type_name_new":      type_name_new,
        "reference_solution": str(parsed.get("reference_solution") or ""),
    }


# ══════════════════════════════════════════════════════════════════════════
# Pass 3 — difficulty calibration (no LLM)
# ══════════════════════════════════════════════════════════════════════════

def _cosine_distance(a: list[float], b: list[float]) -> float:
    """1 - cosine_similarity. Both vectors are 768-dim float lists."""
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b):
        dot    += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a == 0 or norm_b == 0:
        return 1.0
    sim = dot / (math.sqrt(norm_a) * math.sqrt(norm_b))
    return max(0.0, 1.0 - sim)


def _vector_to_list(v: Any) -> list[float] | None:
    """pgvector columns come back as numpy arrays / lists; normalize."""
    if v is None:
        return None
    if hasattr(v, "tolist"):
        return list(v.tolist())
    if isinstance(v, list):
        return list(v)
    try:
        return list(v)
    except TypeError:
        return None


def compute_difficulty_scores(course_id: int, db: Session) -> int:
    """
    Recompute `difficulty_score` for every question in the course.

    Algorithm (per question type cluster):
      1. Compute the centroid of all question embeddings of that type.
      2. For each question, distance = cosine_distance(question, centroid).
      3. Normalize within the cluster: difficulty = (d - d_min) / (d_max - d_min).

    Aggregate exam difficulty is the mean of contained-question scores.
    Returns the number of questions that got a fresh score (for telemetry).
    """
    questions: list[ExamQuestion] = (
        db.query(ExamQuestion)
        .join(Exam, ExamQuestion.exam_id == Exam.id)
        .filter(Exam.course_id == course_id)
        .all()
    )
    by_type: dict[int | None, list[ExamQuestion]] = {}
    for q in questions:
        by_type.setdefault(q.question_type_id, []).append(q)

    updated = 0
    for cluster in by_type.values():
        # Vectors that actually exist (skip questions whose embedding failed).
        vecs = [(_vector_to_list(q.embedding), q) for q in cluster]
        valid = [(v, q) for v, q in vecs if v is not None and len(v) > 0]
        if not valid:
            continue

        # Centroid
        dim = len(valid[0][0])
        centroid = [0.0] * dim
        for v, _ in valid:
            for i in range(dim):
                centroid[i] += v[i]
        for i in range(dim):
            centroid[i] /= len(valid)

        distances = [(_cosine_distance(v, centroid), q) for v, q in valid]
        d_values = [d for d, _ in distances]
        d_min, d_max = min(d_values), max(d_values)
        spread = d_max - d_min

        for d, q in distances:
            if spread <= 1e-9:
                # All questions equally close to the centroid — neutral 0.5.
                q.difficulty_score = 0.5
            else:
                q.difficulty_score = (d - d_min) / spread
            updated += 1

    db.flush()

    # ── Aggregate per-exam score ──────────────────────────────────────────
    exams = db.query(Exam).filter(Exam.course_id == course_id).all()
    for exam in exams:
        scored = [q.difficulty_score for q in exam.questions if q.difficulty_score is not None]
        exam.aggregate_difficulty = (sum(scored) / len(scored)) if scored else None

    db.flush()
    return updated


# ══════════════════════════════════════════════════════════════════════════
# Convenience: full pipeline for a freshly-uploaded exam
# ══════════════════════════════════════════════════════════════════════════

def process_exam(
    exam: Exam,
    raw_text: str,
    db: Session,
) -> int:
    """
    End-to-end: extract → embed → tag (in parallel) → persist → calibrate.

    Concurrency model
    ─────────────────
    All Gemini calls are I/O-bound, so we run the per-question tagging step
    in a `ThreadPoolExecutor` (max `_TAG_PARALLELISM` workers). The workers
    are pure functions that take a `CourseSnapshot` and return raw decisions
    — they NEVER touch the SQLAlchemy session, which is single-threaded.
    The main thread aggregates the workers' decisions, upserts new topics
    / question-types into the course taxonomy, and persists ExamQuestion
    rows. This collapses a 25-question exam from ~50 s sequential to ~10 s
    while keeping ORM access safe.

    Returns the number of questions that ended up on the exam.
    Caller commits the session afterwards.
    """
    # Lazy import to avoid pulling document_service into module load order.
    from app.services.document_service import get_embedding_model

    questions_data = extract_questions(raw_text)
    if not questions_data:
        return 0

    course = exam.course

    # ── Step 1: batch embeddings (one provider call) ─────────────────────
    embedding_model = get_embedding_model()
    texts = [q["text"] for q in questions_data]
    vectors = embedding_model.embed_documents(texts)

    # ── Step 2: parallel tagging (LLM calls in threads, no DB access) ───
    snapshot = _snapshot_course(course)
    log.info(
        "[process_exam] starting parallel tagging: exam=%d, questions=%d, workers=%d",
        exam.id, len(questions_data), _TAG_PARALLELISM,
    )

    with ThreadPoolExecutor(max_workers=_TAG_PARALLELISM) as ex:
        # `executor.map` preserves input order, so tag_results aligns with
        # questions_data without needing explicit index tracking. We pass
        # the inline solution_text when it exists so the tagger can read
        # topics out of the answer (Hall's theorem case).
        tag_results = list(ex.map(
            lambda q: tag_question_pure(
                q["text"],
                snapshot,
                solution_text=q.get("solution_text"),
            ),
            questions_data,
        ))

    # ── Step 3: apply tags + persist questions (single-threaded DB writes) ─
    # Newly-introduced topics and question-types are added to running maps
    # so that two workers proposing the same name in the same batch share
    # a single upserted row.
    topic_id_by_name: dict[str, int] = {name: tid for tid, name in snapshot.topic_pairs}
    type_id_by_name:  dict[str, int] = {name: qid for qid, name in snapshot.type_pairs}

    has_any_solution = False
    persisted = 0
    for q_data, vec, tags in zip(questions_data, vectors, tag_results):
        eq = ExamQuestion(
            exam_id=exam.id,
            question_number=q_data["number"],
            question_text=q_data["text"],
            page_number=q_data["page"],
            embedding=vec.tolist() if hasattr(vec, "tolist") else list(vec),
        )
        db.add(eq)
        db.flush()  # need eq.id for the M2M topic insert

        # Resolve topic ids: existing-from-snapshot + names upserted into the
        # course taxonomy on the fly.
        final_topic_ids: list[int] = list(tags["topic_ids_existing"])
        for new_name in tags["topic_names_new"]:
            tid = topic_id_by_name.get(new_name)
            if tid is None:
                new_topic = CourseTopic(
                    course_id=course.id, name=new_name, source="exam_inferred",
                )
                db.add(new_topic)
                db.flush()
                tid = new_topic.id
                topic_id_by_name[new_name] = tid
                course.topics.append(new_topic)
            final_topic_ids.append(tid)

        # Resolve question_type id with the same upsert pattern.
        qt_id: int | None = tags["type_id_existing"]
        if qt_id is None and tags["type_name_new"]:
            type_name = tags["type_name_new"]
            qt_id = type_id_by_name.get(type_name)
            if qt_id is None:
                new_qt = CourseQuestionType(
                    course_id=course.id, name=type_name, source="inferred",
                )
                db.add(new_qt)
                db.flush()
                qt_id = new_qt.id
                type_id_by_name[type_name] = qt_id
                course.question_types.append(new_qt)

        eq.question_type_id   = qt_id
        eq.reference_solution = (
            q_data["solution_text"]
            or tags["reference_solution"]
            or None
        )
        # Attach topics. Topics ORM list `course.topics` is the in-memory
        # collection; we look up by id rather than fetching extra rows.
        for tid in final_topic_ids:
            topic = next((t for t in course.topics if t.id == tid), None)
            if topic is not None:
                eq.topics.append(topic)

        if q_data["has_solution_inline"]:
            has_any_solution = True
        persisted += 1

    # If the source carried solutions, surface that on the Exam row so the
    # Take flow knows whether the companion blank-PDF needs generating.
    if has_any_solution:
        exam.has_solutions = True

    # Update the denormalized cache so the list endpoint can avoid loading
    # questions just to count them.
    exam.question_count = persisted

    # ── Step 4: recalibrate difficulty across the whole course ──────────
    # TODO (T-018): incremental recompute when the course grows past ~50
    # exams; right now we recompute every cluster on every upload.
    compute_difficulty_scores(course.id, db)

    return persisted
