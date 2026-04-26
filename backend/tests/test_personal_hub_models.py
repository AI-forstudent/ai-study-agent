"""
backend/tests/test_personal_hub_models.py
──────────────────────────────────────────
Unit tests for the Personal Hub ORM models (Track D).

All tests in this file are pure-Python unit tests — they verify model
attribute existence, default values, and relationship configuration
without requiring a live database connection.

Integration tests (actual INSERT / SELECT against PostgreSQL) are marked
@pytest.mark.integration and skipped unless --run-integration is passed.

Run:
    cd backend && uv run pytest tests/test_personal_hub_models.py -v
"""

import pytest
from datetime import datetime, timezone

from app.models.domain import (
    AcademicProfile,
    CourseCatalog,
    JobApplication,
    StudentCourseRecord,
    User,
    course_prerequisites,
)


# ══════════════════════════════════════════════════════════════════════════
# AcademicProfile
# ══════════════════════════════════════════════════════════════════════════

class TestAcademicProfileModel:

    def test_table_name(self):
        assert AcademicProfile.__tablename__ == "academic_profiles"

    def test_required_columns_exist(self):
        cols = {c.key for c in AcademicProfile.__table__.columns}
        assert {"id", "user_id", "university", "degree", "current_year",
                "target_gpa", "extra_credits", "social_links", "created_at"} <= cols

    def test_user_id_is_unique(self):
        """user_id must carry a unique constraint to enforce one-to-one with User."""
        col = AcademicProfile.__table__.c.user_id
        assert col.unique is True

    def test_all_personal_fields_are_nullable(self):
        """All fields except id/user_id are optional so profile creation is gradual."""
        optional = ["university", "degree", "current_year", "target_gpa",
                    "extra_credits", "social_links"]
        for name in optional:
            col = AcademicProfile.__table__.c[name]
            assert col.nullable is True, f"{name} should be nullable"

    def test_relationship_on_user(self):
        """User must expose an academic_profile relationship (uselist=False → one-to-one)."""
        rel = User.__mapper__.relationships["academic_profile"]
        assert rel.uselist is False

    def test_instantiation_does_not_raise(self):
        profile = AcademicProfile(
            user_id=1,
            university="Ben-Gurion University",
            degree="B.Sc. Data Engineering",
            current_year=2,
            target_gpa=90.0,
            extra_credits=5.0,
            social_links={"linkedin": "https://linkedin.com/in/dvir"},
        )
        assert profile.university == "Ben-Gurion University"
        assert profile.target_gpa == 90.0


# ══════════════════════════════════════════════════════════════════════════
# CourseCatalog
# ══════════════════════════════════════════════════════════════════════════

class TestCourseCatalogModel:

    def test_table_name(self):
        assert CourseCatalog.__tablename__ == "course_catalog"

    def test_required_columns_exist(self):
        cols = {c.key for c in CourseCatalog.__table__.columns}
        assert {"id", "name", "department", "credits", "is_yearly",
                "difficulty_rating", "icon_name"} <= cols

    def test_difficulty_rating_has_server_default_zero(self):
        col = CourseCatalog.__table__.c.difficulty_rating
        assert str(col.server_default.arg) == "0"

    def test_is_yearly_has_server_default_false(self):
        col = CourseCatalog.__table__.c.is_yearly
        assert str(col.server_default.arg) == "false"

    def test_prerequisites_relationship_exists(self):
        """prerequisites must be a self-referential relationship on CourseCatalog."""
        rel = CourseCatalog.__mapper__.relationships["prerequisites"]
        assert rel.secondary is course_prerequisites

    def test_required_by_backref_exists(self):
        """The backref 'required_by' must be accessible on CourseCatalog instances."""
        course = CourseCatalog(name="Advanced Algorithms", department="CS", credits=4.0)
        assert hasattr(course, "required_by")

    def test_instantiation_does_not_raise(self):
        course = CourseCatalog(
            name="Data Structures",
            department="Computer Science",
            credits=3.5,
            is_yearly=False,
            difficulty_rating=3.5,
            icon_name="Code",
        )
        assert course.name == "Data Structures"
        assert course.icon_name == "Code"

    def test_prerequisite_linking_in_memory(self):
        """Assigning prerequisites in-memory must work before any DB flush."""
        intro = CourseCatalog(name="Intro to CS",       credits=3.0)
        ds    = CourseCatalog(name="Data Structures",   credits=3.5)
        algo  = CourseCatalog(name="Algorithms",        credits=4.0)

        ds.prerequisites.append(intro)
        algo.prerequisites.append(ds)

        assert intro in ds.prerequisites
        assert ds in algo.prerequisites
        assert intro not in algo.prerequisites   # indirect dependency — not flattened


