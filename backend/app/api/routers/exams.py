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
    Course, CourseLecturer, CourseMembership, CourseQuestionType, CourseTopic,
    Exam, ExamQuestion, User, UserDocument,
    exam_question_topics,
)
from app.services.document_service import extract_text
from app.services.exam_processor import process_exam
from app.services.llm_json import LLMJsonError, user_message_for
from app.services.permissions import (
    ExamCapabilities, Scope, gate_or_403_shadow_404,
)

router = APIRouter(tags=["exams"])
log = logging.getLogger(__name__)


# ── Schemas ────────────────────────────────────────────────────────────────

class ExamCreateRequest(BaseModel):
    """Attach an existing UserDocument as an exam in this course.

    The doc must already be in the caller's library (use the standard
    /api/v1/documents/ upload first to get a user_document_id).
    `has_solutions` must reflect what the source PDF actually contains —
    the AI extractor will also flip this true if it sees inline solutions.

    Metadata fields (year / semester / moed / exam_type) are independent.
    Per the user spec they must NOT be concatenated. All four are optional
    on the request — when the user leaves a field blank, the AI extractor
    fills it in (when confident) during the BackgroundTask pass.
    """
    user_document_id: int
    title:            str
    year:             Optional[int] = None
    semester:         Optional[str] = None    # 'Fall' / 'Spring' / 'Summer' / 'Other'
    moed:             Optional[str] = None    # 'A' / 'B' / 'C' / 'D' / 'Special'
    exam_type:        Optional[str] = None    # 'midterm' / 'final' / 'quiz' / 'practice' / 'other'
    has_solutions:    bool          = False
    lecturer_ids:     list[int]     = []      # FK→course_lecturers, must belong to this course


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


class TopicStatOut(BaseModel):
    """One row in the per-course topic histogram."""
    model_config = ConfigDict(from_attributes=True)
    id:             int
    name:           str
    source:         str    # 'syllabus' | 'lecture' | 'exam_inferred'
    question_count: int    # how many questions across the course are tagged with this
    exam_count:     int    # how many distinct exams contain it


class QuestionTypeStatOut(BaseModel):
    """One row in the per-course question-type histogram."""
    model_config = ConfigDict(from_attributes=True)
    id:             int
    name:           str
    source:         str    # 'syllabus' | 'inferred'
    question_count: int
    exam_count:     int


class ExamStatsOut(BaseModel):
    """Aggregated stats consumed by the Exams tab's stats header.

    Both lists are sorted by `question_count` descending. The frontend
    decides how many to show in the chart vs. the "View all" expander.
    """
    topics:               list[TopicStatOut]
    question_types:       list[QuestionTypeStatOut]
    difficulty_buckets:   list[int]    # 5 entries: easy → hard
    exam_count_processed: int          # number of completed exams these stats reflect


class ExamCardOut(BaseModel):
    """Compact shape for the course-scoped exam list view."""
    model_config = ConfigDict(from_attributes=True)
    id:                    int
    title:                 str
    year:                  Optional[int] = None
    # Three independent metadata axes — never concatenate.
    semester:              Optional[str] = None
    moed:                  Optional[str] = None
    exam_type:             Optional[str] = None
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
    """Caller must own the course (legacy helper kept for retry_exam_processing
    which is not part of the Phase-2 admin matrix yet).

    The Phase-2 write routes — create_course_exam, delete_exam — use
    `_get_course_or_404` + `gate_or_403_shadow_404` instead, so non-owner
    admins (course_admin / community_admin / org_admin / super_user) can
    pass when the flag is on without 404'ing them in shadow mode.
    """
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.owner_id == user.id)
        .first()
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


def _get_course_or_404(course_id: int, db: Session) -> Course:
    """Existence-only fetch. Pair with `gate_or_403_shadow_404`."""
    course = db.query(Course).filter(Course.id == course_id).first()
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
        moed=exam.moed,
        exam_type=exam.exam_type,
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

