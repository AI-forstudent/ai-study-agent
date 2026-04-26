"""add_semester_taken_and_prereq_numbers

Adds:
  - semester_taken (String, nullable) to student_course_records
  - prerequisite_course_numbers (JSONB, nullable) to course_catalog

Both columns are nullable with no server_default so PostgreSQL applies NULL to
all existing rows — no table rewrite and no data migration needed.

Revision ID: h3g4f5e6d7c8
Revises: g2f3e4d5c6b7
Create Date: 2026-04-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision      = "h3g4f5e6d7c8"
down_revision = "g2f3e4d5c6b7"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.add_column(
        "student_course_records",
        sa.Column("semester_taken", sa.String(), nullable=True),
    )
    op.add_column(
        "course_catalog",
        sa.Column("prerequisite_course_numbers", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("student_course_records", "semester_taken")
    op.drop_column("course_catalog", "prerequisite_course_numbers")
