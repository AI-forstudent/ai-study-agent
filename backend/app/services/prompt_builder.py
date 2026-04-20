"""
app/services/prompt_builder.py
──────────────────────────────
Resolves the effective system prompt for a Persona, including any persisted
SessionMemory entries appended in chronological order so learning from past
sessions carries forward automatically.

Priority:
  1. Persona.system_prompt          (rich structured prompt — preferred)
  2. Persona.manual_prompt_override (legacy raw override)
  3. Built-in default               (generic study assistant)
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.domain import Persona, SessionMemory

_DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful and precise AI study assistant. "
    "Answer clearly and concisely. Match the student's language automatically."
)


def resolve_system_prompt(persona_id: str | None, db: Session) -> str:
    """Return the fully assembled system prompt for a persona.

    Safely falls back to the default when:
      - persona_id is None
      - the Persona row does not exist in the DB
      - both system_prompt and manual_prompt_override are empty
    """
    if not persona_id:
        return _DEFAULT_SYSTEM_PROMPT

    persona: Persona | None = (
        db.query(Persona).filter(Persona.id == persona_id).first()
    )
    if not persona:
        return _DEFAULT_SYSTEM_PROMPT

    # Priority 1 → rich structured system_prompt
    # Priority 2 → legacy manual_prompt_override
    base: str = (persona.system_prompt or persona.manual_prompt_override or "").strip()

    if not base:
        return _DEFAULT_SYSTEM_PROMPT

    # Append persisted session memories (oldest first so latest context wins)
    memories: list[SessionMemory] = (
        db.query(SessionMemory)
        .filter(SessionMemory.persona_id == persona_id)
        .order_by(SessionMemory.created_at.asc())
        .all()
    )

    if memories:
        blocks = "\n\n".join(
            m.injected_memory_text
            for m in memories
            if m.injected_memory_text and m.injected_memory_text.strip()
        )
        if blocks:
            base = f"{base}\n\n## SESSION MEMORY\n{blocks}"

    return base
