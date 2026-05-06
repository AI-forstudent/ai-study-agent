"""
app/api/routers/exams.py
─────────────────────────
Exam CRUD + processing endpoints.

The processing pipeline (extraction → embedding → tagging → difficulty) lives
in `services/exam_processor.py`. This router just exposes it via REST.

Mounted at /api/v1 (the routes themselves are course- and exam-scoped:
  POST   /api/v1/courses/{course_id}/exams       — attach a UserDocument
                                                    as an exam and process it.
  GET    /api/v1/courses/{course_id}/exams       — list exams in a course.
  GET    /api/v1/exams/{id}                      — exam detail incl. questions.
  DELETE /api/v1/exams/{id}                      — owner-only delete.
).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session, selectinload

from app.api.routers.auth import get_current_user
from app.core.database import SessionLocal, get_db
from app.models.domain import (
    Course, CourseLecturer, CourseMembership, Exam, ExamQuestion,
    User, UserDocument,
)
from app.services.document_service import extract_text
from app.services.exam_processor import process_exam
from app.services.llm_json import LLMJsonError, user_message_for

router = APIRouter(tags=["exams"])
log = logging.getLogger(__name__)


# ── Schemas ────────────────────────────────────────────────────────────────

class ExamCreateRequest(BaseModel):
    """Attach an existing UserDocument as an exam in this course.

    The doc must already be in the caller's library (use the standard
    /api/v1/documents/ upload first to get a user_document_id).
    `has_solutions` must reflect what the source PDF actually contains —
    the AI extractor will also flip this true if it sees inline solutions.
    """
    user_document_id: int
    title:            str
    year:             Optional[int] = None
    semester:         Optional[str] = None
    has_solutions:    bool          = False
    lecturer_ids:     list[int]     = []   # FK→course_lecturers, must belong to this course


class TopicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:   int
    name: str


class QuestionTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:   int
    name: str


class LecturerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:    int
    name:  str
    role:  str


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                  int
    question_number:     str
    question_text:       str
    page_number:         Optional[int] = None
    question_type:       Optional[QuestionTypeOut] = None
    topics:              list[TopicOut] = []
    difficulty_score:    Optional[float] = None
    reference_solution:  Optional[str] = None


class ExamCardOut(BaseModel):
    """Compact shape for the course-scoped exam list view."""
    model_config = ConfigDict(from_attributes=True)
    id:                    int
    title:                 str
    year:                  Optional[int] = None
    semester:              Optional[str] = None
    has_solutions:         bool
    aggregate_difficulty:  Optional[float] = None
    question_count:        int = 0
    topics:                list[TopicOut] = []
    lecturers:             list[LecturerOut] = []
    # Async processing state — frontend polls the list while any exam
    # is 'pending' or 'processing', and surfaces a Retry button on 'failed'.
    processing_status:     str = "pending"   # 'pending' | 'processing' | 'completed' | 'failed'
    processing_error:      Optional[str] = None
    processed_at:          Optional[datetime] = None
    created_at:            datetime


class ExamDetailOut(ExamCardOut):
    """Full exam shape returned by GET /exams/{id}."""
    questions: list[QuestionOut] = []


# ── Helpers ────────────────────────────────────────────────────────────────

def _ensure_course_owner(course_id: int, user: User, db: Session) -> Course:
    """Caller must own the course to upload/delete exams.

    Read access via `_ensure_course_readable` is more permissive (members +
    public courses), but mutations are owner-only — admins/students should
    not pollute the exam database with their own files.
    """
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


def _aggregate_topics_for_exam(exam: Exam) -> list[TopicOut]:
    """Distinct list of topics across an exam's questions.

    Relies on the caller having pre-loaded `exam.questions` and each
    `question.topics` via `selectinload` — otherwise we'd lazily fire one
    query per question, which is the N+1 problem this whole helper exists
    to avoid in list views.
    """
    seen: dict[int, TopicOut] = {}
    for q in exam.questions:
        for t in q.topics:
            seen[t.id] = TopicOut(id=t.id, name=t.name)
    return list(seen.values())


def _serialize_card(exam: Exam) -> ExamCardOut:
    return ExamCardOut(
        id=exam.id,
        title=exam.title,
        year=exam.year,
        semester=exam.semester,
        has_solutions=exam.has_solutions,
        aggregate_difficulty=exam.aggregate_difficulty,
        # Read the denormalized cache rather than lazy-loading questions.
        # Re-counting via len(exam.questions) here would force a SELECT
        # against the questions table per exam in the list view.
        question_count=exam.question_count,
        topics=_aggregate_topics_for_exam(exam),
        lecturers=[LecturerOut(id=l.id, name=l.name, role=l.role) for l in exam.lecturers],
        processing_status=exam.processing_status,
        processing_error=exam.processing_error,
        processed_at=exam.processed_at,
        created_at=exam.created_at,
    )


def _serialize_question(q: ExamQuestion) -> QuestionOut:
    return QuestionOut(
        id=q.id,
        question_number=q.question_number,
        question_text=q.question_text,
        page_number=q.page_number,
        question_type=(
            QuestionTypeOut(id=q.question_type.id, name=q.question_type.name)
            if q.question_type else None
        ),
        topics=[TopicOut(id=t.id, name=t.name) for t in q.topics],
        difficulty_score=q.difficulty_score,
        reference_solution=q.reference_solution,
    )


def _serialize_detail(exam: Exam) -> ExamDetailOut:
    base = _serialize_card(exam)
    return ExamDetailOut(
        **base.model_dump(),
        questions=sorted(
            (_serialize_question(q) for q in exam.questions),
            key=lambda q: (q.page_number or 0, q.question_number),
        ),
    )


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("/courses/{course_id}/exams", response_model=List[ExamCardOut])
def list_course_exams(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List exams in a course (any reader can see them).

    Hot path — the frontend polls this endpoint every 5 seconds while any
    exam is in `pending`/`processing`. We use `selectinload` to fetch all
    related rows in a fixed number of queries (exams + lecturers + questions
    + question_topics = 4 queries) regardless of how many exams the course
    has, instead of the lazy-loading default that fires N+1 queries per
    relationship per exam.
    """
    _ensure_course_readable(course_id, current_user, db)
    exams = (
        db.query(Exam)
        .options(
            selectinload(Exam.lecturers),
            selectinload(Exam.questions).selectinload(ExamQuestion.topics),
        )
        .filter(Exam.course_id == course_id)
        .order_by(Exam.created_at.desc())
        .all()
    )
    return [_serialize_card(e) for e in exams]


