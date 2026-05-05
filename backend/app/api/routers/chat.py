"""
app/api/routers/chat.py
───────────────────────
Standalone AI chat endpoint.

Handles conversations with a Persona without requiring a PDF document.
Each call either continues an existing Thread (pass thread_id) or creates a
new one automatically (thread_id = null).

Mounted at /api/v1/chat in app/main.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.domain import Message, Thread
from app.services.prompt_builder import resolve_system_prompt
from app.services.model_router import resolve_alias
from app.services.llm_providers import call_llm

router = APIRouter(tags=["chat"])


# ── Request / Response schemas ─────────────────────────────────────────────

class ChatRequest(BaseModel):
    message:     str
    thread_id:   int | None  = None   # null → create a new thread
    persona_id:  str | None  = None   # null → default system prompt
    model_tier:  str | None  = None   # "flash-lite" | "flash" | "pro"
    ai_provider: str | None  = None   # "gemini" | "openai" | "anthropic"


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:         int
    role:       str
    content:    str
    created_at: str


class ChatResponse(BaseModel):
    thread_id: int
    reply:     MessageOut


# ── Route ──────────────────────────────────────────────────────────────────

@router.post("/", response_model=ChatResponse)
def chat(payload: ChatRequest, db: Session = Depends(get_db)):
    """Send a message and receive an AI reply.

    Flow:
      1. Resolve or create a Thread (standalone: document_id = NULL).
      2. Persist the user Message.
      3. Load full conversation history for the thread.
      4. Resolve the Persona's system prompt (with session memories appended).
      5. Resolve the model via the alias registry (default: VOLT).
      6. Call Google GenAI and get the reply text.
      7. Persist the assistant Message with model_alias for cost auditing.
      8. Return thread_id + the assistant MessageOut.
    """

    # ── 1. Thread ───────────────────────────────────────────────────────────
    if payload.thread_id is not None:
        thread: Thread | None = (
            db.query(Thread).filter(Thread.id == payload.thread_id).first()
        )
        if not thread:
            raise HTTPException(
                status_code=404,
                detail=f"Thread {payload.thread_id} not found.",
            )
    else:
        thread = Thread(
            document_id=None,
            persona_id=payload.persona_id,
            selected_text="",
            emoji="💬",
        )
        db.add(thread)
        db.commit()
        db.refresh(thread)

    # ── 2. Persist user message ─────────────────────────────────────────────
    user_msg = Message(
        thread_id=thread.id,
        role="user",
        content=payload.message,
    )
    db.add(user_msg)
    db.commit()

    # ── 3. Load conversation history ────────────────────────────────────────
    history: list[Message] = (
        db.query(Message)
        .filter(Message.thread_id == thread.id)
        .order_by(Message.id.asc())
        .all()
    )

    # ── 4. Resolve system prompt ────────────────────────────────────────────
    effective_persona_id = payload.persona_id or thread.persona_id
    system_prompt = resolve_system_prompt(effective_persona_id, db)

    # ── 5. Resolve alias for DB audit trail ────────────────────────────────
    alias = resolve_alias("chat", payload.model_tier)

    # ── 6. Build history and call the appropriate LLM provider ────────────
    msg_history = [
        {"role": msg.role if msg.role != "assistant" else "assistant", "content": msg.content}
        for msg in history
    ]

    try:
        reply_text: str = call_llm(
            provider=payload.ai_provider,
            model_tier=payload.model_tier,
            system_prompt=system_prompt,
            history=msg_history,
        )
    except Exception as exc:
        print(f"[chat] LLM error (provider={payload.ai_provider}, tier={payload.model_tier}): {exc}")
        raise HTTPException(
            status_code=503,
            detail="AI service temporarily unavailable. Please try again in a moment.",
        )

    # ── 7. Persist assistant reply ──────────────────────────────────────────
    ai_msg = Message(
        thread_id=thread.id,
        role="assistant",
        content=reply_text,
        model_alias=alias,
    )
    db.add(ai_msg)
    db.commit()
    db.refresh(ai_msg)

    # ── 8. Return ───────────────────────────────────────────────────────────
    return ChatResponse(
        thread_id=thread.id,
        reply=MessageOut(
            id=ai_msg.id,
            role=ai_msg.role,
            content=ai_msg.content,
            created_at=ai_msg.created_at.isoformat(),
        ),
    )
