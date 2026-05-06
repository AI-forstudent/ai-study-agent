"""exam_question_count

Adds a denormalized `Exam.question_count` so the table-list endpoint (which
the frontend polls every 5 seconds) doesn't have to load every exam's
questions just to call `len(exam.questions)`.

Together with the `selectinload` pass landing in the same commit, list-view
queries drop from ~30+ N+1 fetches to a fixed 3-4 queries regardless of how
many exams a course has.

The column is maintained at write time (`process_exam` sets it after
extraction; `retry_exam_processing` resets it; cascades on exam delete take
care of the rest). No live trigger needed.

Revision ID: n9m0l1k2j3i4
Revises: m8l9k0j1i2h3
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa


revision      = "n9m0l1k2j3i4"
down_revision = "m8l9k0j1i2h3"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.add_column(
        "exams",
        sa.Column("question_count", sa.Integer(), nullable=False, server_default="0"),
    )

    # Backfill: populate the cache from existing rows. The subquery scopes
    # exam_questions to each exam — fast on Postgres given the existing
    # ix_exam_questions_exam_id index.
    op.execute(
        "UPDATE exams "
        "SET question_count = ("
        "  SELECT COUNT(*) FROM exam_questions WHERE exam_questions.exam_id = exams.id"
        ")"
    )


def downgrade() -> None:
    op.drop_column("exams", "question_count")
