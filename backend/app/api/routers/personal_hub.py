"""
app/api/routers/personal_hub.py
────────────────────────────────
Track D — Personal Hub & Academic Roadmap API.

Mounted at /api/v1/profile in app/main.py.

Endpoints
─────────
GET  /profile                       — fetch (or auto-create) the authenticated user's profile
PUT  /profile                       — update profile fields
GET    /profile/courses               — list all course records for the user
POST   /profile/courses               — add a new course record
PUT    /profile/courses/{record_id}   — update a course record
DELETE /profile/courses               — wipe all course records (reset)
DELETE /profile/courses/{record_id}   — delete a single course record
GET  /profile/jobs                  — list all job applications
POST /profile/jobs                  — add a new job application
PUT  /profile/jobs/{job_id}         — update a job application
POST /profile/transcript            — parse a PDF transcript and upsert course records
"""

from __future__ import annotations

import io
import json
from typing import List, Optional

import pdfplumber
from bidi.algorithm import get_display
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import (
    AcademicProfile,
    CourseCatalog,
    JobApplication,
    StudentCourseRecord,
    User,
)
from app.schemas.personal_hub import (
    AcademicProfileCreate,
    AcademicProfileResponse,
    AcademicProfileUpdate,
    CourseCatalogCreate,
    CourseCatalogUpdate,
    CourseRecordCreate,
    CourseRecordResponse,
    CourseRecordUpdate,
    CourseResponse,
    JobApplicationCreate,
    JobApplicationResponse,
    JobApplicationUpdate,
    TranscriptUpsertResponse,
)
from app.services.document_service import ask_gemini

router = APIRouter(tags=["personal-hub"])


# ── Internal helpers ───────────────────────────────────────────────────────

def _calculate_gpa(records: list[StudentCourseRecord]) -> Optional[float]:
    """Weighted GPA: sum(grade × credits) / sum(credits) for completed records.
    0-credit and ungraded courses are excluded — they must not dilute the average."""
    completed = [
        r for r in records
        if r.status == "completed"
        and r.grade is not None
        and r.course is not None
        and r.course.credits is not None
        and r.course.credits > 0
    ]
    if not completed:
        return None
    total_weighted = sum(r.grade * r.course.credits for r in completed)
    total_credits  = sum(r.course.credits              for r in completed)
    return round(total_weighted / total_credits, 2) if total_credits > 0 else None


def _profile_response(
    profile: AcademicProfile,
    records: list[StudentCourseRecord],
) -> AcademicProfileResponse:
    """Build the response, injecting the server-computed GPA field."""
    data = AcademicProfileResponse.model_validate(profile)
    data.calculated_gpa = _calculate_gpa(records)
    return data


