"""
app/api/routers/lectures.py
───────────────────────────
Lecture CRUD inside a Course (F-031 Phase 1).

A Lecture is a learning unit nested under a Course. It holds:
  • title + lecture_date
  • manual_summary (TEXT, user-written for now)
  • recording_user_document_id (FK → userdocuments, optional, audio file)
  • notes_user_document_id     (FK → userdocuments, optional, PDF or image)

Mounted at /api/v1 — actual paths live under /courses/{course_id}/lectures
and /lectures/{id}, mirroring the exams router.

Permissions
───────────
• Read access mirrors course read access (owner / member / public).
• Mutations (create / update / delete) are owner-only.
• Phase-1 multi-tenant scope columns (community_id, organization_id) are
  denormalized from the parent course at insert.

Phase 2 — DEFERRED
──────────────────
• POST /lectures/{id}/transcribe — Gemini audio API on the recording.
• POST /lectures/{id}/smart-summary — fuses transcript + notes + manual
  summary into a structured key-points / exercises / Q&A artifact.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import (
    Course, CourseMembership, Lecture, User, UserDocument,
)

router = APIRouter(tags=["lectures"])
log = logging.getLogger(__name__)


# ── Schemas ────────────────────────────────────────────────────────────────

class AttachedDocOut(BaseModel):
    """Compact projection of a UserDocument for lecture display."""
    model_config = ConfigDict(from_attributes=True)
    id:        int
    title:     str
    file_path: Optional[str] = None
    doc_type:  str = "GENERAL"


class LectureCreateRequest(BaseModel):
    title:                       str
    lecture_date:                Optional[date] = None
    manual_summary:              Optional[str]  = None
    recording_user_document_id:  Optional[int]  = None
    notes_user_document_id:      Optional[int]  = None


class LectureUpdateRequest(BaseModel):
    """Partial update — only fields the user actually changes are sent.

    `recording_user_document_id` / `notes_user_document_id` accept `None` to
    *detach* a previously-attached file. Use `0` if you ever need to disambiguate
    "field not present" from "explicit clear" — but Pydantic + JSON null works
    fine for this Phase-1 shape.
    """
    title:                       Optional[str]  = None
    lecture_date:                Optional[date] = None
    manual_summary:              Optional[str]  = None
    recording_user_document_id:  Optional[int]  = None
    notes_user_document_id:      Optional[int]  = None


class LectureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                          int
    course_id:                   int
    title:                       str
    lecture_date:                Optional[date] = None
    manual_summary:              Optional[str]  = None
    recording:                   Optional[AttachedDocOut] = None
    notes:                       Optional[AttachedDocOut] = None
    created_at:                  Optional[str]  = None  # ISO string
    updated_at:                  Optional[str]  = None


# ── Helpers ────────────────────────────────────────────────────────────────

def _ensure_course_owner(course_id: int, user: User, db: Session) -> Course:
    """Mutations are owner-only — admins won't seed someone else's lectures."""
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.owner_id == user.id)
        .first()
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


def _ensure_course_readable(course_id: int, user: User, db: Session) -> Course:
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if course.owner_id == user.id:
        return course
    membership = (
        db.query(CourseMembership)
        .filter(
            CourseMembership.user_id == user.id,
            CourseMembership.course_id == course_id,
        )
        .first()
    )
    if not membership and course.visibility != "public":
        raise HTTPException(status_code=404, detail="Course not found")
    return course


def _validate_user_doc(doc_id: Optional[int], user: User, db: Session) -> Optional[UserDocument]:
    """A lecture can only attach files the caller actually owns."""
    if doc_id is None:
        return None
    ud = (
        db.query(UserDocument)
        .filter(UserDocument.id == doc_id, UserDocument.user_id == user.id)
        .first()
    )
    if not ud:
        raise HTTPException(
            status_code=404,
            detail=f"Document {doc_id} not found in your library",
        )
    return ud


def _serialize_doc(ud: Optional[UserDocument]) -> Optional[AttachedDocOut]:
    if not ud:
        return None
    bd = ud.base_document
    return AttachedDocOut(
        id=ud.id,
        title=ud.custom_title,
        file_path=bd.file_path if bd else None,
        doc_type=bd.doc_type if bd else "GENERAL",
    )


def _serialize(lec: Lecture) -> LectureOut:
    return LectureOut(
        id=lec.id,
        course_id=lec.course_id,
        title=lec.title,
        lecture_date=lec.lecture_date,
        manual_summary=lec.manual_summary,
        recording=_serialize_doc(lec.recording_doc),
        notes=_serialize_doc(lec.notes_doc),
        created_at=lec.created_at.isoformat() if lec.created_at else None,
        updated_at=lec.updated_at.isoformat() if lec.updated_at else None,
    )


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("/courses/{course_id}/lectures", response_model=List[LectureOut])
def list_course_lectures(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all lectures in a course (any reader). Newest first.

    Sort key: `lecture_date DESC NULLS LAST, created_at DESC`. A lecture with
    no date set falls below dated ones rather than disappearing to the top
    of the list — the user's mental model is "most recent class first."
    """
    _ensure_course_readable(course_id, current_user, db)
    lectures = (
        db.query(Lecture)
        .filter(Lecture.course_id == course_id)
        .all()
    )
    # In-Python sort to avoid SQL nulls-last gymnastics; lecture lists per
    # course are tiny for the foreseeable future.
    lectures.sort(
        key=lambda lec: (
            lec.lecture_date is None,                                # False (dated) before True (undated)
            -(lec.lecture_date.toordinal() if lec.lecture_date else 0),
            -(lec.created_at.timestamp() if lec.created_at else 0),
        ),
    )
    return [_serialize(lec) for lec in lectures]