# ══════════════════════════════════════════════════════════════════════════
# StudentCourseRecord
# ══════════════════════════════════════════════════════════════════════════

class TestStudentCourseRecordModel:

    def test_table_name(self):
        assert StudentCourseRecord.__tablename__ == "student_course_records"

    def test_required_columns_exist(self):
        cols = {c.key for c in StudentCourseRecord.__table__.columns}
        assert {"id", "user_id", "course_id", "status", "grade",
                "exam_date_a", "exam_date_b", "is_attendance_mandatory"} <= cols

    def test_status_default_is_active(self):
        col = StudentCourseRecord.__table__.c.status
        assert str(col.server_default.arg) == "active"

    def test_grade_is_nullable(self):
        """Grade is unknown until the exam result is published."""
        assert StudentCourseRecord.__table__.c.grade.nullable is True

    def test_exam_dates_are_nullable(self):
        for col_name in ("exam_date_a", "exam_date_b"):
            assert StudentCourseRecord.__table__.c[col_name].nullable is True

    def test_relationships_defined(self):
        rels = {r.key for r in StudentCourseRecord.__mapper__.relationships}
        assert {"user", "course"} <= rels

    def test_instantiation_does_not_raise(self):
        record = StudentCourseRecord(
            user_id=1,
            course_id=42,
            status="active",
            is_attendance_mandatory=True,
        )
        assert record.status == "active"
        assert record.grade is None

    def test_valid_status_values(self):
        """Smoke-test that all documented status strings can be assigned."""
        for status in ("active", "completed", "failed"):
            r = StudentCourseRecord(user_id=1, course_id=1, status=status)
            assert r.status == status


# ══════════════════════════════════════════════════════════════════════════
# JobApplication
# ══════════════════════════════════════════════════════════════════════════

class TestJobApplicationModel:

    def test_table_name(self):
        assert JobApplication.__tablename__ == "job_applications"

    def test_required_columns_exist(self):
        cols = {c.key for c in JobApplication.__table__.columns}
        assert {"id", "user_id", "company", "role", "status",
                "application_date", "debrief_notes", "is_debrief_public"} <= cols

    def test_status_default_is_applied(self):
        col = JobApplication.__table__.c.status
        assert str(col.server_default.arg) == "applied"

    def test_is_debrief_public_defaults_false(self):
        col = JobApplication.__table__.c.is_debrief_public
        assert str(col.server_default.arg) == "false"

    def test_debrief_notes_is_nullable(self):
        assert JobApplication.__table__.c.debrief_notes.nullable is True

    def test_application_date_is_nullable(self):
        """Date may be added after the fact."""
        assert JobApplication.__table__.c.application_date.nullable is True

    def test_user_relationship_defined(self):
        rels = {r.key for r in JobApplication.__mapper__.relationships}
        assert "user" in rels

    def test_user_has_job_applications_relationship(self):
        rels = {r.key for r in User.__mapper__.relationships}
        assert "job_applications" in rels

    def test_instantiation_does_not_raise(self):
        job = JobApplication(
            user_id=1,
            company="Google",
            role="Data Engineer",
            status="interview",
            debrief_notes="First round went well. Focus on system design next.",
            is_debrief_public=False,
        )
        assert job.company == "Google"
        assert job.is_debrief_public is False

    def test_valid_status_pipeline(self):
        """All documented status values must be assignable."""
        for status in ("applied", "interview", "offer", "rejected", "withdrawn"):
            j = JobApplication(user_id=1, company="X", role="Y", status=status)
            assert j.status == status


# ══════════════════════════════════════════════════════════════════════════
# Regression
# ══════════════════════════════════════════════════════════════════════════

class TestRegressions:

    def test_course_prerequisites_association_table_has_correct_fk_columns(self):
        """Both FKs in the association table must point to course_catalog.id."""
        cols = {c.name: c for c in course_prerequisites.columns}
        assert "course_id" in cols and "prerequisite_id" in cols
        for col in cols.values():
            fk_targets = {fk.target_fullname for fk in col.foreign_keys}
            assert "course_catalog.id" in fk_targets

    def test_academic_profile_one_to_one_enforced_by_unique_constraint(self):
        """
        Regression: without unique=True on user_id, multiple profiles per user
        would be silently allowed, breaking the one-to-one invariant.
        """
        col = AcademicProfile.__table__.c.user_id
        assert col.unique is True