def _get_or_404(db: Session, model, pk: int, label: str):
    obj = db.get(model, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return obj


# ── Profile ────────────────────────────────────────────────────────────────

@router.get("/", response_model=AcademicProfileResponse)
def get_profile(
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    profile = (
        db.query(AcademicProfile)
        .filter(AcademicProfile.user_id == current_user.id)
        .first()
    )
    if profile is None:
        profile = AcademicProfile(user_id=current_user.id)
        db.add(profile)
        db.commit()
        db.refresh(profile)

    records = (
        db.query(StudentCourseRecord)
        .options(joinedload(StudentCourseRecord.course))
        .filter(StudentCourseRecord.user_id == current_user.id)
        .all()
    )
    return _profile_response(profile, records)


@router.put("/", response_model=AcademicProfileResponse)
def update_profile(
    payload:      AcademicProfileUpdate,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    profile = (
        db.query(AcademicProfile)
        .filter(AcademicProfile.user_id == current_user.id)
        .first()
    )
    if profile is None:
        profile = AcademicProfile(user_id=current_user.id)
        db.add(profile)

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(profile, field, value)

    db.commit()
    db.refresh(profile)

    records = (
        db.query(StudentCourseRecord)
        .options(joinedload(StudentCourseRecord.course))
        .filter(StudentCourseRecord.user_id == current_user.id)
        .all()
    )
    return _profile_response(profile, records)


# ── Courses ────────────────────────────────────────────────────────────────

@router.get("/courses", response_model=List[CourseRecordResponse])
def list_courses(
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    return (
        db.query(StudentCourseRecord)
        .options(joinedload(StudentCourseRecord.course))
        .filter(StudentCourseRecord.user_id == current_user.id)
        .all()
    )


@router.post("/courses", response_model=CourseRecordResponse, status_code=201)
def add_course(
    payload:      CourseRecordCreate,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    _get_or_404(db, CourseCatalog, payload.course_id, "Course")

    record = StudentCourseRecord(
        user_id=current_user.id,
        **payload.model_dump(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    db.refresh(record, attribute_names=["course"])
    return record


@router.put("/courses/{record_id}", response_model=CourseRecordResponse)
def update_course_record(
    record_id:    int,
    payload:      CourseRecordUpdate,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    record = (
        db.query(StudentCourseRecord)
        .filter(
            StudentCourseRecord.id      == record_id,
            StudentCourseRecord.user_id == current_user.id,
        )
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Course record not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(record, field, value)

    db.commit()
    db.refresh(record)
    db.refresh(record, attribute_names=["course"])
    return record


# ── Jobs ───────────────────────────────────────────────────────────────────

@router.get("/jobs", response_model=List[JobApplicationResponse])
def list_jobs(
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    return (
        db.query(JobApplication)
        .filter(JobApplication.user_id == current_user.id)
        .all()
    )


@router.post("/jobs", response_model=JobApplicationResponse, status_code=201)
def add_job(
    payload:      JobApplicationCreate,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    job = JobApplication(user_id=current_user.id, **payload.model_dump())
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.put("/jobs/{job_id}", response_model=JobApplicationResponse)
def update_job(
    job_id:       int,
    payload:      JobApplicationUpdate,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    job = (
        db.query(JobApplication)
        .filter(
            JobApplication.id      == job_id,
            JobApplication.user_id == current_user.id,
        )
        .first()
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Job application not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(job, field, value)

    db.commit()
    db.refresh(job)
    return job


# ── Course catalog (manual entry / edit) ───────────────────────────────────

@router.delete("/courses", status_code=204)
def reset_all_courses(
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """Wipe every StudentCourseRecord for the current user (clean-slate re-import).

    No PDF files are stored server-side (processing is fully in-memory), so there
    are no residual files to clean up — only the DB rows are deleted here.
    """
    db.query(StudentCourseRecord).filter(
        StudentCourseRecord.user_id == current_user.id
    ).delete(synchronize_session=False)
    db.commit()


@router.delete("/courses/{record_id}", status_code=204)
def delete_course_record(
    record_id:    int,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """Delete a single StudentCourseRecord owned by the current user."""
    record = (
        db.query(StudentCourseRecord)
        .filter(
            StudentCourseRecord.id      == record_id,
            StudentCourseRecord.user_id == current_user.id,
        )
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Course record not found")
    db.delete(record)
    db.commit()


@router.post("/catalog", response_model=CourseResponse, status_code=201)
def create_catalog_entry(
    payload:      CourseCatalogCreate,
    current_user: User    = Depends(get_current_user),  # auth guard only; catalog is global
    db:           Session = Depends(get_db),
):
    """Get-or-create a global catalog entry by exact name (used by the Add Course modal)."""
    existing = db.query(CourseCatalog).filter(CourseCatalog.name == payload.name).first()
    if existing:
        return existing
    course = CourseCatalog(
        name=payload.name,
        credits=payload.credits,
        department=payload.department,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


@router.put("/catalog/{course_id}", response_model=CourseResponse)
def update_catalog_entry(
    course_id:    int,
    payload:      CourseCatalogUpdate,
    current_user: User    = Depends(get_current_user),  # auth guard only
    db:           Session = Depends(get_db),
):
    """Update a catalog entry's display name and/or credits (used by the edit modal)."""
    course = _get_or_404(db, CourseCatalog, course_id, "Course")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    return course


# ── Transcript ─────────────────────────────────────────────────────────────

_TRANSCRIPT_PROMPT = """
You are a transcript parser. Extract all courses from the following university transcript text.
The text has already been corrected for RTL/BiDi encoding — Hebrew course names are in their
proper logical reading order.

Return a JSON array (and nothing else) where each element has:
  "course_name":                string        (official course name as it appears in the text)
  "credits":                    number        (credit hours; null if not found)
  "grade":                      integer       (numeric grade 0-100; null if not yet graded)
  "status":                     string        ("completed" if grade exists, "active" otherwise)
  "semester_taken":             string | null (semester label, e.g. "Spring 2024", "Semester A 2023"; null if not found)
  "prerequisite_course_numbers": array        (list of prerequisite course number strings as they appear, e.g. ["104031", "236319"]; empty array if none found)

Transcript text:
{text}
"""


@router.post("/transcript", response_model=TranscriptUpsertResponse)
def parse_transcript(
    file:         UploadFile   = File(...),
    current_user: User         = Depends(get_current_user),
    db:           Session      = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF transcripts are supported")

    # Read the entire PDF into memory — never writes to disk beyond FastAPI's multipart buffer.
    # Using BytesIO avoids SpooledTemporaryFile read-head positioning issues.
    try:
        content = file.file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read uploaded file: {exc}")

    # Extract text from all pages using an in-memory buffer
    raw_text = ""
    try:
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                raw_text += (page.extract_text() or "") + "\n"
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Could not parse PDF — ensure the file is a valid, text-based PDF: {exc}",
        )

    if not raw_text.strip():
        raise HTTPException(
            status_code=422,
            detail="No text could be extracted. The PDF may be a scanned image — use a text-based PDF.",
        )

    # Apply the Unicode BiDi algorithm line-by-line to correct visual-order Hebrew extraction.
    # pdfplumber reads character positions left-to-right, which reverses RTL (Hebrew) runs.
    # get_display() converts that visual order back to logical reading order deterministically —
    # no LLM required for this step.
    raw_text = "\n".join(get_display(line) for line in raw_text.splitlines())

    # Ask Gemini to parse the transcript into structured JSON
    try:
        raw_json = ask_gemini(
            _TRANSCRIPT_PROMPT.format(text=raw_text[:8000]),  # cap context to avoid token overflow
            use_smart_model=True,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"AI service unavailable — please try again in a moment: {exc}",
        )

    # Strip markdown fences if Gemini wraps the output, then parse JSON
    try:
        clean = raw_json.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[1].rsplit("```", 1)[0]
        parsed_courses: list[dict] = json.loads(clean)
    except (json.JSONDecodeError, IndexError, ValueError):
        raise HTTPException(
            status_code=502,
            detail="AI returned unparseable JSON — try again",
        )

    upserted = 0
    skipped  = 0

    for entry in parsed_courses:
        name = (entry.get("course_name") or "").strip()
        if not name:
            skipped += 1
            continue

        incoming_status   = entry.get("status", "active")
        incoming_grade    = entry.get("grade")
        incoming_semester = (entry.get("semester_taken") or "").strip() or None
        incoming_prereqs  = entry.get("prerequisite_course_numbers") or []

        # Find or create the course in the global catalog
        course = db.query(CourseCatalog).filter(CourseCatalog.name == name).first()
        if course is None:
            course = CourseCatalog(
                name=name,
                credits=entry.get("credits"),
                prerequisite_course_numbers=incoming_prereqs or None,
            )
            db.add(course)
            db.flush()  # get the new id without full commit
        else:
            # Fill only missing catalog fields — never overwrite existing values
            if course.credits is None and entry.get("credits") is not None:
                course.credits = entry["credits"]
            if not course.prerequisite_course_numbers and incoming_prereqs:
                course.prerequisite_course_numbers = incoming_prereqs

        # Upsert the student's record (one record per user × course)
        record = (
            db.query(StudentCourseRecord)
            .filter(
                StudentCourseRecord.user_id   == current_user.id,
                StudentCourseRecord.course_id == course.id,
            )
            .first()
        )
        if record is None:
            record = StudentCourseRecord(
                user_id=current_user.id,
                course_id=course.id,
            )
            db.add(record)

        # Safe merge: never downgrade a completed+graded course.
        # Only upgrade active → completed when a grade arrives.
        already_completed = record.status == "completed" and record.grade is not None
        if not already_completed:
            record.status = incoming_status
            record.grade  = incoming_grade

        # Semester label: fill if missing; overwrite only when we get a more specific value
        if incoming_semester and not record.semester_taken:
            record.semester_taken = incoming_semester

        upserted += 1

    db.commit()

    # Reload records with joined courses for the response
    all_records = (
        db.query(StudentCourseRecord)
        .options(joinedload(StudentCourseRecord.course))
        .filter(StudentCourseRecord.user_id == current_user.id)
        .all()
    )
    gpa = _calculate_gpa(all_records)

    return TranscriptUpsertResponse(
        upserted_count=upserted,
        skipped_count=skipped,
        calculated_gpa=gpa,
        records=all_records,
    )
