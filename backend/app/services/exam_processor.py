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

import json
import math
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
    """Run a single Gemini call to break an exam PDF into structured questions."""
    if not text or not text.strip():
        return []

    # Lazy import — see syllabus_extractor for the same circular-import note.
    from app.services.document_service import ask_gemini

    # Same length cap as syllabus extractor — keeps cost predictable; longer
    # exams are rare and can be split client-side if needed.
    capped = text[:20_000]

    raw = ask_gemini(
        _EXTRACTION_PROMPT.format(text=capped),
        use_smart_model=True,
    )

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]

    try:
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, IndexError, ValueError) as exc:
        raise ValueError(f"Question extraction returned unparseable JSON: {exc}") from exc

    if not isinstance(parsed, list):
        return []

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
You are a course-aware question tagger. Available topics and question types
for this course are listed below. Choose from them whenever possible; only
introduce a new entry when nothing fits.

Available topics
────────────────
{topics_block}

Available question types
────────────────────────
{types_block}

Course context
──────────────
{course_context}

Question to tag
───────────────
{question}

Return ONLY a valid JSON object — no markdown fences, no prose:

{{
  "topic_ids":          array of int,        // ids picked from the topics list above
  "topic_new":          array of str,        // ONLY topic names that DON'T fit any existing one
  "question_type_id":   int|null,            // id picked from the types list, or null
  "question_type_new":  str|null,            // ONLY when no existing type fits
  "reference_solution": str                  // a model-generated correct answer for this question
}}

Hard rules
──────────
• Prefer existing ids. Add a new name only when the existing list lacks an
  obvious match — never duplicate.
• `topic_ids` and `topic_new` together must contain at least one entry.
• `reference_solution` is required and must be the model's best concise answer
  (used later for grading); preserve LaTeX/code; match the question's language.
"""


def _topics_block(course: Course) -> str:
    if not course.topics:
        return "(none yet)"
    return "\n".join(f"- {t.id}: {t.name}" for t in course.topics)


def _types_block(course: Course) -> str:
    if not course.question_types:
        return "(none yet)"
    return "\n".join(f"- {qt.id}: {qt.name}" for qt in course.question_types)


def _course_context_block(course: Course) -> str:
    """Compact course header so the tagger knows the subject without bloat."""
    bits: list[str] = [f"Course: {course.title}"]
    extracted = course.syllabus_extracted or {}
    if extracted.get("course_code"):
        bits.append(f"Code: {extracted['course_code']}")
    if extracted.get("institution"):
        bits.append(extracted["institution"])
    return " · ".join(bits)


def tag_question(
    question_text: str,
    course: Course,
    db: Session,
) -> dict[str, Any]:
    """
    Tag one question. Upserts new topics / types into the course taxonomy
    when the model returns `topic_new` / `question_type_new`. Returns a dict:

      {
        "topic_ids":          [int, ...],     // resolved (existing + newly created)
        "question_type_id":   int|None,       // resolved
        "reference_solution": str
      }

    The caller writes these onto the ExamQuestion row.
    """
    from app.services.document_service import ask_gemini

    prompt = _TAGGING_PROMPT.format(
        topics_block=_topics_block(course),
        types_block=_types_block(course),
        course_context=_course_context_block(course),
        question=question_text[:2_000],   # cap so tagging stays cheap
    )

    raw = ask_gemini(prompt, use_smart_model=False)

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]

    try:
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, IndexError, ValueError):
        # If the tagger hiccups, return empty tags rather than blowing up
        # the whole upload — the caller can still persist the question.
        return {"topic_ids": [], "question_type_id": None, "reference_solution": ""}

    # ── Resolve topic_ids: keep only ids that actually live in this course ─
    existing_topic_ids = {t.id for t in course.topics}
    chosen_topic_ids: list[int] = [
        int(i) for i in (parsed.get("topic_ids") or [])
        if isinstance(i, int) and i in existing_topic_ids
    ]

    # ── Upsert any newly introduced topics ────────────────────────────────
    for new_name in (parsed.get("topic_new") or []):
        nm = str(new_name).strip()
        if not nm:
            continue
        existing = next((t for t in course.topics if t.name == nm), None)
        if existing:
            chosen_topic_ids.append(existing.id)
            continue
        new_topic = CourseTopic(course_id=course.id, name=nm, source="exam_inferred")
        db.add(new_topic)
        db.flush()  # populate id
        chosen_topic_ids.append(new_topic.id)
        course.topics.append(new_topic)

    # ── Resolve / upsert question type ────────────────────────────────────
    qt_id_raw = parsed.get("question_type_id")
    qt_id: int | None = None
    if isinstance(qt_id_raw, int):
        if any(qt.id == qt_id_raw for qt in course.question_types):
            qt_id = qt_id_raw
    if qt_id is None:
        new_qt_name = (parsed.get("question_type_new") or "").strip() if parsed.get("question_type_new") else ""
        if new_qt_name:
            existing_qt = next(
                (qt for qt in course.question_types if qt.name == new_qt_name),
                None,
            )
            if existing_qt:
                qt_id = existing_qt.id
            else:
                new_qt = CourseQuestionType(
                    course_id=course.id, name=new_qt_name, source="inferred",
                )
                db.add(new_qt)
                db.flush()
                qt_id = new_qt.id
                course.question_types.append(new_qt)

    return {
        "topic_ids":           chosen_topic_ids,
        "question_type_id":    qt_id,
        "reference_solution":  str(parsed.get("reference_solution") or ""),
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
    End-to-end: extract → embed → tag → calibrate. Persists everything to
    the DB. Returns the number of questions that ended up on the exam.

    Caller is responsible for committing the session afterwards.
    """
    # Lazy import to avoid pulling document_service into module load order.
    from app.services.document_service import get_embedding_model

    questions_data = extract_questions(raw_text)
    if not questions_data:
        return 0

    course = exam.course

    # Batch-embed every question text in one call — Gemini's
    # langchain wrapper handles the batching internally.
    embedding_model = get_embedding_model()
    texts = [q["text"] for q in questions_data]
    vectors = embedding_model.embed_documents(texts)

    # ── Persist questions, then tag + reference solution per question ────
    has_any_solution = False
    for q_data, vec in zip(questions_data, vectors):
        eq = ExamQuestion(
            exam_id=exam.id,
            question_number=q_data["number"],
            question_text=q_data["text"],
            page_number=q_data["page"],
            embedding=vec.tolist() if hasattr(vec, "tolist") else list(vec),
        )
        db.add(eq)
        db.flush()  # need eq.id for the M2M topic insert

        tags = tag_question(q_data["text"], course, db)
        eq.question_type_id   = tags["question_type_id"]
        eq.reference_solution = (
            q_data["solution_text"]
            or tags["reference_solution"]
            or None
        )
        for tid in tags["topic_ids"]:
            topic = next((t for t in course.topics if t.id == tid), None)
            if topic is not None:
                eq.topics.append(topic)

        if q_data["has_solution_inline"]:
            has_any_solution = True

    # If the source carried solutions, surface that on the Exam row so the
    # Take flow knows whether the companion blank-PDF needs generating.
    if has_any_solution:
        exam.has_solutions = True

    # ── Recalibrate difficulty across the whole course ───────────────────
    compute_difficulty_scores(course.id, db)

    return len(questions_data)
