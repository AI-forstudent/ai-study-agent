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
from app.models.domain import Folder, User, UserDocument

router = APIRouter(tags=["folders"])


# ── Schemas ────────────────────────────────────────────────────────────────

class FolderCreate(BaseModel):
    name: str
    color: Optional[str] = None
    persona_id: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    is_starred: Optional[bool] = None
    persona_id: Optional[str] = None


class FolderResponse(BaseModel):
    id: int
    user_id: int
    name: str
    color: Optional[str] = None
    is_starred: bool = False
    persona_id: Optional[str] = None
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
        created_at=f.created_at.isoformat() if f.created_at else "",
    )


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[FolderResponse])
def list_folders(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folders = (
        db.query(Folder)
        .filter(Folder.user_id == current_user.id)
        .order_by(Folder.is_starred.desc(), Folder.name)
        .all()
    )
    return [_to_response(f) for f in folders]


@router.post("/", response_model=FolderResponse, status_code=201)
def create_folder(
    payload: FolderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = Folder(
        user_id=current_user.id,
        name=payload.name,
        color=payload.color,
        persona_id=payload.persona_id,
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

    if payload.name is not None:
        folder.name = payload.name
    if payload.color is not None:
        folder.color = payload.color
    if payload.is_starred is not None:
        folder.is_starred = payload.is_starred
    if payload.persona_id is not None:
        folder.persona_id = payload.persona_id

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

    # Detach all documents rather than cascade-deleting them
    db.query(UserDocument).filter(UserDocument.folder_id == folder_id).update(
        {"folder_id": None}, synchronize_session=False
    )

    db.delete(folder)
    db.commit()