@router.post("/courses/{course_id}/lectures", response_model=LectureOut, status_code=201)
def create_lecture(
    course_id: int,
    payload: LectureCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new Lecture under a course (owner-only).

    Optional file attachments are validated for ownership — you can't link
    someone else's UserDocument as a recording / notes file.
    """
    course = _ensure_course_owner(course_id, current_user, db)

    _validate_user_doc(payload.recording_user_document_id, current_user, db)
    _validate_user_doc(payload.notes_user_document_id,     current_user, db)

    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Title cannot be empty")

    lec = Lecture(
        course_id=course.id,
        community_id=course.community_id,
        organization_id=course.organization_id,
        title=payload.title.strip(),
        lecture_date=payload.lecture_date,
        manual_summary=payload.manual_summary,
        recording_user_document_id=payload.recording_user_document_id,
        notes_user_document_id=payload.notes_user_document_id,
    )
    db.add(lec)
    db.commit()
    db.refresh(lec)
    return _serialize(lec)


@router.get("/lectures/{lecture_id}", response_model=LectureOut)
def get_lecture(
    lecture_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    _ensure_course_readable(lec.course_id, current_user, db)
    return _serialize(lec)


@router.put("/lectures/{lecture_id}", response_model=LectureOut)
def update_lecture(
    lecture_id: int,
    payload: LectureUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Partial update. Owner-only.

    Pydantic distinguishes "field absent" from "field present with value
    null" via `model_fields_set`. We use that to tell "leave alone" apart
    from "explicit clear" for the two attachment FKs and for `lecture_date`.
    """
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    _ensure_course_owner(lec.course_id, current_user, db)

    sent = payload.model_fields_set

    if "title" in sent and payload.title is not None:
        if not payload.title.strip():
            raise HTTPException(status_code=422, detail="Title cannot be empty")
        lec.title = payload.title.strip()
    if "lecture_date" in sent:
        lec.lecture_date = payload.lecture_date
    if "manual_summary" in sent:
        lec.manual_summary = payload.manual_summary
    if "recording_user_document_id" in sent:
        _validate_user_doc(payload.recording_user_document_id, current_user, db)
        lec.recording_user_document_id = payload.recording_user_document_id
    if "notes_user_document_id" in sent:
        _validate_user_doc(payload.notes_user_document_id, current_user, db)
        lec.notes_user_document_id = payload.notes_user_document_id

    db.commit()
    db.refresh(lec)
    return _serialize(lec)


@router.delete("/lectures/{lecture_id}", status_code=204)
def delete_lecture(
    lecture_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a lecture (owner-only). Attachments are *not* deleted from the
    library — only the lecture row goes away. The user can re-link the same
    UserDocument to a different lecture if they want."""
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    _ensure_course_owner(lec.course_id, current_user, db)
    db.delete(lec)
    db.commit()