@router.get("/courses/{course_id}/exam-stats", response_model=ExamStatsOut)
def get_course_exam_stats(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregated topic / question-type / difficulty stats for a course.

    Only counts questions that belong to **completed** exams — in-flight
    or failed exams don't contribute to the visualisations (and their
    auto-inferred topics/types are still listed in the taxonomy with
    counts of 0 if the user wants the full picture).

    The endpoint exists so the polling list call doesn't have to ship
    every question's tags every 5 seconds; the stats header fetches this
    separately on tab open and after a successful upload.
    """
    from sqlalchemy import distinct, func

    _ensure_course_readable(course_id, current_user, db)

    # ── Topic histogram ─────────────────────────────────────────────────
    # Joined through exam_question_topics → exam_questions → exams so we can
    # restrict to completed-status exams only. COUNT(DISTINCT exam.id) gives
    # us the per-topic exam reach; COUNT(*) gives the question reach.
    topic_rows = (
        db.query(
            CourseTopic.id,
            CourseTopic.name,
            CourseTopic.source,
            func.count(ExamQuestion.id).label("question_count"),
            func.count(distinct(Exam.id)).label("exam_count"),
        )
        .outerjoin(exam_question_topics,
                   exam_question_topics.c.topic_id == CourseTopic.id)
        .outerjoin(ExamQuestion,
                   ExamQuestion.id == exam_question_topics.c.question_id)
        .outerjoin(Exam,
                   (Exam.id == ExamQuestion.exam_id) & (Exam.processing_status == "completed"))
        .filter(CourseTopic.course_id == course_id)
        .group_by(CourseTopic.id, CourseTopic.name, CourseTopic.source)
        .order_by(func.count(ExamQuestion.id).desc(), CourseTopic.name)
        .all()
    )

    # ── Question-type histogram ─────────────────────────────────────────
    type_rows = (
        db.query(
            CourseQuestionType.id,
            CourseQuestionType.name,
            CourseQuestionType.source,
            func.count(ExamQuestion.id).label("question_count"),
            func.count(distinct(Exam.id)).label("exam_count"),
        )
        .outerjoin(ExamQuestion,
                   ExamQuestion.question_type_id == CourseQuestionType.id)
        .outerjoin(Exam,
                   (Exam.id == ExamQuestion.exam_id) & (Exam.processing_status == "completed"))
        .filter(CourseQuestionType.course_id == course_id)
        .group_by(CourseQuestionType.id, CourseQuestionType.name, CourseQuestionType.source)
        .order_by(func.count(ExamQuestion.id).desc(), CourseQuestionType.name)
        .all()
    )

    # ── Difficulty histogram (5 buckets across completed exams) ─────────
    completed_exams = (
        db.query(Exam)
        .filter(
            Exam.course_id == course_id,
            Exam.processing_status == "completed",
        )
        .all()
    )
    buckets = [0, 0, 0, 0, 0]
    for exam in completed_exams:
        if exam.aggregate_difficulty is None:
            continue
        idx = min(4, max(0, int(exam.aggregate_difficulty * 5)))
        buckets[idx] += 1

    return ExamStatsOut(
        topics=[
            TopicStatOut(
                id=row.id, name=row.name, source=row.source,
                question_count=row.question_count or 0,
                exam_count=row.exam_count or 0,
            )
            for row in topic_rows
        ],
        question_types=[
            QuestionTypeStatOut(
                id=row.id, name=row.name, source=row.source,
                question_count=row.question_count or 0,
                exam_count=row.exam_count or 0,
            )
            for row in type_rows
        ],
        difficulty_buckets=buckets,
        exam_count_processed=len(completed_exams),
    )


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
    # Existence-only fetch + shadow-404 gate so non-owner admins (per the
    # Phase-2 capability matrix) actually reach the role-based check when
    # the flag flips on. With the flag off, denied callers still see 404.
    course = _get_course_or_404(course_id, db)

    gate_or_403_shadow_404(
        current_user, ExamCapabilities.upload_exam,
        Scope.course(course.id), db,
        owner_id=course.owner_id,
        not_found_detail="Course not found",
    )

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

    # Build the exam row. community_id / organization_id are NOT NULL on
    # the Exam model after the Phase-1 migration; denormalize them from
    # the parent course so the INSERT doesn't violate the constraint.
    exam = Exam(
        course_id=course_id,
        community_id=course.community_id,
        organization_id=course.organization_id,
        title=payload.title,
        year=payload.year,
        semester=payload.semester,
        moed=payload.moed,
        exam_type=payload.exam_type,
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

    # Existence-only fetch + shadow-404 gate (see create_course_exam).
    course = _get_course_or_404(exam.course_id, db)

    gate_or_403_shadow_404(
        current_user, ExamCapabilities.delete_exam,
        Scope.course(exam.course_id), db,
        owner_id=course.owner_id,
        not_found_detail="Exam not found",
    )

    db.delete(exam)
    db.commit()
