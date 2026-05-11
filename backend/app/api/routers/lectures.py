"""
app/api/routers/lectures.py
───────────────────────────
Lecture CRUD inside a Course (F-031 + F-033 + F-034 multi-resource).

A Lecture owns four LISTS of sub-resources, plus a single cached unified
summary:
  • lecturer_summaries  — one per lecturer × version
  • student_summaries   — one per peer / self
  • recordings          — UserDocument FKs, audio
  • notes               — UserDocument FKs, PDFs / images

Mounted at /api/v1 — actual paths live under /courses/{course_id}/lectures
and /lectures/{id}, mirroring the exams router.

Permissions
───────────
• Read access mirrors course read access (owner / member / public).
• Mutations (create / update / delete / generate-summary / sub-resource
  CRUD) are owner-only.
• Phase-1 multi-tenant scope columns (community_id, organization_id) are
  denormalized from the parent course at insert.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session, selectinload

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import (
    Course, CourseLecturer, CourseMembership, Lecture,
    LectureLecturerSummary, LectureNote, LectureRecording,
    LectureStudentSummary, Message, Thread, User, UserDocument,
)
from app.services.lecture_summary_generator import (
    process_unified_summary_background,
)

router = APIRouter(tags=["lectures"])
log = logging.getLogger(__name__)


# ── Sub-resource schemas (used inside LectureOut + their own endpoints) ────

class AttachedDocOut(BaseModel):
    """Compact projection of a UserDocument for lecture display."""
    model_config = ConfigDict(from_attributes=True)
    id:        int
    title:     str
    file_path: Optional[str] = None
    doc_type:  str = "GENERAL"


class LectureLecturerSummaryOut(BaseModel):
    """F-035: summary is a PDF; `file_path` + `doc_type` come from the
    linked UserDocument so the frontend can render it directly."""
    model_config = ConfigDict(from_attributes=True)
    id:               int
    lecture_id:       int
    lecturer_id:      Optional[int] = None
    lecturer_name:    Optional[str] = None     # denormalized for the sidebar
    user_document_id: Optional[int] = None
    file_path:        Optional[str] = None
    doc_type:         str           = "GENERAL"
    title:            str
    created_at:       Optional[str] = None
    updated_at:       Optional[str] = None


class LectureLecturerSummaryCreate(BaseModel):
    """F-035: `user_document_id` is required — the uploaded PDF.
    `lecturer_id` null → auto-resolve (single lecturer or syllabus head)."""
    user_document_id: int
    title:            Optional[str] = None
    lecturer_id:      Optional[int] = None


class LectureLecturerSummaryUpdate(BaseModel):
    title:            Optional[str] = None
    user_document_id: Optional[int] = None
    lecturer_id:      Optional[int] = None


class LectureStudentSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:               int
    lecture_id:       int
    user_document_id: Optional[int] = None
    file_path:        Optional[str] = None
    doc_type:         str           = "GENERAL"
    title:            str
    created_at:       Optional[str] = None
    updated_at:       Optional[str] = None


class LectureStudentSummaryCreate(BaseModel):
    user_document_id: int
    title:            Optional[str] = None


class LectureStudentSummaryUpdate(BaseModel):
    title:            Optional[str] = None
    user_document_id: Optional[int] = None


class LectureAttachmentOut(BaseModel):
    """Shared shape for LectureRecording / LectureNote rows in API output."""
    model_config = ConfigDict(from_attributes=True)
    id:               int
    lecture_id:       int
    user_document_id: Optional[int] = None
    title:            str
    file_path:        Optional[str] = None
    doc_type:         str = "GENERAL"
    created_at:       Optional[str] = None


class LectureAttachmentCreate(BaseModel):
    user_document_id: int                    # required — must reference a doc the caller owns
    title:            Optional[str] = None


class LectureAttachmentUpdate(BaseModel):
    user_document_id: Optional[int] = None
    title:            Optional[str] = None


# ── Top-level Lecture schemas ─────────────────────────────────────────────

class LectureCreateRequest(BaseModel):
    title:        str
    lecture_date: Optional[date] = None


class LectureUpdateRequest(BaseModel):
    title:        Optional[str]  = None
    lecture_date: Optional[date] = None


class LectureOut(BaseModel):
    """Full nested lecture shape used by both the list and detail endpoints.

    Embeds the four sub-resource lists so the frontend can render the
    accordion from a single GET. List view stays cheap because sub-resource
    tables are small per-lecture (~10 rows max).
    """
    model_config = ConfigDict(from_attributes=True)
    id:                          int
    course_id:                   int
    title:                       str
    lecture_date:                Optional[date] = None
    unified_summary:             Optional[str]  = None
    unified_summary_processing:  bool           = False
    unified_summary_error:       Optional[str]  = None
    unified_summary_generated_at: Optional[str] = None
    # F-036: the rendered PDF UserDocument for the unified summary, so the
    # lecture viewer can open it inside MainWorkspace like any other doc.
    unified_summary_document_id: Optional[int]  = None
    unified_summary_file_path:   Optional[str]  = None
    unified_summary_doc_type:    Optional[str]  = None
    lecturer_summaries:          List[LectureLecturerSummaryOut] = []
    student_summaries:           List[LectureStudentSummaryOut]  = []
    recordings:                  List[LectureAttachmentOut]      = []
    notes:                       List[LectureAttachmentOut]      = []
    created_at:                  Optional[str]  = None
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


def _load_lecture_with_children(lecture_id: int, db: Session) -> Optional[Lecture]:
    """Single-query eager load so LectureOut is filled without an N+1."""
    return (
        db.query(Lecture)
        .options(
            selectinload(Lecture.lecturer_summaries).selectinload(LectureLecturerSummary.lecturer),
            selectinload(Lecture.lecturer_summaries).selectinload(LectureLecturerSummary.user_doc).selectinload(UserDocument.base_document),
            selectinload(Lecture.student_summaries).selectinload(LectureStudentSummary.user_doc).selectinload(UserDocument.base_document),
            selectinload(Lecture.recordings).selectinload(LectureRecording.user_doc).selectinload(UserDocument.base_document),
            selectinload(Lecture.notes).selectinload(LectureNote.user_doc).selectinload(UserDocument.base_document),
            selectinload(Lecture.unified_summary_doc).selectinload(UserDocument.base_document),
        )
        .filter(Lecture.id == lecture_id)
        .first()
    )


# ── Serializers ───────────────────────────────────────────────────────────

def _serialize_lecturer_summary(s: LectureLecturerSummary) -> LectureLecturerSummaryOut:
    ud = s.user_doc
    bd = ud.base_document if ud else None
    return LectureLecturerSummaryOut(
        id=s.id,
        lecture_id=s.lecture_id,
        lecturer_id=s.lecturer_id,
        lecturer_name=s.lecturer.name if s.lecturer else None,
        user_document_id=s.user_document_id,
        file_path=bd.file_path if bd else None,
        doc_type=bd.doc_type if bd else "GENERAL",
        title=s.title or "סיכום מרצה",
        created_at=s.created_at.isoformat() if s.created_at else None,
        updated_at=s.updated_at.isoformat() if s.updated_at else None,
    )


def _serialize_student_summary(s: LectureStudentSummary) -> LectureStudentSummaryOut:
    ud = s.user_doc
    bd = ud.base_document if ud else None
    return LectureStudentSummaryOut(
        id=s.id,
        lecture_id=s.lecture_id,
        user_document_id=s.user_document_id,
        file_path=bd.file_path if bd else None,
        doc_type=bd.doc_type if bd else "GENERAL",
        title=s.title or "סיכום תלמיד",
        created_at=s.created_at.isoformat() if s.created_at else None,
        updated_at=s.updated_at.isoformat() if s.updated_at else None,
    )


def _serialize_attachment(att) -> LectureAttachmentOut:
    """Shared serializer for LectureRecording and LectureNote — same shape."""
    ud = att.user_doc
    bd = ud.base_document if ud else None
    default_title = "הקלטה" if isinstance(att, LectureRecording) else "הערות"
    return LectureAttachmentOut(
        id=att.id,
        lecture_id=att.lecture_id,
        user_document_id=att.user_document_id,
        title=att.title or default_title,
        file_path=bd.file_path if bd else None,
        doc_type=bd.doc_type if bd else "GENERAL",
        created_at=att.created_at.isoformat() if att.created_at else None,
    )


def _serialize(lec: Lecture) -> LectureOut:
    unified_ud = lec.unified_summary_doc
    unified_bd = unified_ud.base_document if unified_ud else None
    return LectureOut(
        id=lec.id,
        course_id=lec.course_id,
        title=lec.title,
        lecture_date=lec.lecture_date,
        unified_summary=lec.unified_summary,
        unified_summary_processing=bool(lec.unified_summary_processing),
        unified_summary_error=lec.unified_summary_error,
        unified_summary_generated_at=(
            lec.unified_summary_generated_at.isoformat()
            if lec.unified_summary_generated_at else None
        ),
        unified_summary_document_id=lec.unified_summary_document_id,
        unified_summary_file_path=unified_bd.file_path if unified_bd else None,
        unified_summary_doc_type=unified_bd.doc_type if unified_bd else None,
        lecturer_summaries=[_serialize_lecturer_summary(s) for s in (lec.lecturer_summaries or [])],
        student_summaries=[_serialize_student_summary(s) for s in (lec.student_summaries or [])],
        recordings=[_serialize_attachment(r) for r in (lec.recordings or [])],
        notes=[_serialize_attachment(n) for n in (lec.notes or [])],
        created_at=lec.created_at.isoformat() if lec.created_at else None,
        updated_at=lec.updated_at.isoformat() if lec.updated_at else None,
    )


def _load_attachment_for_response(model_cls, row_id: int, db: Session):
    return (
        db.query(model_cls)
        .options(selectinload(model_cls.user_doc).selectinload(UserDocument.base_document))
        .filter(model_cls.id == row_id)
        .first()
    )


# ══════════════════════════════════════════════════════════════════════════════
# Lecture top-level CRUD
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/courses/{course_id}/lectures", response_model=List[LectureOut])
def list_course_lectures(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all lectures in a course (any reader). Newest first."""
    _ensure_course_readable(course_id, current_user, db)
    lectures = (
        db.query(Lecture)
        .options(
            selectinload(Lecture.lecturer_summaries).selectinload(LectureLecturerSummary.lecturer),
            selectinload(Lecture.lecturer_summaries).selectinload(LectureLecturerSummary.user_doc).selectinload(UserDocument.base_document),
            selectinload(Lecture.student_summaries).selectinload(LectureStudentSummary.user_doc).selectinload(UserDocument.base_document),
            selectinload(Lecture.recordings).selectinload(LectureRecording.user_doc).selectinload(UserDocument.base_document),
            selectinload(Lecture.notes).selectinload(LectureNote.user_doc).selectinload(UserDocument.base_document),
            selectinload(Lecture.unified_summary_doc).selectinload(UserDocument.base_document),
        )
        .filter(Lecture.course_id == course_id)
        .all()
    )
    lectures.sort(
        key=lambda lec: (
            lec.lecture_date is None,
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
    """Create a new Lecture under a course (owner-only). Sub-resources are
    added through their dedicated endpoints below."""
    course = _ensure_course_owner(course_id, current_user, db)

    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Title cannot be empty")

    lec = Lecture(
        course_id=course.id,
        community_id=course.community_id,
        organization_id=course.organization_id,
        title=payload.title.strip(),
        lecture_date=payload.lecture_date,
    )
    db.add(lec)
    db.commit()
    return _serialize(_load_lecture_with_children(lec.id, db))


@router.get("/lectures/{lecture_id}", response_model=LectureOut)
def get_lecture(
    lecture_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lec = _load_lecture_with_children(lecture_id, db)
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
    """Partial update of the top-level fields (title / date)."""
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

    db.commit()
    return _serialize(_load_lecture_with_children(lec.id, db))


@router.delete("/lectures/{lecture_id}", status_code=204)
def delete_lecture(
    lecture_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a lecture (owner-only). Sub-resource rows cascade. The
    UserDocuments behind recordings / notes are NOT deleted from the
    library — only the lecture's join rows."""
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    _ensure_course_owner(lec.course_id, current_user, db)
    db.delete(lec)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# Unified summary (F-033 — body now carries lecturer_summary_id)
# ══════════════════════════════════════════════════════════════════════════════

class UnifiedSummaryRequest(BaseModel):
    """Body for POST /lectures/{id}/unified-summary.

    `lecturer_summary_id` lets the caller pick which lecturer summary
    feeds the skill. When None and exactly one lecturer summary exists,
    that one is picked automatically. When None and multiple exist, the
    request is rejected with 422 (the UI is expected to surface a picker)."""
    lecturer_summary_id: Optional[int] = None


@router.post(
    "/lectures/{lecture_id}/unified-summary",
    response_model=LectureOut,
    status_code=202,
)
def generate_unified_summary(
    lecture_id: int,
    payload: UnifiedSummaryRequest,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Kick off unified-summary generation (owner-only, async).

    Returns 202 immediately with the row flipped to processing=True. The
    actual LLM call runs in a BackgroundTask; the frontend polls
    `GET /lectures/{id}` while `unified_summary_processing` is true.
    """
    lec = _load_lecture_with_children(lecture_id, db)
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    _ensure_course_owner(lec.course_id, current_user, db)

    if lec.unified_summary_processing:
        raise HTTPException(
            status_code=409,
            detail="Generation already in flight for this lecture.",
        )

    summaries = list(lec.lecturer_summaries or [])
    if not summaries:
        raise HTTPException(
            status_code=422,
            detail="צריך לפחות סיכום מרצה אחד לפני יצירת הסיכום המאוחד.",
        )

    chosen_id: Optional[int] = payload.lecturer_summary_id
    if chosen_id is None:
        if len(summaries) == 1:
            chosen_id = summaries[0].id
        else:
            raise HTTPException(
                status_code=422,
                detail="יש כמה סיכומי מרצה — בחר איזה מהם ישמש כקלט.",
            )
    chosen = next((s for s in summaries if s.id == chosen_id), None)
    if not chosen or not chosen.user_document_id:
        raise HTTPException(
            status_code=422,
            detail="הסיכום הנבחר ריק או לא נמצא.",
        )

    lec.unified_summary_processing = True
    lec.unified_summary_error = None
    db.commit()

    background.add_task(
        process_unified_summary_background, lec.id, current_user.id, chosen.id,
    )
    return _serialize(_load_lecture_with_children(lec.id, db))


# ══════════════════════════════════════════════════════════════════════════════
# Lecturer-summary sub-resource CRUD
# ══════════════════════════════════════════════════════════════════════════════

def _resolve_default_lecturer(course_id: int, db: Session) -> Optional[CourseLecturer]:
    """Pick a sane default lecturer for a new lecturer-summary row.

    Priority:
      1. The only lecturer in the course (if exactly one exists).
      2. A 'manager-y' role (course_manager / manager / professor / head).
      3. Otherwise None — the caller picks explicitly.
    """
    lecturers = (
        db.query(CourseLecturer)
        .filter(CourseLecturer.course_id == course_id)
        .order_by(CourseLecturer.id.asc())
        .all()
    )
    if not lecturers:
        return None
    if len(lecturers) == 1:
        return lecturers[0]
    for cl in lecturers:
        if cl.role and cl.role.lower() in ("course_manager", "manager", "professor", "head"):
            return cl
    return lecturers[0]


@router.post(
    "/lectures/{lecture_id}/lecturer-summaries",
    response_model=LectureLecturerSummaryOut,
    status_code=201,
)
def create_lecturer_summary(
    lecture_id: int,
    payload: LectureLecturerSummaryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    _ensure_course_owner(lec.course_id, current_user, db)

    lecturer_id = payload.lecturer_id
    if lecturer_id is None:
        default = _resolve_default_lecturer(lec.course_id, db)
        lecturer_id = default.id if default else None
    else:
        cl = (
            db.query(CourseLecturer)
            .filter(CourseLecturer.id == lecturer_id, CourseLecturer.course_id == lec.course_id)
            .first()
        )
        if not cl:
            raise HTTPException(status_code=404, detail="Lecturer not in this course")

    ud = _validate_user_doc(payload.user_document_id, current_user, db)
    if not ud:
        raise HTTPException(status_code=422, detail="user_document_id is required.")

    row = LectureLecturerSummary(
        lecture_id=lec.id,
        lecturer_id=lecturer_id,
        user_document_id=ud.id,
        title=(payload.title or ud.custom_title or "סיכום מרצה").strip() or "סיכום מרצה",
    )
    db.add(row)
    db.commit()
    row = (
        db.query(LectureLecturerSummary)
        .options(
            selectinload(LectureLecturerSummary.lecturer),
            selectinload(LectureLecturerSummary.user_doc).selectinload(UserDocument.base_document),
        )
        .filter(LectureLecturerSummary.id == row.id)
        .first()
    )
    return _serialize_lecturer_summary(row)


@router.put(
    "/lectures/{lecture_id}/lecturer-summaries/{summary_id}",
    response_model=LectureLecturerSummaryOut,
)
def update_lecturer_summary(
    lecture_id: int,
    summary_id: int,
    payload: LectureLecturerSummaryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(LectureLecturerSummary)
        .filter(
            LectureLecturerSummary.id == summary_id,
            LectureLecturerSummary.lecture_id == lecture_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Lecturer summary not found")
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    _ensure_course_owner(lec.course_id, current_user, db)

    sent = payload.model_fields_set
    if "title" in sent and payload.title is not None:
        row.title = payload.title.strip() or row.title
    if "user_document_id" in sent:
        ud = _validate_user_doc(payload.user_document_id, current_user, db)
        row.user_document_id = ud.id if ud else None
    if "lecturer_id" in sent:
        if payload.lecturer_id is not None:
            cl = (
                db.query(CourseLecturer)
                .filter(CourseLecturer.id == payload.lecturer_id, CourseLecturer.course_id == lec.course_id)
                .first()
            )
            if not cl:
                raise HTTPException(status_code=404, detail="Lecturer not in this course")
        row.lecturer_id = payload.lecturer_id

    db.commit()
    row = (
        db.query(LectureLecturerSummary)
        .options(
            selectinload(LectureLecturerSummary.lecturer),
            selectinload(LectureLecturerSummary.user_doc).selectinload(UserDocument.base_document),
        )
        .filter(LectureLecturerSummary.id == row.id)
        .first()
    )
    return _serialize_lecturer_summary(row)


@router.delete(
    "/lectures/{lecture_id}/lecturer-summaries/{summary_id}",
    status_code=204,
)
def delete_lecturer_summary(
    lecture_id: int,
    summary_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(LectureLecturerSummary)
        .filter(
            LectureLecturerSummary.id == summary_id,
            LectureLecturerSummary.lecture_id == lecture_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Lecturer summary not found")
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    _ensure_course_owner(lec.course_id, current_user, db)
    db.delete(row)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# Student-summary sub-resource CRUD
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/lectures/{lecture_id}/student-summaries",
    response_model=LectureStudentSummaryOut,
    status_code=201,
)
def create_student_summary(
    lecture_id: int,
    payload: LectureStudentSummaryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    _ensure_course_owner(lec.course_id, current_user, db)

    ud = _validate_user_doc(payload.user_document_id, current_user, db)
    if not ud:
        raise HTTPException(status_code=422, detail="user_document_id is required.")

    row = LectureStudentSummary(
        lecture_id=lec.id,
        user_document_id=ud.id,
        title=(payload.title or ud.custom_title or "סיכום תלמיד").strip() or "סיכום תלמיד",
    )
    db.add(row)
    db.commit()
    row = (
        db.query(LectureStudentSummary)
        .options(selectinload(LectureStudentSummary.user_doc).selectinload(UserDocument.base_document))
        .filter(LectureStudentSummary.id == row.id)
        .first()
    )
    return _serialize_student_summary(row)


@router.put(
    "/lectures/{lecture_id}/student-summaries/{summary_id}",
    response_model=LectureStudentSummaryOut,
)
def update_student_summary(
    lecture_id: int,
    summary_id: int,
    payload: LectureStudentSummaryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(LectureStudentSummary)
        .filter(
            LectureStudentSummary.id == summary_id,
            LectureStudentSummary.lecture_id == lecture_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Student summary not found")
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    _ensure_course_owner(lec.course_id, current_user, db)

    sent = payload.model_fields_set
    if "title" in sent and payload.title is not None:
        row.title = payload.title.strip() or row.title
    if "user_document_id" in sent:
        ud = _validate_user_doc(payload.user_document_id, current_user, db)
        row.user_document_id = ud.id if ud else None

    db.commit()
    row = (
        db.query(LectureStudentSummary)
        .options(selectinload(LectureStudentSummary.user_doc).selectinload(UserDocument.base_document))
        .filter(LectureStudentSummary.id == row.id)
        .first()
    )
    return _serialize_student_summary(row)


@router.delete(
    "/lectures/{lecture_id}/student-summaries/{summary_id}",
    status_code=204,
)
def delete_student_summary(
    lecture_id: int,
    summary_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(LectureStudentSummary)
        .filter(
            LectureStudentSummary.id == summary_id,
            LectureStudentSummary.lecture_id == lecture_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Student summary not found")
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    _ensure_course_owner(lec.course_id, current_user, db)
    db.delete(row)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# Recording sub-resource CRUD
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/lectures/{lecture_id}/recordings",
    response_model=LectureAttachmentOut,
    status_code=201,
)
def create_recording(
    lecture_id: int,
    payload: LectureAttachmentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    _ensure_course_owner(lec.course_id, current_user, db)
    ud = _validate_user_doc(payload.user_document_id, current_user, db)

    row = LectureRecording(
        lecture_id=lec.id,
        user_document_id=ud.id if ud else None,
        title=(payload.title or (ud.custom_title if ud else None) or "הקלטה").strip() or "הקלטה",
    )
    db.add(row)
    db.commit()
    return _serialize_attachment(_load_attachment_for_response(LectureRecording, row.id, db))


@router.put(
    "/lectures/{lecture_id}/recordings/{rec_id}",
    response_model=LectureAttachmentOut,
)
def update_recording(
    lecture_id: int,
    rec_id: int,
    payload: LectureAttachmentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(LectureRecording)
        .filter(LectureRecording.id == rec_id, LectureRecording.lecture_id == lecture_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Recording not found")
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    _ensure_course_owner(lec.course_id, current_user, db)

    sent = payload.model_fields_set
    if "title" in sent and payload.title is not None:
        row.title = payload.title.strip() or row.title
    if "user_document_id" in sent:
        ud = _validate_user_doc(payload.user_document_id, current_user, db)
        row.user_document_id = ud.id if ud else None

    db.commit()
    return _serialize_attachment(_load_attachment_for_response(LectureRecording, row.id, db))


@router.delete(
    "/lectures/{lecture_id}/recordings/{rec_id}",
    status_code=204,
)
def delete_recording(
    lecture_id: int,
    rec_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(LectureRecording)
        .filter(LectureRecording.id == rec_id, LectureRecording.lecture_id == lecture_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Recording not found")
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    _ensure_course_owner(lec.course_id, current_user, db)
    db.delete(row)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# Notes sub-resource CRUD
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/lectures/{lecture_id}/notes",
    response_model=LectureAttachmentOut,
    status_code=201,
)
def create_note(
    lecture_id: int,
    payload: LectureAttachmentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    _ensure_course_owner(lec.course_id, current_user, db)
    ud = _validate_user_doc(payload.user_document_id, current_user, db)

    row = LectureNote(
        lecture_id=lec.id,
        user_document_id=ud.id if ud else None,
        title=(payload.title or (ud.custom_title if ud else None) or "הערות").strip() or "הערות",
    )
    db.add(row)
    db.commit()
    return _serialize_attachment(_load_attachment_for_response(LectureNote, row.id, db))


@router.put(
    "/lectures/{lecture_id}/notes/{note_id}",
    response_model=LectureAttachmentOut,
)
def update_note(
    lecture_id: int,
    note_id: int,
    payload: LectureAttachmentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(LectureNote)
        .filter(LectureNote.id == note_id, LectureNote.lecture_id == lecture_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    _ensure_course_owner(lec.course_id, current_user, db)

    sent = payload.model_fields_set
    if "title" in sent and payload.title is not None:
        row.title = payload.title.strip() or row.title
    if "user_document_id" in sent:
        ud = _validate_user_doc(payload.user_document_id, current_user, db)
        row.user_document_id = ud.id if ud else None

    db.commit()
    return _serialize_attachment(_load_attachment_for_response(LectureNote, row.id, db))


@router.delete(
    "/lectures/{lecture_id}/notes/{note_id}",
    status_code=204,
)
def delete_note(
    lecture_id: int,
    note_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(LectureNote)
        .filter(LectureNote.id == note_id, LectureNote.lecture_id == lecture_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    _ensure_course_owner(lec.course_id, current_user, db)
    db.delete(row)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# Lecture-scoped chat threads (F-033)
# ══════════════════════════════════════════════════════════════════════════════

class LectureThreadMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:         int
    role:       str
    content:    str
    created_at: Optional[str] = None


class LectureThreadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:            int
    title:         Optional[str] = None
    session_title: Optional[str] = None
    emoji:         Optional[str] = None
    created_at:    Optional[str] = None
    messages:      List[LectureThreadMessageOut]


@router.get(
    "/lectures/{lecture_id}/threads",
    response_model=List[LectureThreadOut],
)
def list_lecture_threads(
    lecture_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the caller's chat threads pinned to this lecture, newest first."""
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    _ensure_course_readable(lec.course_id, current_user, db)

    threads: List[Thread] = (
        db.query(Thread)
        .filter(
            Thread.lecture_id == lecture_id,
            Thread.user_id == current_user.id,
            Thread.parent_thread_id.is_(None),
        )
        .order_by(Thread.created_at.desc())
        .all()
    )

    out: List[LectureThreadOut] = []
    for t in threads:
        msgs = (
            db.query(Message)
            .filter(Message.thread_id == t.id)
            .order_by(Message.id.asc())
            .all()
        )
        out.append(LectureThreadOut(
            id=t.id,
            title=t.title,
            session_title=t.session_title,
            emoji=t.emoji,
            created_at=t.created_at.isoformat() if t.created_at else None,
            messages=[
                LectureThreadMessageOut(
                    id=m.id,
                    role=m.role,
                    content=m.content,
                    created_at=m.created_at.isoformat() if m.created_at else None,
                ) for m in msgs
            ],
        ))
    return out
