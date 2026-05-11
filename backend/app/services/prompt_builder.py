"""
app/services/prompt_builder.py
──────────────────────────────
Resolves the effective system prompt for a chat turn. The prompt is composed
from up to four layers (highest priority first):

  1. Persona system prompt (or manual override / built-in default).
  2. Persisted SessionMemory entries — appended chronologically.
  3. Course context block (when the chat is course-scoped) — built from the
     cached syllabus extraction. See services/syllabus_extractor.py.
  4. Lecture context block (when the chat is lecture-scoped) — built from
     the lecture's cached unified_summary (falling back to lecturer_summary).

Priority for the persona base prompt:
  1. Persona.system_prompt          (rich structured prompt — preferred)
  2. Persona.manual_prompt_override (legacy raw override)
  3. Built-in default               (generic study assistant)
"""

from __future__ import annotations

from sqlalchemy.orm import Session, selectinload

from app.models.domain import (
    Chunk, Course, Lecture, LectureLecturerSummary, Persona, SessionMemory,
    UserDocument,
)
from app.services.syllabus_extractor import build_syllabus_system_block

_DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful and precise AI study assistant. "
    "Answer clearly and concisely. Match the student's language automatically."
)


def resolve_system_prompt(
    persona_id: str | None,
    db: Session,
    *,
    course_id:  int | None = None,
    lecture_id: int | None = None,
) -> str:
    """Return the fully assembled system prompt for a chat turn.

    Safely falls back to the default when:
      - persona_id is None
      - the Persona row does not exist in the DB
      - both system_prompt and manual_prompt_override are empty

    `course_id` is optional. When set, the course's cached syllabus
    extraction is appended as a "## COURSE CONTEXT" block. `lecture_id` is
    optional and, when set, appends a "## LECTURE CONTEXT" block after the
    course block — keeping the persona's voice first, then ever-narrower
    grounding (course → lecture).
    """
    persona_block = _persona_block(persona_id, db)
    memory_block  = _memory_block(persona_id, db)
    course_block  = _course_block(course_id, db)
    lecture_block = _lecture_block(lecture_id, db)

    parts = [persona_block]
    if memory_block:
        parts.append(f"## SESSION MEMORY\n{memory_block}")
    if course_block:
        parts.append(course_block)
    if lecture_block:
        parts.append(lecture_block)

    return "\n\n".join(parts)


# ── Layer 1: persona ───────────────────────────────────────────────────────

def _persona_block(persona_id: str | None, db: Session) -> str:
    if not persona_id:
        return _DEFAULT_SYSTEM_PROMPT

    persona: Persona | None = (
        db.query(Persona).filter(Persona.id == persona_id).first()
    )
    if not persona:
        return _DEFAULT_SYSTEM_PROMPT

    base: str = (persona.system_prompt or persona.manual_prompt_override or "").strip()
    return base or _DEFAULT_SYSTEM_PROMPT


# ── Layer 2: persisted session memory ──────────────────────────────────────

def _memory_block(persona_id: str | None, db: Session) -> str:
    if not persona_id:
        return ""
    memories: list[SessionMemory] = (
        db.query(SessionMemory)
        .filter(SessionMemory.persona_id == persona_id)
        .order_by(SessionMemory.created_at.asc())
        .all()
    )
    return "\n\n".join(
        m.injected_memory_text
        for m in memories
        if m.injected_memory_text and m.injected_memory_text.strip()
    )


# ── Layer 3: course syllabus context ───────────────────────────────────────

def _course_block(course_id: int | None, db: Session) -> str:
    if not course_id:
        return ""
    course: Course | None = db.query(Course).filter(Course.id == course_id).first()
    if not course or not course.syllabus_extracted:
        return ""
    return build_syllabus_system_block(course.syllabus_extracted, course.title)


# ── Layer 4: lecture context (F-033) ───────────────────────────────────────

# Conservative cap so a 5,000-word unified_summary doesn't blow up the prompt
# tokens on every turn. Truncating at a char boundary keeps the block coherent
# and the LLM gets enough material to ground answers in the specific lecture.
_LECTURE_BLOCK_CHAR_LIMIT = 8_000


def _lecture_block(lecture_id: int | None, db: Session) -> str:
    if not lecture_id:
        return ""
    lec: Lecture | None = (
        db.query(Lecture)
        .options(
            selectinload(Lecture.lecturer_summaries)
                .selectinload(LectureLecturerSummary.user_doc)
                .selectinload(UserDocument.base_document),
        )
        .filter(Lecture.id == lecture_id)
        .first()
    )
    if not lec:
        return ""

    # Prefer the AI-generated unified summary. Otherwise fall back to text
    # extracted from the FIRST lecturer-summary PDF (F-035: summaries are
    # PDFs, not stored markdown — pull chunks from the CAS pipeline).
    body = (lec.unified_summary or "").strip()
    if not body:
        for s in (lec.lecturer_summaries or []):
            ud = s.user_doc
            bd = ud.base_document if ud else None
            if not bd or bd.doc_type == "IMAGE":
                continue
            chunks = (
                db.query(Chunk)
                .filter(Chunk.base_hash == bd.hash_id)
                .order_by(Chunk.chunk_index.asc())
                .limit(20)
                .all()
            )
            text = "\n\n".join(c.text for c in chunks if c.text).strip()
            if text:
                body = text
                break
    if not body:
        return ""

    if len(body) > _LECTURE_BLOCK_CHAR_LIMIT:
        body = body[:_LECTURE_BLOCK_CHAR_LIMIT].rstrip() + "\n\n…(truncated)"

    header = f"## LECTURE CONTEXT — {lec.title}"
    if lec.lecture_date:
        header += f" ({lec.lecture_date.isoformat()})"
    return f"{header}\n{body}"
