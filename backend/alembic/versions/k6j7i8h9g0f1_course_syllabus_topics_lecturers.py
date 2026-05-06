"""course_syllabus_topics_lecturers

Adds the Syllabus feature to Courses. A course can have one syllabus document
(a UserDocument) plus a structured JSONB extraction of its contents (topics,
books, lecturers, grading policy, prerequisites, weekly breakdown). Two
normalized lookup tables are seeded from that extraction:

  • course_topics    — used later by the Exams feature for per-question topic
                       tagging. Single source of truth for "what topics live
                       in this course".
  • course_lecturers — Q1=(b) decision: lecturers normalized so we can later
                       compare e.g. "Prof. X's exams are harder than Prof. Y's".

Threads gain a nullable `course_id` so a chat can be opened in the context of
a specific course, which lets `prompt_builder` inject the syllabus summary.

Revision ID: k6j7i8h9g0f1
Revises: j5i6h7g8f9e0
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision      = "k6j7i8h9g0f1"
down_revision = "j5i6h7g8f9e0"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # ── 1. courses.syllabus_user_document_id + syllabus_extracted ──────────
    # ON DELETE SET NULL — when the syllabus document is removed from the
    # user's library, the course's pointer is auto-cleared and the cached
    # extraction stays put (the user can re-attach a new syllabus later).
    op.add_column(
        "courses",
        sa.Column(
            "syllabus_user_document_id",
            sa.Integer(),
            sa.ForeignKey("userdocuments.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "courses",
        sa.Column(
            "syllabus_extracted",
            JSONB(),
            nullable=True,
        ),
    )

    # ── 2. course_topics ───────────────────────────────────────────────────
    op.create_table(
        "course_topics",
        sa.Column("id",         sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("name",       sa.String(),   nullable=False),
        sa.Column(
            "source",
            sa.String(),
            nullable=False,
            server_default="syllabus",
        ),  # 'syllabus' | 'lecture' | 'exam_inferred'
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Topic names should be unique within a course so dedup queries during
        # tagging are simple SELECTs.
        sa.UniqueConstraint("course_id", "name", name="uq_course_topics_course_name"),
    )
    op.create_index("ix_course_topics_id", "course_topics", ["id"])

    # ── 3. course_lecturers ────────────────────────────────────────────────
    op.create_table(
        "course_lecturers",
        sa.Column("id",         sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("name",       sa.String(),   nullable=False),
        sa.Column("email",      sa.String(),   nullable=True),
        sa.Column(
            "role",
            sa.String(),
            nullable=False,
            server_default="lecturer",
        ),  # 'lecturer' | 'ta' | 'guest'
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("course_id", "name", name="uq_course_lecturers_course_name"),
    )
    op.create_index("ix_course_lecturers_id", "course_lecturers", ["id"])

    # ── 4. threads.course_id ───────────────────────────────────────────────
    # A chat session can be scoped to a course; the prompt builder injects
    # that course's syllabus summary into the system prompt.
    op.add_column(
        "threads",
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id"),
            nullable=True,
        ),
    )
    op.create_index("ix_threads_course_id", "threads", ["course_id"])


def downgrade() -> None:
    op.drop_index("ix_threads_course_id", table_name="threads")
    op.drop_column("threads", "course_id")

    op.drop_index("ix_course_lecturers_id", table_name="course_lecturers")
    op.drop_table("course_lecturers")

    op.drop_index("ix_course_topics_id", table_name="course_topics")
    op.drop_table("course_topics")

    op.drop_column("courses", "syllabus_extracted")
    op.drop_column("courses", "syllabus_user_document_id")
