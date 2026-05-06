"""
app/api/routers/threads.py
───────────────────────────
Thread creation, retrieval, forking, and message handling.

Every Thread is owned by exactly one User (Thread.user_id). Both
document-anchored threads and standalone chat threads carry this attribution.
All endpoints enforce ownership: a thread is reachable only by the user who
created it. Threads with NULL user_id (legacy/orphan rows) are invisible.

For RAG context, the router resolves:
  Thread.document_id → UserDocument → BaseDocument.hash_id
and passes base_hash to the chunk/embedding layer.

Mounted at /api/v1/threads in app/main.py.
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import Chunk, Message, Thread, User, UserDocument
from app.schemas.schemas import MessageCreate, MessageResponse, ThreadCreate, ThreadResponse
from app.services.document_service import (
    generate_thread_metadata_background,
    get_chat_response_for_thread,
    get_full_thread_history,
)

router = APIRouter(tags=["threads"])


def _get_owned_thread_or_404(thread_id: int, user: User, db: Session) -> Thread:
    """Fetch a thread the calling user owns, or raise 404.

    Returning 404 (not 403) for cross-user access is intentional: it does not
    leak the existence of another user's thread to ID-enumeration probes.
    """
    thread = (
        db.query(Thread)
        .filter(Thread.id == thread_id, Thread.user_id == user.id)
        .first()
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


def _assert_owns_userdoc(document_id: int, user: User, db: Session) -> UserDocument:
    """Verify the calling user owns the UserDocument before any thread op on it."""
    ud = (
        db.query(UserDocument)
        .filter(UserDocument.id == document_id, UserDocument.user_id == user.id)
        .first()
    )
    if not ud:
        raise HTTPException(status_code=404, detail="Document not found")
    return ud


# ── List threads for a UserDocument ────────────────────────────────────────

@router.get("/document/{document_id}", response_model=List[ThreadResponse])
def get_document_threads(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _assert_owns_userdoc(document_id, current_user, db)

    threads = (
        db.query(Thread)
        .filter(
            Thread.document_id == document_id,
            Thread.user_id == current_user.id,
        )
        .all()
    )
    for thread in threads:
        thread.messages = get_full_thread_history(thread.id, db)
    return threads


# ── Single thread ───────────────────────────────────────────────────────────

@router.get("/{thread_id}", response_model=ThreadResponse)
def get_single_thread(
    thread_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _get_owned_thread_or_404(thread_id, current_user, db)
    thread.messages = get_full_thread_history(thread.id, db)
    return thread


# ── Create thread ───────────────────────────────────────────────────────────

@router.post("/", response_model=ThreadResponse)
def create_thread(
    thread_data: ThreadCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if thread_data.document_id is not None:
        _assert_owns_userdoc(thread_data.document_id, current_user, db)

    new_thread = Thread(
        user_id=current_user.id,
        document_id=thread_data.document_id,   # userdocuments.id
        page_number=thread_data.page_number,
        selected_text=thread_data.selected_text,
        coordinates=thread_data.coordinates,
        emoji="💬",
        title=None,
        persona_id=thread_data.persona_id,
    )
    db.add(new_thread)
    db.commit()
    db.refresh(new_thread)
    return new_thread


# ── Add message to thread ───────────────────────────────────────────────────

@router.post("/{thread_id}/messages", response_model=MessageResponse)
def add_message_to_thread(
    thread_id: int,
    message: MessageCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _get_owned_thread_or_404(thread_id, current_user, db)

    user_msg = Message(thread_id=thread_id, role="user", content=message.content)
    db.add(user_msg)
    db.commit()

    # Generate title + emoji in the background on the first message only
    history_so_far = db.query(Message).filter(Message.thread_id == thread_id).all()
    if len(history_so_far) == 1:
        background_tasks.add_task(
            generate_thread_metadata_background,
            thread_id,
            message.content,
            thread.selected_text,
            db,
        )

    # Resolve UserDocument → BaseDocument for RAG (document_id may be NULL for
    # standalone chat threads — RAG context degrades gracefully when so)
    user_doc = (
        db.query(UserDocument).filter(UserDocument.id == thread.document_id).first()
        if thread.document_id
        else None
    )
    base_doc = user_doc.base_document if user_doc else None
    base_hash = base_doc.hash_id if base_doc else None

    full_history = get_full_thread_history(thread_id, db)

    # Fetch page-level chunks for immediate context injection
    page_chunks = (
        db.query(Chunk)
        .filter(Chunk.base_hash == base_hash, Chunk.page_number == thread.page_number)
        .all()
    ) if base_hash else []
    current_page_text = "\n".join(c.text for c in page_chunks)

    ai_response = get_chat_response_for_thread(
        history=full_history,
        selected_text=thread.selected_text or "",
        root_summary=base_doc.global_summary if base_doc else "",
        base_hash=base_hash,
        db=db,
        current_page_text=current_page_text,
        thread_persona_id=thread.persona_id,
    )

    ai_msg = Message(thread_id=thread_id, role="assistant", content=ai_response)
    db.add(ai_msg)
    db.commit()
    db.refresh(ai_msg)
    return ai_msg


# ── Fork thread ─────────────────────────────────────────────────────────────

@router.post("/{thread_id}/fork", response_model=ThreadResponse)
def fork_thread(
    thread_id: int,
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    parent_thread = _get_owned_thread_or_404(thread_id, current_user, db)

    new_thread = Thread(
        user_id=current_user.id,
        document_id=parent_thread.document_id,
        page_number=parent_thread.page_number,
        selected_text=parent_thread.selected_text,
        coordinates=parent_thread.coordinates,
        parent_thread_id=parent_thread.id,
        forked_from_message_id=message_id,
        emoji=parent_thread.emoji,
        persona_id=parent_thread.persona_id,
    )
    db.add(new_thread)
    db.commit()
    db.refresh(new_thread)

    new_thread.messages = get_full_thread_history(new_thread.id, db)
    return new_thread