def _run_exam_pipeline(exam_id: int, full_text: str) -> None:
    """BackgroundTask worker that runs the AI extraction outside the request.

    The HTTP handler returns 202 the moment the row is created so the user
    sees their exam in the list immediately (in `processing` state). This
    function then chews through extraction + tagging + difficulty in its own
    DB session — typically 60-150 seconds — and updates the row.

    The exam row is NEVER deleted on failure: the user needs to see the
    failed state, read the error, and either Retry or Delete-and-replace.
    """
    db = SessionLocal()
    try:
        exam = db.query(Exam).filter(Exam.id == exam_id).first()
        if not exam:
            log.warning("[exam_pipeline] exam %d not found at start of processing", exam_id)
            return

        exam.processing_status = "processing"
        exam.processing_error  = None
        db.commit()

        try:
            n_questions = process_exam(exam, full_text, db)
        except LLMJsonError as exc:
            log.warning("[exam_pipeline] exam %d LLMJsonError: %s", exam_id, exc.reason)
            exam.processing_status = "failed"
            exam.processing_error  = user_message_for(exc)
            db.commit()
            return
        except Exception as exc:                     # pragma: no cover
            log.exception("[exam_pipeline] exam %d hit unexpected error", exam_id)
            exam.processing_status = "failed"
            exam.processing_error  = f"Unexpected error: {exc}"
            db.commit()
            return

        if n_questions == 0:
            exam.processing_status = "failed"
            exam.processing_error  = (
                "No questions could be extracted from this document. "
                "It may be image-only (try OCR), in an unusual layout, or not actually an exam."
            )
            db.commit()
            return

        exam.processing_status = "completed"
        exam.processing_error  = None
        exam.processed_at      = datetime.now(timezone.utc)
        db.commit()
        log.info("[exam_pipeline] exam %d completed with %d questions", exam_id, n_questions)
    finally:
        db.close()


