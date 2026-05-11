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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import Message, Thread, User
from app.services.document_service import generate_session_title_background
from app.services.prompt_builder import resolve_system_prompt
from app.services.model_router import resolve_alias
from app.services.llm_providers import call_llm_with_usage
from app.services.usage_logger import write_usage_event

router = APIRouter(tags=["chat"])


# ── Request / Response schemas ─────────────────────────────────────────────

class ChatRequest(BaseModel):
    message:     str
    thread_id:   int | None  = None   # null → create a new thread
    persona_id:  str | None  = None   # null → default system prompt
    model_tier:  str | None  = None   # "flash-lite" | "flash" | "pro"
    ai_provider: str | None  = None   # "gemini" | "openai" | "anthropic"
    # Optional course scoping. When set on a new thread, the syllabus
    # extraction for that course is injected into the system prompt.
    course_id:   int | None  = None
    # Optional lecture scoping (F-033). When set on a new thread, the
    # lecture's cached unified_summary is injected as a "## LECTURE CONTEXT"
    # block so the assistant answers within that specific lecture's framing.
    lecture_id:  int | None  = None


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
def chat(
    payload: ChatRequest,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a message and receive an AI reply.

    Flow:
      1. Resolve or create a Thread (standalone: document_id = NULL). Existing
         threads are looked up under the current user — cross-user lookups 404.
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
            db.query(Thread)
            .filter(Thread.id == payload.thread_id, Thread.user_id == current_user.id)
            .first()
        )
        if not thread:
            raise HTTPException(
                status_code=404,
                detail=f"Thread {payload.thread_id} not found.",
            )
    else:
        thread = Thread(
            user_id=current_user.id,
            document_id=None,
            persona_id=payload.persona_id,
            course_id=payload.course_id,
            lecture_id=payload.lecture_id,
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
    # Capture this BEFORE the assistant reply is persisted in step 7. With
    # only the user message in history, len == 1 ⇔ this is the first
    # exchange in the thread. We use this for the session-title BG-task
    # gate (step 7b) — gating on `not thread.session_title` instead caused
    # duplicate Gemini calls for fast-typing users, because BG tasks run
    # AFTER the response and the column hasn't committed yet when the
    # next request arrives.
    is_first_exchange = len(history) == 1 and thread.parent_thread_id is None

    # ── 4. Resolve system prompt ────────────────────────────────────────────
    # Course / lecture scoping flow from the thread (set on creation) —
    # payload.course_id / payload.lecture_id are only meaningful for the
    # very first message in a new thread.
    effective_persona_id = payload.persona_id or thread.persona_id
    effective_course_id  = thread.course_id   or payload.course_id
    effective_lecture_id = thread.lecture_id  or payload.lecture_id
    system_prompt = resolve_system_prompt(
        effective_persona_id,
        db,
        course_id=effective_course_id,
        lecture_id=effective_lecture_id,
    )

    # ── 5. Resolve alias for DB audit trail ────────────────────────────────
    alias = resolve_alias("chat", payload.model_tier)

    # ── 6. Build history and call the appropriate LLM provider ────────────
    msg_history = [
        {"role": msg.role if msg.role != "assistant" else "assistant", "content": msg.content}
        for msg in history
    ]

    try:
        reply = call_llm_with_usage(
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

    # ── 6b. Record usage (T-008). Best-effort — failure here never blocks
    # the assistant reply, so the user's chat experience is unaffected by
    # a usage-table hiccup.
    write_usage_event(
        db, current_user.id, "chat", reply, model_alias=alias,
    )

    # ── 7. Persist assistant reply ──────────────────────────────────────────
    ai_msg = Message(
        thread_id=thread.id,
        role="assistant",
        content=reply.text,
        model_alias=alias,
    )
    db.add(ai_msg)
    db.commit()
    db.refresh(ai_msg)

    # ── 7b. Session-title generation on the very first exchange ────────────
    # Gate on history length captured BEFORE the assistant reply was
    # persisted (see step 3) — race-free, mirrors the doc-anchored sibling
    # at threads.py:223. Gating on `not thread.session_title` would re-fire
    # this BG task for every message until the title commits, which under
    # fast typing means 3-5× duplicate Gemini calls and a write race; if
    # Gemini fails on the first attempt, the bare except inside the BG
    # function leaves `session_title` NULL forever and EVERY subsequent
    # message re-burns tokens.
    if is_first_exchange:
        background.add_task(
            generate_session_title_background,
            thread.id, payload.message, reply.text, db,
        )

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
