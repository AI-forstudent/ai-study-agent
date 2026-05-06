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

from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import (
    Course, CourseLecturer, CourseMembership, Exam, ExamQuestion,
    User, UserDocument,
)
from app.services.document_service import extract_text
from app.services.exam_processor import process_exam
from app.services.llm_json import LLMJsonError, user_message_for

router = APIRouter(tags=["exams"])


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
    """Distinct list of topics across an exam's questions."""
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
        question_count=len(exam.questions),
        topics=_aggregate_topics_for_exam(exam),
        lecturers=[LecturerOut(id=l.id, name=l.name, role=l.role) for l in exam.lecturers],
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
    """List exams in a course (any reader can see them)."""
    _ensure_course_readable(course_id, current_user, db)
    exams = (
        db.query(Exam)
        .filter(Exam.course_id == course_id)
        .order_by(Exam.created_at.desc())
        .all()
    )
    return [_serialize_card(e) for e in exams]


@router.post("/courses/{course_id}/exams", response_model=ExamDetailOut, status_code=201)
def create_course_exam(
    course_id: int,
    payload: ExamCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Attach a UserDocument as an exam and run the full processing pipeline.

    Steps the server executes:
      1. Verify course ownership and that the doc lives in the caller's library.
      2. Extract raw text from the PDF/DOCX.
      3. Run `process_exam` → ONE Gemini call to break into questions, batch
         embeddings, ONE small Gemini call per question to tag, and a no-LLM
         difficulty re-calibration across the whole course.
      4. Persist + commit.

    Duplicate detection is intentionally NOT in this commit — see
    active_tracker T-015. Adding the same exam twice currently creates two
    rows; clean them up via DELETE for now.
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

    # Build the exam row before processing so questions can FK back to it.
    exam = Exam(
        course_id=course_id,
        title=payload.title,
        year=payload.year,
        semester=payload.semester,
        user_document_id=user_doc.id,
        has_solutions=payload.has_solutions,
    )
    db.add(exam)
    db.flush()  # need exam.id

    # Attach lecturers
    if payload.lecturer_ids:
        chosen = (
            db.query(CourseLecturer)
            .filter(CourseLecturer.id.in_(payload.lecturer_ids))
            .all()
        )
        exam.lecturers.extend(chosen)

    # ── Read text + run the processing pipeline ──────────────────────────
    try:
        pages = extract_text(user_doc.base_document.file_path)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read exam document: {exc}")
    full_text = "\n".join(p["text"] for p in pages)

    try:
        n_questions = process_exam(exam, full_text, db)
    except LLMJsonError as exc:
        # Roll back the empty exam shell so we don't leave a zombie row.
        db.delete(exam)
        db.commit()
        raise HTTPException(status_code=502, detail=user_message_for(exc))
    except Exception as exc:
        db.delete(exam)
        db.commit()
        raise HTTPException(status_code=503, detail=f"Exam processing failed: {exc}")

    if n_questions == 0:
        # Roll the exam back — we have no useful data and a card with zero
        # questions would just confuse the user.
        db.delete(exam)
        db.commit()
        raise HTTPException(
            status_code=422,
            detail="No questions could be extracted from this document.",
        )

    exam.processed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(exam)
    return _serialize_detail(exam)


@router.get("/exams/{exam_id}", response_model=ExamDetailOut)
def get_exam(
    exam_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a single exam plus all extracted questions, tags, and stats.

    Read access follows the parent course — owner / member / public.
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
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
