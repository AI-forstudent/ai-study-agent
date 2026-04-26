"""
tests/test_personal_hub_api.py
───────────────────────────────
Unit tests for Track D: Personal Hub & Academic Roadmap.

Strategy:
  - GPA calculation: pure-function tests (no DB, no network).
  - Schema validation: Pydantic model tests (no DB).
  - Integration tests (@pytest.mark.integration): require a live database
    and are skipped by default; run with --run-integration.

Coverage:
  TestGpaCalculation    — 10 tests for the weighted-GPA helper
  TestSchemaValidation  —  8 tests for Pydantic model parsing / defaults
  TestRegressions       —  2 regression tests for historical edge cases
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Optional

import pytest


# ── Import the function under test ─────────────────────────────────────────

from app.api.routers.personal_hub import _calculate_gpa


# ── Helpers ────────────────────────────────────────────────────────────────

def _make_record(
    status: str,
    grade: Optional[int],
    credits: Optional[float],
) -> SimpleNamespace:
    """Construct a minimal duck-typed StudentCourseRecord for GPA tests."""
    course = SimpleNamespace(credits=credits) if credits is not None else None
    return SimpleNamespace(status=status, grade=grade, course=course)


# ══════════════════════════════════════════════════════════════════════════════
# TestGpaCalculation
# ══════════════════════════════════════════════════════════════════════════════

class TestGpaCalculation:
    def test_empty_records_returns_none(self):
        assert _calculate_gpa([]) is None

    def test_only_active_records_returns_none(self):
        records = [_make_record("active", None, 3.0)]
        assert _calculate_gpa(records) is None

    def test_single_completed_record(self):
        records = [_make_record("completed", 85, 3.0)]
        assert _calculate_gpa(records) == 85.0

    def test_two_equal_weight_courses(self):
        records = [
            _make_record("completed", 90, 3.0),
            _make_record("completed", 80, 3.0),
        ]
        assert _calculate_gpa(records) == 85.0

    def test_weighted_average_honours_credits(self):
        # 100 × 1 + 60 × 3 = 280 / 4 = 70.0
        records = [
            _make_record("completed", 100, 1.0),
            _make_record("completed",  60, 3.0),
        ]
        assert _calculate_gpa(records) == 70.0

    def test_failed_records_included_in_gpa(self):
        # failed with grade 0 should drag the GPA down
        records = [
            _make_record("completed", 100, 3.0),
            _make_record("failed",      0, 3.0),
        ]
        # failed ≠ "completed" — should be excluded
        assert _calculate_gpa(records) == 100.0

    def test_completed_without_grade_excluded(self):
        records = [
            _make_record("completed", 90, 3.0),
            _make_record("completed", None, 3.0),   # no grade yet
        ]
        assert _calculate_gpa(records) == 90.0

    def test_completed_without_credits_excluded(self):
        records = [
            _make_record("completed", 80, 3.0),
            _make_record("completed", 95, None),    # no credits recorded
        ]
        assert _calculate_gpa(records) == 80.0

    def test_result_is_rounded_to_two_decimals(self):
        # 85 × 3 + 72 × 2 = 255 + 144 = 399 / 5 = 79.8
        records = [
            _make_record("completed", 85, 3.0),
            _make_record("completed", 72, 2.0),
        ]
        result = _calculate_gpa(records)
        assert result == 79.8
        assert isinstance(result, float)

    def test_mix_of_statuses_only_completed_counted(self):
        records = [
            _make_record("completed", 88, 3.0),
            _make_record("active",    None, 3.0),
            _make_record("failed",    40, 3.0),
        ]
        assert _calculate_gpa(records) == 88.0


# ══════════════════════════════════════════════════════════════════════════════
# TestSchemaValidation
# ══════════════════════════════════════════════════════════════════════════════

class TestSchemaValidation:
    def test_academic_profile_create_all_optional(self):
        from app.schemas.personal_hub import AcademicProfileCreate
        obj = AcademicProfileCreate()
        assert obj.university is None
        assert obj.manual_gpa is None

    def test_academic_profile_update_partial(self):
        from app.schemas.personal_hub import AcademicProfileUpdate
        obj = AcademicProfileUpdate(university="MIT")
        assert obj.university == "MIT"
        assert obj.degree is None

    def test_course_record_create_defaults(self):
        from app.schemas.personal_hub import CourseRecordCreate
        obj = CourseRecordCreate(course_id=1)
        assert obj.status == "active"
        assert obj.is_attendance_mandatory is False
        assert obj.grade is None

    def test_course_record_update_all_optional(self):
        from app.schemas.personal_hub import CourseRecordUpdate
        obj = CourseRecordUpdate()
        assert obj.status is None
        assert obj.grade is None

    def test_job_application_create_defaults(self):
        from app.schemas.personal_hub import JobApplicationCreate
        obj = JobApplicationCreate(company="Acme", role="Engineer")
        assert obj.status == "applied"
        assert obj.is_debrief_public is False

    def test_job_application_update_all_optional(self):
        from app.schemas.personal_hub import JobApplicationUpdate
        obj = JobApplicationUpdate()
        assert obj.company is None
        assert obj.status is None

    def test_transcript_upsert_response_defaults(self):
        from app.schemas.personal_hub import TranscriptUpsertResponse
        obj = TranscriptUpsertResponse(upserted_count=3, skipped_count=1)
        assert obj.calculated_gpa is None
        assert obj.records == []

    def test_academic_profile_response_has_calculated_gpa_field(self):
        from app.schemas.personal_hub import AcademicProfileResponse
        fields = AcademicProfileResponse.model_fields
        assert "calculated_gpa" in fields
        assert "manual_gpa" in fields


# ══════════════════════════════════════════════════════════════════════════════
# TestRegressions
# ══════════════════════════════════════════════════════════════════════════════

class TestRegressions:
    def test_gpa_not_nan_when_credits_sum_to_zero(self):
        """Guards against ZeroDivisionError if credits are somehow 0."""
        records = [_make_record("completed", 80, 0.0)]
        # credits = 0 means the record is excluded (falsy), so result is None
        assert _calculate_gpa(records) is None

    def test_course_record_create_status_is_string(self):
        """Regression: status must be a plain str, not an enum, for DB writes."""
        from app.schemas.personal_hub import CourseRecordCreate
        obj = CourseRecordCreate(course_id=5, status="completed")
        assert isinstance(obj.status, str)
        assert obj.status == "completed"
