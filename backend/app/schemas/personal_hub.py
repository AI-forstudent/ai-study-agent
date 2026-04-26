"""
app/schemas/personal_hub.py
────────────────────────────
Pydantic request / response models for Track D: Personal Hub & Academic Roadmap.

Covers:
  AcademicProfile  — one-to-one user extension (GPA, university, social links)
  CourseCatalog    — global course registry (create / update for manual entry)
  CourseRecord     — student × course junction (grade, exam dates, status)
  JobApplication   — career pipeline tracker
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── AcademicProfile ────────────────────────────────────────────────────────

class AcademicProfileCreate(BaseModel):
    university:   Optional[str]   = None
    degree:       Optional[str]   = None
    current_year: Optional[int]   = None
    target_gpa:   Optional[float] = None
    manual_gpa:   Optional[float] = None
    extra_credits: Optional[float] = None
    social_links: Optional[Dict[str, Any]] = None


class AcademicProfileUpdate(BaseModel):
    university:   Optional[str]   = None
    degree:       Optional[str]   = None
    current_year: Optional[int]   = None
    target_gpa:   Optional[float] = None
    manual_gpa:   Optional[float] = None
    extra_credits: Optional[float] = None
    social_links: Optional[Dict[str, Any]] = None


class AcademicProfileResponse(BaseModel):
    id:             int
    user_id:        int
    university:     Optional[str]   = None
    degree:         Optional[str]   = None
    current_year:   Optional[int]   = None
    target_gpa:     Optional[float] = None
    manual_gpa:     Optional[float] = None
    calculated_gpa: Optional[float] = None   # computed server-side; not stored
    extra_credits:  Optional[float] = None
    social_links:   Optional[Dict[str, Any]] = None
    created_at:     datetime

    class Config:
        from_attributes = True


# ── CourseCatalog ──────────────────────────────────────────────────────────

class CourseCatalogCreate(BaseModel):
    """Payload for manually creating a catalog entry (used by the Add Course modal)."""
    name:       str
    credits:    Optional[float] = None
    department: Optional[str]   = None


class CourseCatalogUpdate(BaseModel):
    """Partial update for a catalog entry's display fields (name / credits)."""
    name:    Optional[str]   = None
    credits: Optional[float] = None


# ── CourseRecord ───────────────────────────────────────────────────────────

class CourseRecordCreate(BaseModel):
    course_id:               int
    status:                  str   = "active"   # active | completed | failed
    grade:                   Optional[int]      = None
    semester_taken:          Optional[str]      = None
    exam_date_a:             Optional[datetime] = None
    exam_date_b:             Optional[datetime] = None
    is_attendance_mandatory: bool  = False


class CourseRecordUpdate(BaseModel):
    status:                  Optional[str]      = None
    grade:                   Optional[int]      = None
    semester_taken:          Optional[str]      = None
    exam_date_a:             Optional[datetime] = None
    exam_date_b:             Optional[datetime] = None
    is_attendance_mandatory: Optional[bool]     = None


class CourseResponse(BaseModel):
    """Embedded course details returned inside CourseRecordResponse."""
    id:                          int
    name:                        str
    department:                  Optional[str]       = None
    credits:                     Optional[float]     = None
    icon_name:                   Optional[str]       = None
    prerequisite_course_numbers: Optional[List[str]] = None

    class Config:
        from_attributes = True


class CourseRecordResponse(BaseModel):
    id:                      int
    user_id:                 int
    course_id:               int
    course:                  Optional[CourseResponse] = None
    status:                  str
    grade:                   Optional[int]      = None
    semester_taken:          Optional[str]      = None
    exam_date_a:             Optional[datetime] = None
    exam_date_b:             Optional[datetime] = None
    is_attendance_mandatory: bool
    created_at:              datetime

    class Config:
        from_attributes = True


# ── JobApplication ─────────────────────────────────────────────────────────

class JobApplicationCreate(BaseModel):
    company:          str
    role:             str
    status:           str   = "applied"   # applied | interview | offer | rejected | withdrawn
    application_date: Optional[datetime] = None
    debrief_notes:    Optional[str]      = None
    is_debrief_public: bool = False


class JobApplicationUpdate(BaseModel):
    company:           Optional[str]      = None
    role:              Optional[str]      = None
    status:            Optional[str]      = None
    application_date:  Optional[datetime] = None
    debrief_notes:     Optional[str]      = None
    is_debrief_public: Optional[bool]     = None


class JobApplicationResponse(BaseModel):
    id:                int
    user_id:           int
    company:           str
    role:              str
    status:            str
    application_date:  Optional[datetime] = None
    debrief_notes:     Optional[str]      = None
    is_debrief_public: bool
    created_at:        datetime

    class Config:
        from_attributes = True


# ── Transcript ─────────────────────────────────────────────────────────────

class TranscriptUpsertResponse(BaseModel):
    """Summary returned after a transcript PDF is parsed and upserted."""
    upserted_count: int
    skipped_count:  int
    calculated_gpa: Optional[float] = None
    records:        List[CourseRecordResponse] = Field(default_factory=list)
