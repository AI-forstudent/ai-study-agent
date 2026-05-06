"""
app/api/routers/library.py
───────────────────────────
The "Sessions & Files" lane on My Library.

The frontend wants a single mixed feed sorted by recency that contains both
the user's sessions (root threads) and their files that aren't tucked into
any folder. This router emits a tagged-union list — `kind = 'session' | 'file'`
— so the frontend can render either card type without a second round-trip.

Mounted at /api/v1/library in app/main.py.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session as DBSession

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import Message, Thread, User, UserDocument

router = APIRouter(tags=["library"])


# ── Schemas ────────────────────────────────────────────────────────────────

class LibraryFeedItem(BaseModel):
    """Tagged-union shape: `kind` selects which set of fields is populated."""
    model_config = ConfigDict(from_attributes=True)

    kind:        str           # 'session' | 'file'
    sort_at:     datetime      # last activity timestamp used for ordering

    # Session fields
    session_id:      Optional[int]    = None
    session_title:   Optional[str]    = None
    session_emoji:   Optional[str]    = None
    session_preview: Optional[str]    = None
    message_count:   Optional[int]    = None
    document_id:     Optional[int]    = None
    document_title:  Optional[str]    = None

    # File fields (UserDocument that is unfiled)
    file_id:        Optional[int]    = None
    file_title:     Optional[str]    = None
    file_doc_type:  Optional[str]    = None
    file_path:      Optional[str]    = None
    is_starred:     Optional[bool]   = None
    is_public:      Optional[bool]   = None


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("/recent", response_model=List[LibraryFeedItem])
def list_recent(
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
    limit: int = Query(40, ge=1, le=200),
):
    """Return the merged Sessions + unfiled Files lane, newest first.

    "Unfiled" means UserDocument.folder_id IS NULL — files inside a folder
    are reached by clicking into that folder, not via this lane.
    """
    items: list[LibraryFeedItem] = []

    # ── Sessions (root threads) ────────────────────────────────────────
    threads = (
        db.query(Thread)
        .filter(
            Thread.user_id == current_user.id,
            Thread.parent_thread_id.is_(None),
        )
        .order_by(Thread.created_at.desc())
        .limit(limit)
        .all()
    )
    for t in threads:
        first_msg = (
            db.query(Message)
            .filter(Message.thread_id == t.id, Message.role == "user")
            .order_by(Message.id.asc())
            .first()
        )
        msg_count = db.query(Message).filter(Message.thread_id == t.id).count()
        doc_title = None
        if t.document_id is not None:
            ud = db.query(UserDocument).filter(UserDocument.id == t.document_id).first()
            if ud:
                doc_title = ud.custom_title

        preview = first_msg.content if first_msg else None
        if preview and len(preview) > 140:
            preview = preview[:137] + "…"

        items.append(LibraryFeedItem(
            kind="session",
            sort_at=t.created_at,
            session_id=t.id,
            session_title=t.title,
            session_emoji=t.emoji,
            session_preview=preview,
            message_count=msg_count,
            document_id=t.document_id,
            document_title=doc_title,
        ))

    # ── Unfiled files ──────────────────────────────────────────────────
    unfiled = (
        db.query(UserDocument)
        .filter(
            UserDocument.user_id == current_user.id,
            UserDocument.folder_id.is_(None),
        )
        .order_by(UserDocument.created_at.desc())
        .limit(limit)
        .all()
    )
    for ud in unfiled:
        items.append(LibraryFeedItem(
            kind="file",
            sort_at=ud.created_at,
            file_id=ud.id,
            file_title=ud.custom_title,
            file_doc_type=ud.base_document.doc_type if ud.base_document else "GENERAL",
            file_path=ud.base_document.file_path if ud.base_document else None,
            is_starred=ud.is_starred,
            is_public=ud.is_public,
        ))

    items.sort(key=lambda x: x.sort_at, reverse=True)
    return items[:limit]
