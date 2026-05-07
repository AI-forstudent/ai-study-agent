"""
app/api/routers/sessions.py
────────────────────────────
Read-only Session endpoints.

A "Session" is a root Thread (Thread.parent_thread_id IS NULL) owned by the
calling user. Sessions can be:
  • document-anchored — Thread.document_id points to a UserDocument.
  • standalone        — Thread.document_id IS NULL (created via /api/v1/chat/).

This router exposes:
  GET  /sessions/          — list the caller's sessions, newest first, with
                              a short message preview for each card.
  GET  /sessions/search    — full-text scan across the caller's session
                              titles + first message + selected_text.

Sessions are *created* via the existing `/api/v1/chat/` and `/api/v1/threads/`
endpoints — this router only reads. Mutating routes there already enforce
ownership; nothing to duplicate.

Mounted at /api/v1/sessions in app/main.py.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_
from sqlalchemy.orm import Session as DBSession

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import Message, Thread, User, UserDocument

router = APIRouter(tags=["sessions"])


# ── Schemas ────────────────────────────────────────────────────────────────

class SessionCard(BaseModel):
    """Compact shape used by the My Library Sessions lane."""
    model_config = ConfigDict(from_attributes=True)

    id:                int
    title:             Optional[str] = None       # Per-thread short label
    session_title:     Optional[str] = None       # AI-generated collective title for the whole tree
    emoji:             Optional[str] = None
    document_id:       Optional[int] = None       # UserDocument.id, if anchored
    document_title:    Optional[str] = None       # Resolved on the server
    persona_id:        Optional[str] = None
    selected_text:     Optional[str] = None
    last_message:      Optional[str] = None       # First-message preview
    message_count:     int           = 0
    created_at:        datetime


# ── Helpers ────────────────────────────────────────────────────────────────

def _build_card(thread: Thread, db: DBSession) -> SessionCard:
    # Compose a short preview from the first user message in the thread.
    first_msg = (
        db.query(Message)
        .filter(Message.thread_id == thread.id, Message.role == "user")
        .order_by(Message.id.asc())
        .first()
    )
    msg_count = (
        db.query(Message).filter(Message.thread_id == thread.id).count()
    )
    doc_title = None
    if thread.document_id is not None:
        ud = db.query(UserDocument).filter(UserDocument.id == thread.document_id).first()
        if ud:
            doc_title = ud.custom_title

    preview = first_msg.content if first_msg else None
    if preview and len(preview) > 140:
        preview = preview[:137] + "…"

    return SessionCard(
        id=thread.id,
        title=thread.title,
        session_title=thread.session_title,
        emoji=thread.emoji,
        document_id=thread.document_id,
        document_title=doc_title,
        persona_id=thread.persona_id,
        selected_text=thread.selected_text,
        last_message=preview,
        message_count=msg_count,
        created_at=thread.created_at,
    )


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[SessionCard])
def list_my_sessions(
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Return root threads the caller owns, newest first.

    Filtering rules (per the 2026-05-08 library restructure brief):
      • parent_thread_id IS NULL — forks/sub-threads show inside their parent
        session in the workspace tree, not as standalone cards.
      • EXISTS at least one Message — a Session is a *learning event*, so a
        thread that was created (e.g. by the auto-clone flow) but never had
        a message exchange is NOT a session and shouldn't clutter the lane.
        That's the user's hard rule: "if I just upload a doc and don't ask
        anything, that's a doc, not a session."
    """
    rows = (
        db.query(Thread)
        .filter(
            Thread.user_id == current_user.id,
            Thread.parent_thread_id.is_(None),
            db.query(Message.id)
              .filter(Message.thread_id == Thread.id)
              .exists(),
        )
        .order_by(Thread.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_build_card(t, db) for t in rows]


@router.get("/search", response_model=List[SessionCard])
def search_my_sessions(
    q: str = Query(..., min_length=1, description="Free-text query"),
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
):
    """Search across the caller's sessions.

    Match logic (server-side, case-insensitive):
      • Thread.title         — AI-generated session title
      • Thread.selected_text — text the user highlighted to start the chat
      • Message.content      — full-text over messages in any of those threads

    The endpoint returns each matching root thread once, regardless of how
    many message hits it had.
    """
    pattern = f"%{q.lower()}%"
    has_messages = (
        db.query(Message.id)
          .filter(Message.thread_id == Thread.id)
          .exists()
    )

    # Threads where title / session_title / selected_text match.
    direct = (
        db.query(Thread)
        .filter(
            Thread.user_id == current_user.id,
            Thread.parent_thread_id.is_(None),
            has_messages,
            or_(
                Thread.title.ilike(pattern),
                Thread.session_title.ilike(pattern),
                Thread.selected_text.ilike(pattern),
            ),
        )
        .all()
    )

    # Root threads whose ANY message matches.
    via_messages = (
        db.query(Thread)
        .join(Message, Message.thread_id == Thread.id)
        .filter(
            Thread.user_id == current_user.id,
            Thread.parent_thread_id.is_(None),
            Message.content.ilike(pattern),
        )
        .distinct()
        .all()
    )

    seen: dict[int, Thread] = {}
    for t in direct + via_messages:
        seen[t.id] = t

    rows = sorted(seen.values(), key=lambda t: t.created_at, reverse=True)[:limit]
    return [_build_card(t, db) for t in rows]


@router.delete("/{session_id}", status_code=204)
def delete_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """Delete a session (root thread) and every fork descended from it.

    Walks the fork tree breadth-first and deletes all descendants' messages
    and the threads themselves. Ownership is enforced — non-owners 404.
    """
    root = (
        db.query(Thread)
        .filter(
            Thread.id == session_id,
            Thread.user_id == current_user.id,
            Thread.parent_thread_id.is_(None),
        )
        .first()
    )
    if not root:
        raise HTTPException(status_code=404, detail="Session not found")

    # Collect the thread ids in this fork tree.
    to_visit = [root.id]
    all_ids: list[int] = []
    while to_visit:
        layer = to_visit
        to_visit = []
        all_ids.extend(layer)
        children = (
            db.query(Thread.id)
            .filter(Thread.parent_thread_id.in_(layer))
            .all()
        )
        to_visit = [row[0] for row in children]

    # Null circular FKs before deleting messages and threads.
    db.query(Thread).filter(Thread.id.in_(all_ids)).update(
        {"forked_from_message_id": None, "parent_thread_id": None},
        synchronize_session=False,
    )
    db.flush()

    db.query(Message).filter(Message.thread_id.in_(all_ids)).delete(synchronize_session=False)
    db.query(Thread).filter(Thread.id.in_(all_ids)).delete(synchronize_session=False)
    db.commit()
