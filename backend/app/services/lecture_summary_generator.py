"""
app/services/lecture_summary_generator.py
─────────────────────────────────────────
F-033 — generate a unified Hebrew lecture summary from up to six inputs:

   1. lecturer_summary         (authoritative, structural backbone)
   2. recording_transcript     (lecturer's spoken additions)
   3. notes_text               (student's personal notes — signals confusion)
   4. exercises_text           (recitation / workshop problems → worked examples)
   5. homework_text            (homework problems → inline placement)
   6. course_title + lecture_title (header metadata)

The skill prompt below is owned by the product and locked in code on purpose
— treating it as a config string would let it drift between environments
without a code review.

Async lifecycle
───────────────
`process_unified_summary_background(lecture_id, user_id)` is the BG-task
entrypoint. It opens its own DB session (FastAPI BackgroundTask does not
share the request session), runs the generation, and updates the lecture
row with the result, error, or recovery hint. The frontend polls
`GET /lectures/{id}` while `unified_summary_processing` is true.

Failure handling
────────────────
On any failure the column `unified_summary_error` is set with a user-facing
Hebrew message and `unified_summary_processing` flips back to false. We
NEVER wipe a previously-successful `unified_summary` on failure — if a
regenerate goes wrong, the user keeps the last-good version.

Skill source of truth
─────────────────────
The SYSTEM PROMPT and USER PROMPT TEMPLATE below are the canonical
contract with the product owner. Do not edit them piecemeal — they reflect
a careful spec (six inputs, marking conventions, edge cases). Treat them
like a versioned API.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session, selectinload

from app.core.database import SessionLocal
from app.models.domain import (
    BaseDocument, Chunk, Course, Lecture, LectureLecturerSummary, LectureNote,
    UserDocument,
)
from app.services.llm_providers import call_llm_with_usage
from app.services.usage_logger import write_usage_event

log = logging.getLogger(__name__)


# ── Skill prompt (locked) ──────────────────────────────────────────────────
# Triple-quoted r-string so backslashes (LaTeX) survive verbatim. Tokens look
# like {placeholder}; do NOT use `.format()` — we use `replace()` below so a
# stray `{` inside the inputs doesn't trip Python's formatter.

_SYSTEM_PROMPT = r"""You are a study-material synthesizer for a Hebrew-language university course. Your job is to combine multiple inputs about a single lecture into one coherent, pedagogically clear, Markdown document in Hebrew.

You receive up to six inputs:

A manual lecture summary — a written summary the user already has (typically the professor's official lecture notes or a peer's summary). This is the structural backbone of the output.
A recording transcript — a verbatim transcript of the recorded lecture, including filler words, asides, and informal speech. Use it to detect content the lecturer covered orally that does not appear in the manual summary.
Personal notes — handwritten or typed notes the user took during the lecture or recitation. These reveal what the user found confusing or noteworthy.
Recitation exercises — worked problems from the weekly recitation (תרגול) or workshop (סדנא). These illustrate the lecture concepts and should be inserted as worked examples where pedagogically appropriate.
Homework problems — the weekly homework problem set. Each problem must be placed inline within the lecture at the topic where it is most relevant (NOT in a separate appendix).
Lecture title and course title — for headers.

Your output is one unified study document with these properties:

A. Backbone from the manual summary. Follow the section order of the manual summary. Do not invent a new structure. If the manual summary has sections "אנרגיה אגורה → דיפול נקודתי → ארנשו", your output has those sections in that order.

B. Enrichment from the transcript. Anything the lecturer said in the recording that is not in the manual summary, and is non-trivial (not a filler, joke, administrative remark, or repetition), must appear in the output. These additions are marked with a dedicated tag — see "marking" below.

C. Pedagogical rewriting. Every section uses this four-part structure:

מטרת הסעיף — what we are trying to achieve and why it matters in the larger picture of the course.
אינטואיציה — the intuitive story before any math. Analogies, mental pictures, why the result is reasonable.
הסבר — the formal derivation. Every equation is justified in prose. Every Taylor expansion, every coordinate choice, every limit is named explicitly.
שאלת בדיקה — a short self-check question the reader can do in their head or on paper before moving on.

D. Just-in-time mathematical tools. If a section uses a tool that is not assumed prerequisite (gradient in spherical coordinates, Taylor expansion, divergence in differential form, cross product, $(\vec{a}\cdot\nabla)\vec{B}$, surface integrals in spherical coordinates, line-charge field, image-charge method, etc.), explain the tool inline at the point of first use, before applying it. Do not push all tools to a "math background" appendix unless the document is long enough that an opening "math background" section is more efficient.

E. Homework integration. Each homework problem is inserted at the section where it directly applies. If a homework problem mixes two topics, place it at the later of the two, with a brief note referencing the earlier section. Each inserted problem is wrapped in a clearly marked block (see "marking" below) and includes only the problem statement — not the solution.

F. Recitation examples. Treat recitation problems the same way as homework, but mark them as worked examples (they may include the recitation's solution if provided in the input).

G. Personal-notes signals. Where personal notes indicate confusion ("לא הבנתי", question marks, lines underlined), give the corresponding section extra attention and length. Treat these as priorities, not as content to quote verbatim.

H. Marking conventions (these are literal output strings — render them exactly):

For lecturer-said-but-not-in-summary content: wrap the addition in a Markdown blockquote starting with `> 🎙️ **מהמרצה בהרצאה:**` and ending with the source signal `_(מההרצאה המוקלטת)_`. Use this for anything from a one-sentence remark to a full paragraph. If a lecturer-only addition is critical (a definition, a key equation, an alternative derivation), do NOT downgrade it to a side note — include it as a full subsection AND wrap a one-line summary banner at the section's top with `> 🎙️ **תוספת מהמרצה:** <one-line description>`.
For homework problems: use a heading `#### 📝 שיעורי בית — שאלה N` followed by the problem statement.
For recitation problems: `#### 🎓 דוגמה מהתרגול — בעיה N` followed by problem and solution.
For self-check questions: italics, preceded by `**שאלת בדיקה.**`.

I. Style requirements.

Write in Hebrew throughout. Mathematical variable names stay in their conventional Latin/Greek letters.
Use LaTeX inside $...$ for inline math and $$...$$ for display math. Do not use Unicode math symbols like ∇, ∫, ∂; use \nabla, \int, \partial.
Use ## for section headers (one per major topic), ### for subsections, #### for marked blocks (homework, examples).
Prose paragraphs, not bullet-lists, for explanations. Bullets are reserved for genuinely enumerable items (e.g., "the three boundary conditions are:").
Do not include emojis except those specified in the marking conventions above.
Do not refer to yourself or to the synthesis process. The document reads as a standalone study text.

J. Length discipline. A typical lecture should produce 2,500–5,000 words of output. Do not pad. Do not repeat. If a topic in the manual summary is one paragraph and the lecturer added nothing, your section on it is one paragraph plus the four-part structure.

K. Conflict resolution. When the manual summary and the recording disagree on substance (not just style), trust the recording (the lecturer's spoken statement) and add a marked note: `> ⚠️ **אי־התאמה:** הסיכום הכתוב אומר X, אבל בהרצאה המרצה אמר Y. רשמתי את גרסת ההרצאה.`. When sources disagree on minor matters (notation, sign conventions), pick one consistent choice and note it once at the start.

L. Edge cases.

Only manual_summary exists, all others empty → produce a full pedagogical rewrite based purely on the manual summary; the opening פתיח states: "מסמך זה מבוסס על הסיכום הכתוב בלבד; לא סופקו תמלול הרצאה או חומר נוסף."
Only recording_transcript exists, all others empty → use the transcript as the structural backbone, strip filler, four-part structure, no 🎙️ blocks (redundant). Opening פתיח states: "מסמך זה מבוסס על תמלול ההרצאה המוקלטת בלבד; לא סופק סיכום כתוב."
All inputs empty → return a single line: `*שגיאה: לא סופק תוכן הרצאה כלשהו. נדרש לפחות אחד מ־manual_summary או recording_transcript.*`
Notes contain content not in any other source → treat notes as low-priority hints about user confusion, NOT as a source of new content.

Output is Hebrew unconditionally. Mathematical variables, function names, and LaTeX commands remain in Latin/Greek as conventional."""


_USER_PROMPT_TEMPLATE = """כותרת הקורס: {course_title}
כותרת ההרצאה: {lecture_title}

--- סיכום הרצאה ידני (מקור עיקרי, שלד המבנה) ---
{manual_summary}

--- תמלול ההרצאה המוקלטת (מקור לתוספות והשלמות) ---
{recording_transcript}

--- הערות אישיות של הסטודנט (מקור לזיהוי קשיים) ---
{notes_text}

--- בעיות תרגול/סדנא (להוספה כדוגמאות מעובדות) ---
{exercises_text}

--- שאלות שיעורי הבית (לשיבוץ inline בתוך הסעיפים הרלוונטיים) ---
{homework_text}

הפק מסמך לימוד אחיד לפי ההנחיות במערכת."""


# ── Public errors ──────────────────────────────────────────────────────────

class UnifiedSummaryInputError(ValueError):
    """Raised when neither lecturer_summary nor recording_transcript is non-empty.

    This is a 400-class condition — the caller (the router) translates it
    into an HTTP 422 with a friendly message. Carried in `args[0]`.
    """


# ── Prompt assembly ────────────────────────────────────────────────────────

def _placeholder(value: Optional[str]) -> str:
    """Empty placeholders become the literal Hebrew word for "none" so the
    skill's edge-case branches fire on the spec'd cues rather than on empty
    sentinels. The skill ignores explicitly-empty inputs the same way."""
    text = (value or "").strip()
    return text if text else "(אין)"


def _build_user_prompt(
    *,
    course_title:         str,
    lecture_title:        str,
    lecturer_summary:     Optional[str],
    recording_transcript: Optional[str],
    notes_text:           Optional[str],
    exercises_text:       Optional[str],
    homework_text:        Optional[str],
) -> str:
    # `.replace` (not `.format`) so a stray brace inside the inputs can't
    # trip Python's formatter — student notes are wild input.
    out = _USER_PROMPT_TEMPLATE
    out = out.replace("{course_title}",         course_title)
    out = out.replace("{lecture_title}",        lecture_title)
    out = out.replace("{manual_summary}",       _placeholder(lecturer_summary))
    out = out.replace("{recording_transcript}", _placeholder(recording_transcript))
    out = out.replace("{notes_text}",           _placeholder(notes_text))
    out = out.replace("{exercises_text}",       _placeholder(exercises_text))
    out = out.replace("{homework_text}",        _placeholder(homework_text))
    return out


# ── Notes / chunks helpers ─────────────────────────────────────────────────

def _extract_user_doc_text(ud: Optional[UserDocument], db: Session) -> str:
    """Return text content for a single UserDocument (PDF chunks; "" for images)."""
    if not ud or not ud.base_document:
        return ""
    bd = ud.base_document
    if bd.doc_type == "IMAGE":
        # No OCR yet — return empty so the skill's edge-case branches fire.
        return ""
    chunks = (
        db.query(Chunk)
        .filter(Chunk.base_hash == bd.hash_id)
        .order_by(Chunk.chunk_index.asc())
        .all()
    )
    return "\n\n".join(c.text for c in chunks if c.text)


# ── PDF persistence helpers (F-036) ────────────────────────────────────────

_UPLOADS_DIR = "uploads"

# Strip the rendered-summary file name down to something filesystem-safe.
_SAFE_FILENAME_RE = re.compile(r"[^a-zA-Z0-9_\-]")


def _persist_unified_pdf_as_user_document(
    pdf_bytes:     bytes,
    *,
    lecture_title: str,
    user_id:       int,
    db:            Session,
) -> UserDocument:
    """Drop the rendered unified-summary PDF into the CAS pipeline so the
    lecture viewer can open it inside MainWorkspace identically to any
    other library PDF.

    Returns the UserDocument owned by `user_id`. If a previous generation
    produced the same bytes (SHA-256 match) we reuse the BaseDocument and
    just mint a new UserDocument for the caller. Chunking + embedding the
    PDF text is delegated to the existing text-extraction pipeline.
    """
    # Local imports so a missing pdfplumber on module import doesn't kill
    # the rest of the service. These deps are heavy.
    from app.services.document_service import (
        extract_text_from_pdf, get_embedding_model, split_text_into_chunks,
    )

    hash_id = hashlib.sha256(pdf_bytes).hexdigest()

    # Safe filename based on the lecture title so disk listings stay
    # readable; the hash prefix makes collisions impossible.
    safe_stem = _SAFE_FILENAME_RE.sub("_", (lecture_title or "lecture").strip())[:64] or "lecture"
    filename = f"{safe_stem}_unified.pdf"

    base_doc = db.query(BaseDocument).filter(BaseDocument.hash_id == hash_id).first()
    if base_doc:
        # Same bytes already known. Just create the UserDocument link.
        ud = UserDocument(
            user_id=user_id,
            base_hash=hash_id,
            custom_title=filename,
        )
        db.add(ud)
        db.commit()
        db.refresh(ud)
        return ud

    # Brand-new content — write to disk first.
    os.makedirs(_UPLOADS_DIR, exist_ok=True)
    safe_filename = f"{hash_id[:16]}_{filename}"
    file_location = os.path.join(_UPLOADS_DIR, safe_filename)
    with open(file_location, "wb") as fh:
        fh.write(pdf_bytes)

    base_doc = BaseDocument(
        hash_id=hash_id,
        original_filename=filename,
        file_path=file_location,
        source_type="UPLOAD",
        doc_type="GENERAL",
    )
    db.add(base_doc)
    db.flush()

    ud = UserDocument(
        user_id=user_id,
        base_hash=hash_id,
        custom_title=filename,
    )
    db.add(ud)
    db.commit()
    db.refresh(ud)

    # Extract + chunk + embed — best effort; a chunking failure leaves the
    # PDF readable in the viewer but breaks the RAG context for chat. We
    # warn-log instead of raising because the user already has the PDF
    # they wanted.
    try:
        pages_data = extract_text_from_pdf(file_location)
        embedding_model = get_embedding_model()
        chunk_counter = 0
        for page in pages_data:
            page_chunks_text = split_text_into_chunks(page["text"])
            if not page_chunks_text:
                continue
            vectors = embedding_model.embed_documents(page_chunks_text)
            for i, chunk_text in enumerate(page_chunks_text):
                vec = vectors[i].tolist() if hasattr(vectors[i], "tolist") else vectors[i]
                db.add(Chunk(
                    base_hash=hash_id,
                    text=chunk_text,
                    chunk_index=chunk_counter,
                    page_number=page["page_number"],
                    embedding=vec,
                ))
                chunk_counter += 1
        db.commit()
    except Exception:                                       # pragma: no cover
        log.exception("[unified_summary] chunking failed for lecture %s", lecture_title)
        db.rollback()

    return ud


def _collect_notes_text(lec: Lecture, db: Session) -> str:
    """F-034 — concatenate text from every LectureNote attachment.

    Each note's text is prefixed with its title so the skill can tell
    different note sources apart (e.g. "PDF סרוק" vs. "תמונה מהמחברת")."""
    pieces: list[str] = []
    for note in (lec.notes or []):
        if not note.user_doc:
            continue
        text = _extract_user_doc_text(note.user_doc, db)
        if not text.strip():
            continue
        header = note.title or "הערות"
        pieces.append(f"### {header}\n{text}")
    return "\n\n".join(pieces)


# ── Synchronous generator ──────────────────────────────────────────────────

def generate_unified_summary_sync(
    lec:                  Lecture,
    course:               Course,
    db:                   Session,
    *,
    lecturer_summary_id:  Optional[int] = None,
    user_id:              Optional[int] = None,
    model_tier:           str = "pro",
) -> str:
    """Run the skill once and return the markdown. Writes a UsageEvent.

    `lecturer_summary_id` selects WHICH of the lecture's lecturer-summary
    rows feeds the skill as the `manual_summary` placeholder. If None,
    falls back to the only existing summary; raises if there are several.

    Notes_text is now a concatenation of every LectureNote attachment's
    extracted text (PDFs). Image attachments are skipped until OCR ships.
    """
    # ── Resolve the chosen lecturer summary ────────────────────────────────
    summaries: list[LectureLecturerSummary] = list(lec.lecturer_summaries or [])
    if not summaries:
        raise UnifiedSummaryInputError(
            "צריך לפחות סיכום מרצה אחד לפני יצירת הסיכום המאוחד."
        )
    chosen: Optional[LectureLecturerSummary] = None
    if lecturer_summary_id is not None:
        chosen = next((s for s in summaries if s.id == lecturer_summary_id), None)
    elif len(summaries) == 1:
        chosen = summaries[0]
    if chosen is None:
        raise UnifiedSummaryInputError(
            "יש כמה סיכומי מרצה — בחר איזה מהם ישמש כקלט."
        )

    # F-035: summary is a PDF — pull text from its CAS chunks. Image-only
    # PDFs would need OCR (deferred), so a chunk-empty result trips the
    # "content missing" branch below.
    lecturer_summary     = _extract_user_doc_text(chosen.user_doc, db).strip()
    recording_transcript = ""           # Phase 2 will fill from transcribed audio
    notes_text           = _collect_notes_text(lec, db)
    exercises_text       = ""           # no data model concept yet
    homework_text        = ""           # no data model concept yet

    if not lecturer_summary and not recording_transcript:
        raise UnifiedSummaryInputError(
            "הסיכום הנבחר ריק או שלא ניתן לחלץ ממנו טקסט. בדוק שהקובץ הוא PDF "
            "עם טקסט נגיש (לא סריקה בלבד)."
        )

    user_prompt = _build_user_prompt(
        course_title         = course.title or "",
        lecture_title        = lec.title or "",
        lecturer_summary     = lecturer_summary,
        recording_transcript = recording_transcript,
        notes_text           = notes_text,
        exercises_text       = exercises_text,
        homework_text        = homework_text,
    )

    # F-036.6 — user picked Claude Opus 4.7 as the unified-summary model.
    # provider="anthropic" + tier="pro" maps to claude-opus-4-7 via
    # llm_providers._PROVIDER_TIER_MAP. ANTHROPIC_API_KEY is already
    # wired through the deploy workflow.
    reply = call_llm_with_usage(
        provider     = "anthropic",
        model_tier   = model_tier,
        system_prompt = _SYSTEM_PROMPT,
        history      = [{"role": "user", "content": user_prompt}],
    )

    if user_id is not None:
        # model_alias is a free-form 16-char audit label on UsageEvent.
        # The actual cost lookup in `usage_logger._PRICING` uses the
        # raw `reply.model` ("claude-opus-4-7"), not this string.
        write_usage_event(db, user_id, "lecture_unified_summary", reply,
                          model_alias="CLAUDE-OPUS")

    text = (reply.text or "").strip()
    if not text:
        raise RuntimeError("Empty reply from the model — try again in a moment.")
    return text


# ── Async background entrypoint ────────────────────────────────────────────

def process_unified_summary_background(
    lecture_id:          int,
    user_id:             int,
    lecturer_summary_id: Optional[int] = None,
) -> None:
    """FastAPI BackgroundTask entrypoint.

    Opens its own DB session (the request session is closed by the time the
    BG task runs). Flips `unified_summary_processing` true → false around
    the call; persists either `unified_summary` (success) or
    `unified_summary_error` (failure). Last-good `unified_summary` is
    preserved on failure so the user never loses a working summary because
    a regenerate crashed.

    `lecturer_summary_id` (F-034) selects which lecturer summary feeds the
    skill — picked by the caller on the request side and passed through.
    """
    db = SessionLocal()
    try:
        # Eager-load the children the generator needs so this BG task makes
        # the same query the request side would, in one go.
        lec: Optional[Lecture] = (
            db.query(Lecture)
            .options(
                selectinload(Lecture.lecturer_summaries)
                    .selectinload(LectureLecturerSummary.user_doc)
                    .selectinload(UserDocument.base_document),
                selectinload(Lecture.notes).selectinload(LectureNote.user_doc).selectinload(UserDocument.base_document),
            )
            .filter(Lecture.id == lecture_id)
            .first()
        )
        if not lec:
            log.warning("[lecture_summary] lecture %s gone before BG task ran", lecture_id)
            return

        course: Optional[Course] = (
            db.query(Course).filter(Course.id == lec.course_id).first()
        )
        if not course:
            lec.unified_summary_processing = False
            lec.unified_summary_error = "Course missing — cannot generate."
            db.commit()
            return

        try:
            text = generate_unified_summary_sync(
                lec, course, db,
                lecturer_summary_id=lecturer_summary_id,
                user_id=user_id,
            )
            lec.unified_summary              = text
            lec.unified_summary_error        = None
            lec.unified_summary_generated_at = datetime.now(timezone.utc)

            # F-036: render the markdown to a PDF and stash it as a
            # UserDocument so the lecture viewer can open it in
            # MainWorkspace like any other library PDF.
            try:
                from app.services.markdown_to_pdf import render_unified_summary_pdf
                pdf_bytes = render_unified_summary_pdf(
                    text,
                    lecture_title=lec.title or "Lecture summary",
                    course_title=course.title,
                )
                ud = _persist_unified_pdf_as_user_document(
                    pdf_bytes,
                    lecture_title=lec.title or "lecture",
                    user_id=user_id,
                    db=db,
                )
                lec.unified_summary_document_id = ud.id
            except Exception as exc:
                # F-036.5 — surface PDF render failures to the UI instead
                # of swallowing them. Without this, the previous polling
                # loop saw `processing=false` + the OLD document_id still
                # set, and re-opened the prior PDF, making the regenerate
                # look like a no-op. We keep the OLD `unified_summary_doc-
                # ument_id` so the user can still read a prior PDF if one
                # exists, but the error banner tells them generation
                # actually failed at the PDF step.
                log.exception(
                    "[lecture_summary] PDF render/persist failed for lecture %s",
                    lecture_id,
                )
                # Trim long pandoc/xelatex tracebacks so the UI banner
                # stays readable; full trace is in the BG-task log.
                msg = (str(exc) or repr(exc))[:600]
                lec.unified_summary_error = f"ייצור ה-PDF נכשל: {msg}"
        except UnifiedSummaryInputError as exc:
            lec.unified_summary_error = str(exc)
        except Exception:
            log.exception("[lecture_summary] generation failed for lecture %s", lecture_id)
            lec.unified_summary_error = (
                "ייצור הסיכום נכשל. נסה שוב בעוד רגע, או בדוק שהשרת זמין."
            )
        finally:
            lec.unified_summary_processing = False
            db.commit()
    finally:
        db.close()
