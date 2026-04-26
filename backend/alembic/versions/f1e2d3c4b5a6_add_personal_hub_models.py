"""add_personal_hub_models

Adds four tables for Track D (Personal Hub & Academic Roadmap):
  - academic_profiles    : one-to-one extension of users (GPA target, university, social links)
  - course_catalog       : global SSOT for courses powering the prerequisite skill-tree UI
  - course_prerequisites : self-referential M2M association table for course_catalog
  - student_course_records : links a user to a course with grade / exam dates / status
  - job_applications     : career pipeline tracker per user with debrief sharing flag

Revision ID: f1e2d3c4b5a6
Revises: e1f2a3b4c5d6
Create Date: 2026-04-25
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision      = "f1e2d3c4b5a6"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # ── 1. course_catalog (no foreign deps — create before prerequisites) ──────
    op.create_table(
        "course_catalog",
        sa.Column("id",                sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column("name",              sa.String(),   nullable=False),
        sa.Column("department",        sa.String(),   nullable=True),
        sa.Column("credits",           sa.Float(),    nullable=True),
        sa.Column("is_yearly",         sa.Boolean(),  nullable=False, server_default="false"),
        sa.Column("difficulty_rating", sa.Float(),    nullable=False, server_default="0"),
        sa.Column("icon_name",         sa.String(),   nullable=True),
    )
    op.create_index("ix_course_catalog_id", "course_catalog", ["id"])

    # ── 2. course_prerequisites (self-referential M2M for course_catalog) ──────
    op.create_table(
        "course_prerequisites",
        sa.Column("course_id",       sa.Integer(),
                  sa.ForeignKey("course_catalog.id"), primary_key=True),
        sa.Column("prerequisite_id", sa.Integer(),
                  sa.ForeignKey("course_catalog.id"), primary_key=True),
    )

    # ── 3. academic_profiles (one-to-one with users) ───────────────────────────
    op.create_table(
        "academic_profiles",
        sa.Column("id",            sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id",       sa.Integer(),
                  sa.ForeignKey("users.id"),    nullable=False, unique=True),
        sa.Column("university",    sa.String(),  nullable=True),
        sa.Column("degree",        sa.String(),  nullable=True),
        sa.Column("current_year",  sa.Integer(), nullable=True),
        sa.Column("target_gpa",    sa.Float(),   nullable=True),
        sa.Column("extra_credits", sa.Float(),   nullable=True),
        sa.Column("social_links",  JSONB(),      nullable=True),
        sa.Column("created_at",    sa.DateTime(timezone=True),
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_academic_profiles_id", "academic_profiles", ["id"])

    # ── 4. student_course_records (user × course junction with metadata) ───────
    op.create_table(
        "student_course_records",
        sa.Column("id",                      sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id",                 sa.Integer(),
                  sa.ForeignKey("users.id"),          nullable=False),
        sa.Column("course_id",               sa.Integer(),
                  sa.ForeignKey("course_catalog.id"), nullable=False),
        sa.Column("status",                  sa.String(),  nullable=False, server_default="active"),
        sa.Column("grade",                   sa.Integer(), nullable=True),
        sa.Column("exam_date_a",             sa.DateTime(timezone=True), nullable=True),
        sa.Column("exam_date_b",             sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_attendance_mandatory", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at",              sa.DateTime(timezone=True),
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_student_course_records_id", "student_course_records", ["id"])

    # ── 5. job_applications ────────────────────────────────────────────────────
    op.create_table(
        "job_applications",
        sa.Column("id",                sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id",           sa.Integer(),
                  sa.ForeignKey("users.id"), nullable=False),
        sa.Column("company",           sa.String(),  nullable=False),
        sa.Column("role",              sa.String(),  nullable=False),
        sa.Column("status",            sa.String(),  nullable=False, server_default="applied"),
        sa.Column("application_date",  sa.DateTime(timezone=True), nullable=True),
        sa.Column("debrief_notes",     sa.Text(),    nullable=True),
        sa.Column("is_debrief_public", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at",        sa.DateTime(timezone=True),
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_job_applications_id", "job_applications", ["id"])


def downgrade() -> None:
    op.drop_index("ix_job_applications_id",       table_name="job_applications")
    op.drop_table("job_applications")
    op.drop_index("ix_student_course_records_id", table_name="student_course_records")
    op.drop_table("student_course_records")
    op.drop_index("ix_academic_profiles_id",      table_name="academic_profiles")
    op.drop_table("academic_profiles")
    op.drop_table("course_prerequisites")
    op.drop_index("ix_course_catalog_id",         table_name="course_catalog")
    op.drop_table("course_catalog")
