"""
app/schemas/schemas.py
──────────────────────
Pydantic request/response models.

Document shapes after the CAS split
─────────────────────────────────────
• BaseDocumentResponse  — one row from `basedocuments` (content metadata)
• UserDocumentResponse  — one row from `userdocuments`  (workspace metadata)
• DocumentResponse      — composite shape the frontend consumes; combines
                           fields from UserDocument + its linked BaseDocument.
                           Routers must construct this manually (a plain ORM
                           UserDocument object is not enough).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


# ── Users ──────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    is_active: bool = True

    class Config:
        from_attributes = True


# ── Messages ───────────────────────────────────────────────────────────────

class MessageCreate(BaseModel):
    content: str
    role: str = "user"


class MessageResponse(BaseModel):
    id: int
    content: str
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Threads ────────────────────────────────────────────────────────────────

class ThreadCreate(BaseModel):
    # document_id refers to userdocuments.id; nullable for standalone chat
    # threads created without an attached document.
    document_id: Optional[int] = None
    # page_number is meaningless without a document; nullable for the same reason.
    page_number: Optional[int] = None
    selected_text: Optional[str] = None
    coordinates: Optional[Any] = None
    initial_message: Optional[str] = None
    persona_id: Optional[str] = None
    # Optional course scoping — when set, the prompt builder injects the
    # course's cached syllabus extraction into the system prompt.
    course_id: Optional[int] = None


class ThreadUpdate(BaseModel):
    """Partial update for a thread the caller owns. Currently only exposes
    `document_id` so the F-020 chat-attach flow can promote a previously
    standalone thread to a doc-anchored one mid-conversation."""
    document_id: Optional[int] = None


class ThreadResponse(BaseModel):
    id: int
    document_id: Optional[int] = None   # userdocuments.id
    page_number: Optional[int] = None   # null for standalone chat threads
    selected_text: Optional[str] = None
    coordinates: Optional[Any] = None
    emoji: Optional[str] = "💬"
    title: Optional[str] = None
    created_at: datetime
    parent_thread_id: Optional[int] = None
    forked_from_message_id: Optional[int] = None
    persona_id: Optional[str] = None
    course_id: Optional[int] = None
    messages: List[MessageResponse] = []

    class Config:
        from_attributes = True


# ── BaseDocument ───────────────────────────────────────────────────────────

class BaseDocumentResponse(BaseModel):
    """Raw content record — one row from `basedocuments`."""
    hash_id:           str
    original_filename: str
    file_path:         Optional[str] = None
    source_type:       str = "UPLOAD"
    source_url:        Optional[str] = None
    doc_type:          str = "GENERAL"
    parent_hash:       Optional[str] = None
    global_summary:    Optional[str] = None
    doc_metadata:      Dict[str, Any] = {}
    created_at:        datetime

    class Config:
        from_attributes = True


# ── UserDocument ───────────────────────────────────────────────────────────

class UserDocumentResponse(BaseModel):
    """Workspace record — one row from `userdocuments`."""
    id:               int
    user_id:          int
    base_hash:        str
    custom_title:     str
    folder_id:        Optional[int] = None
    is_starred:       bool = False
    personal_summary: Optional[str] = None
    is_public:        bool = False
    ai_feedback:      Optional[Dict[str, Any]] = None
    created_at:       datetime
    shared_at:        Optional[datetime] = None

    class Config:
        from_attributes = True


# ── DocumentResponse (composite — frontend-facing) ─────────────────────────

class DocumentResponse(BaseModel):
    """
    Composite shape consumed by the frontend api.ts.
    Combines UserDocument workspace fields with key BaseDocument content fields.
    Routers build this manually from a (UserDocument, BaseDocument) join.
    """
    # From UserDocument
    id:          int
    user_id:     int
    title:       str          # maps to UserDocument.custom_title
    is_public:   bool = False
    is_starred:  bool = False
    folder_id:   Optional[int] = None
    shared_at:   Optional[datetime] = None
    created_at:  datetime
    # Recency-of-use for the My Library Files lane sort. NULL until the
    # doc is first opened post-restructure (PATCH /touch). Frontend
    # treats NULL as `created_at` for sorting purposes.
    last_opened_at: Optional[datetime] = None
    # From BaseDocument
    file_path:    Optional[str] = None
    base_hash:    str
    doc_type:     str = "GENERAL"
    global_summary: Optional[str] = None

    class Config:
        from_attributes = True


class VisibilityUpdate(BaseModel):
    is_public: bool


class PublicDocumentResponse(BaseModel):
    """
    Public gallery shape.
    id / title / is_public / shared_at come from UserDocument;
    summary comes from BaseDocument.global_summary.
    """
    id:          int
    title:       str
    summary:     Optional[str] = None
    is_public:   bool
    shared_at:   Optional[datetime] = None
    owner_email: str

    class Config:
        from_attributes = True


# ── Page summaries ─────────────────────────────────────────────────────────

class PageSummaryResponse(BaseModel):
    id:          int
    base_hash:   str           # was document_id (int) before CAS split
    page_number: int
    summary:     str
    created_at:  datetime

    class Config:
        from_attributes = True


class FullSummaryResponse(BaseModel):
    summary: str


class CustomSummaryRequest(BaseModel):
    custom_prompt: str
    page_number:   int | None = None