@router.post("/courses/{course_id}/exams", response_model=ExamDetailOut, status_code=202)
def create_course_exam(
    course_id: int,
    payload: ExamCreateRequest,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create an exam shell and queue the AI pipeline as a BackgroundTask.

    Returns 202 (Accepted) the moment the row is committed. The actual
    extraction / tagging / difficulty pass runs after the response is sent;
    poll GET /exams/{id} or list the course's exams to watch
    `processing_status` flip from 'pending' → 'processing' → 'completed' / 'failed'.

    Failures keep the exam visible so the user can read the message and
    either click Retry or delete-and-replace.

    Duplicate detection is still TBD — see active_tracker T-015 / T-025.
    """
    course = _ensure_course_owner(course_id, current_user, db)

    # Validate the source doc
    user_doc = (
        db.query(UserDocument)
        .filter(
            UserDocument.id == payload.user_document_id,
            UserDocument.user_id == current_user.id,
        )
        .first()
    )
    if not user_doc:
        raise HTTPException(status_code=404, detail="Source document not found in your library")
    if not user_doc.base_document or not user_doc.base_document.file_path:
        raise HTTPException(status_code=422, detail="Source document has no file on disk")

    # Validate lecturer ids (must belong to this course)
    if payload.lecturer_ids:
        owned_lecturer_ids = {
            l.id for l in db.query(CourseLecturer).filter(CourseLecturer.course_id == course_id).all()
        }
        unknown = [i for i in payload.lecturer_ids if i not in owned_lecturer_ids]
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=f"Lecturer ids {unknown} do not belong to this course",
            )

    # ── Read text now (cheap; pdfplumber / docx) so we can validate the
    # file is readable before queueing the heavy job.
    try:
        pages = extract_text(user_doc.base_document.file_path)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read exam document: {exc}")
    full_text = "\n".join(p["text"] for p in pages)
    if not full_text.strip():
        raise HTTPException(
            status_code=422,
            detail="The document appears to be empty or image-only. OCR support is on the roadmap.",
        )

    # Build the exam row.
    exam = Exam(
        course_id=course_id,
        title=payload.title,
        year=payload.year,
        semester=payload.semester,
        user_document_id=user_doc.id,
        has_solutions=payload.has_solutions,
        processing_status="pending",
    )
    db.add(exam)
    db.flush()  # need exam.id for the lecturer M2M

    if payload.lecturer_ids:
        chosen = (
            db.query(CourseLecturer)
            .filter(CourseLecturer.id.in_(payload.lecturer_ids))
            .all()
        )
        exam.lecturers.extend(chosen)

    db.commit()
    db.refresh(exam)

    # Queue the heavy pipeline. Runs after this response is sent. Uses its
    # own DB session (the request's session is closed by then).
    background.add_task(_run_exam_pipeline, exam.id, full_text)

    return _serialize_detail(exam)


@router.post("/exams/{exam_id}/retry", response_model=ExamDetailOut, status_code=202)
def retry_exam_processing(
    exam_id: int,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-run the AI pipeline on an exam in 'failed' state.

    Resets the row to 'pending', queues a fresh BackgroundTask. Idempotent —
    callers can mash the button without worrying about duplicate runs (an
    in-flight processing run will either finish or get overwritten by this
    one's terminal commit).
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    _ensure_course_owner(exam.course_id, current_user, db)

    if exam.processing_status not in ("failed", "completed"):
        raise HTTPException(
            status_code=409,
            detail="Exam is currently being processed — wait for it to finish before retrying.",
        )

    # Re-read the source text. The user_document might have been deleted in
    # the meantime; fail clearly if so.
    if not exam.user_document_id:
        raise HTTPException(
            status_code=422,
            detail="Source document is no longer attached to this exam — please re-upload.",
        )
    user_doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == exam.user_document_id)
        .first()
    )
    if not user_doc or not user_doc.base_document or not user_doc.base_document.file_path:
        raise HTTPException(
            status_code=422,
            detail="Source document is missing — please re-upload.",
        )
    try:
        pages = extract_text(user_doc.base_document.file_path)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not re-read exam document: {exc}")
    full_text = "\n".join(p["text"] for p in pages)

    # Wipe any previously-extracted questions so the retry starts clean.
    for q in list(exam.questions):
        db.delete(q)
    exam.processing_status     = "pending"
    exam.processing_error      = None
    exam.processed_at          = None
    exam.aggregate_difficulty  = None
    exam.question_count        = 0
    db.commit()
    db.refresh(exam)

    background.add_task(_run_exam_pipeline, exam.id, full_text)
    return _serialize_detail(exam)


@router.get("/exams/{exam_id}", response_model=ExamDetailOut)
def get_exam(
    exam_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a single exam plus all extracted questions, tags, and stats.

    Read access follows the parent course — owner / member / public.

    Same `selectinload` pattern as the list endpoint: question_type and
    topics are batch-loaded for the question grid, lecturers for the
    header. ~4 queries total instead of N+1 over question count.
    """
    exam = (
        db.query(Exam)
        .options(
            selectinload(Exam.lecturers),
            selectinload(Exam.questions).selectinload(ExamQuestion.topics),
            selectinload(Exam.questions).selectinload(ExamQuestion.question_type),
        )
        .filter(Exam.id == exam_id)
        .first()
    )
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    _ensure_course_readable(exam.course_id, current_user, db)
    return _serialize_detail(exam)


@router.delete("/exams/{exam_id}", status_code=204)
def delete_exam(
    exam_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an exam (owner-only). Questions cascade-delete via the FK."""
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    _ensure_course_owner(exam.course_id, current_user, db)
    db.delete(exam)
    db.commit()
