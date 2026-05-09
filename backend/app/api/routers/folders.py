"""
app/api/routers/folders.py
───────────────────────────
Folder CRUD — groups UserDocuments into course/subject containers.

Mounted at /api/v1/folders in app/main.py.

Routes:
  GET    /           list caller's folders
  POST   /           create a folder
  PUT    /{id}       update name / color / is_starred / persona_id
  DELETE /{id}       delete folder; detaches (nulls) all its documents first
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import Course, Folder, User, UserDocument
from app.services.permissions import (
    DEFAULT_ORG_ID, FolderCapabilities, Scope, gate_or_403,
)

router = APIRouter(tags=["folders"])


def _folder_scope(course_id: Optional[int]) -> Scope:
    """Folders nested under a course gate at the course scope; top-level
    personal folders gate at the Default org (v1 — until users can have
    folders inside real orgs, which Phase 5 unlocks)."""
    if course_id is not None:
        return Scope.course(course_id)
    return Scope.organization(DEFAULT_ORG_ID)


# ── Schemas ────────────────────────────────────────────────────────────────

class FolderCreate(BaseModel):
    name: str
    color: Optional[str] = None
    persona_id: Optional[str] = None
    course_id: Optional[int] = None   # nest under a course; null = top-level


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    is_starred: Optional[bool] = None
    persona_id: Optional[str] = None
    # Use Optional[int] with a sentinel-aware setter below: None means
    # "don't change", but the caller can also send null in JSON to detach.
    # The router treats both as no-op, and uses a separate flag via
    # `course_id_explicit` in the request body for "set to NULL" if needed
    # in future. Phase 1: skip detach via PUT; use POST move endpoint instead.
    course_id: Optional[int] = None


class FolderResponse(BaseModel):
    id: int
    user_id: int
    name: str
    color: Optional[str] = None
    is_starred: bool = False
    persona_id: Optional[str] = None
    course_id: Optional[int] = None
    created_at: str

    class Config:
        from_attributes = True


def _to_response(f: Folder) -> FolderResponse:
    return FolderResponse(
        id=f.id,
        user_id=f.user_id,
        name=f.name,
        color=f.color,
        is_starred=f.is_starred,
        persona_id=f.persona_id,
        course_id=f.course_id,
        created_at=f.created_at.isoformat() if f.created_at else "",
    )


def _assert_owns_course(course_id: int, user: User, db: Session) -> None:
    """A folder can only be nested under a course the caller owns."""
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.owner_id == user.id)
        .first()
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[FolderResponse])
def list_folders(
    course_id: Optional[int] = None,
    top_level_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the caller's folders.

    Optional filters
    ────────────────
    • course_id      — return only folders nested under the given course.
    • top_level_only — return only folders with course_id IS NULL
                       (the My Library "Folders" lane).
    The two filters are mutually exclusive in spirit; if both are passed,
    `course_id` wins.
    """
    q = db.query(Folder).filter(Folder.user_id == current_user.id)
    if course_id is not None:
        q = q.filter(Folder.course_id == course_id)
    elif top_level_only:
        q = q.filter(Folder.course_id.is_(None))

    folders = q.order_by(Folder.is_starred.desc(), Folder.name).all()
    return [_to_response(f) for f in folders]


@router.post("/", response_model=FolderResponse, status_code=201)
def create_folder(
    payload: FolderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.course_id is not None:
        _assert_owns_course(payload.course_id, current_user, db)

    # Phase 2 gate. Owner = creator (folder is implicitly self-owned).
    gate_or_403(
        current_user, FolderCapabilities.create_folder,
        _folder_scope(payload.course_id), db,
        owner_id=current_user.id,
    )

    folder = Folder(
        user_id=current_user.id,
        name=payload.name,
        color=payload.color,
        persona_id=payload.persona_id,
        course_id=payload.course_id,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return _to_response(folder)


@router.put("/{folder_id}", response_model=FolderResponse)
def update_folder(
    folder_id: int,
    payload: FolderUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = (
        db.query(Folder)
        .filter(Folder.id == folder_id, Folder.user_id == current_user.id)
        .first()
    )
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    # Phase 2 gate — owner-fallback in Default keeps existing semantics.
    gate_or_403(
        current_user, FolderCapabilities.update_folder,
        _folder_scope(folder.course_id), db,
        owner_id=folder.user_id,
    )

    if payload.name is not None:
        folder.name = payload.name
    if payload.color is not None:
        folder.color = payload.color
    if payload.is_starred is not None:
        folder.is_starred = payload.is_starred
    if payload.persona_id is not None:
        folder.persona_id = payload.persona_id
    if payload.course_id is not None:
        _assert_owns_course(payload.course_id, current_user, db)
        folder.course_id = payload.course_id

    db.commit()
    db.refresh(folder)
    return _to_response(folder)


@router.delete("/{folder_id}", status_code=204)
def delete_folder(
    folder_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = (
        db.query(Folder)
        .filter(Folder.id == folder_id, Folder.user_id == current_user.id)
        .first()
    )
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    gate_or_403(
        current_user, FolderCapabilities.delete_folder,
        _folder_scope(folder.course_id), db,
        owner_id=folder.user_id,
    )

    # Detach all documents rather than cascade-deleting them
    db.query(UserDocument).filter(UserDocument.folder_id == folder_id).update(
        {"folder_id": None}, synchronize_session=False
    )

    db.delete(folder)
    db.commit()
