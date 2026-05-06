"""exams_and_questions

Adds the Exams feature to Courses (Phase 1 — schema + processing pipeline).

New tables
──────────
• exams                 — one row per uploaded past paper.
                          Stores course_id, year, semester, the source
                          UserDocument (single PDF per exam — companion
                          blank/solved version is generated lazily when the
                          student clicks "Take" or "Submit"), an aggregate
                          difficulty score, and the AI-generated reference
                          solutions JSON.
• exam_questions        — extracted question rows. Each carries a topic
                          attribution, a normalized question type, an
                          embedding (Vector(768)) for difficulty calibration,
                          and the page on which it appears.
• exam_question_topics  — M2M between questions and course_topics.
• exam_lecturers        — M2M between exams and course_lecturers (Q1=(b)).
• course_question_types — normalized question-type taxonomy per course
                          (mirrors course_topics; question types are
                          discovered from syllabus or inferred by the
                          tagger).

`exam_attempts` (the "Take exam" Take/Submit/Grade flow) is intentionally
deferred to a follow-up migration since it's only needed for Phase 3.

Revision ID: l7k8j9i0h1g2
Revises: k6j7i8h9g0f1
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from pgvector.sqlalchemy import Vector


revision      = "l7k8j9i0h1g2"
down_revision = "k6j7i8h9g0f1"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # ── 1. course_question_types ───────────────────────────────────────────
    # Mirrors course_topics: per-course taxonomy, unique by name within course.
    op.create_table(
        "course_question_types",
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
            server_default="inferred",
        ),  # 'syllabus' | 'inferred'
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("course_id", "name", name="uq_course_question_types_course_name"),
    )
    op.create_index("ix_course_question_types_id", "course_question_types", ["id"])

    # ── 2. exams ───────────────────────────────────────────────────────────
    op.create_table(
        "exams",
        sa.Column("id",                          sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("title",                       sa.String(),   nullable=False),
        sa.Column("year",                        sa.Integer(),  nullable=True),
        sa.Column("semester",                    sa.String(),   nullable=True),  # e.g. "Fall", "Spring", "Moed A"
        # The single PDF the user uploaded. The companion (blank if uploaded
        # was solved, or solved if uploaded was blank) is generated on-demand
        # by the Take/Grade flow and cached on `companion_user_document_id`
        # in a later migration.
        sa.Column(
            "user_document_id",
            sa.Integer(),
            sa.ForeignKey("userdocuments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("has_solutions",               sa.Boolean(),  nullable=False, server_default="false"),
        sa.Column("aggregate_difficulty",        sa.Float(),    nullable=True),
        sa.Column("reference_solutions",         JSONB(),       nullable=True),  # AI-generated when not in source
        sa.Column(
            "processed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),  # null = upload received but extraction not yet finished
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_exams_id", "exams", ["id"])
    # The course_id index is auto-created by `index=True` on the column above
    # — declaring it explicitly here would duplicate it (relation
    # "ix_exams_course_id" already exists). Same applies to exam_questions
    # and course_question_types below.

    # ── 3. exam_questions ──────────────────────────────────────────────────
    op.create_table(
        "exam_questions",
        sa.Column("id",                          sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column(
            "exam_id",
            sa.Integer(),
            sa.ForeignKey("exams.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("question_number",             sa.String(),   nullable=False),  # "1", "1a", "2"
        sa.Column("question_text",               sa.Text(),     nullable=False),
        sa.Column("page_number",                 sa.Integer(),  nullable=True),
        sa.Column(
            "question_type_id",
            sa.Integer(),
            sa.ForeignKey("course_question_types.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("difficulty_score",            sa.Float(),    nullable=True),  # null until first calibration
        sa.Column("embedding",                   Vector(768),   nullable=True),
        sa.Column(
            "reference_solution",
            sa.Text(),
            nullable=True,
        ),  # what the AI considers the right answer (used for grading)
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_exam_questions_id", "exam_questions", ["id"])
    # The exam_id index is auto-created by `index=True` on the column above.

    # ── 4. exam_question_topics — M2M between questions and topics ────────
    op.create_table(
        "exam_question_topics",
        sa.Column(
            "question_id",
            sa.Integer(),
            sa.ForeignKey("exam_questions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "topic_id",
            sa.Integer(),
            sa.ForeignKey("course_topics.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    # ── 5. exam_lecturers — M2M between exams and lecturers ────────────────
    op.create_table(
        "exam_lecturers",
        sa.Column(
            "exam_id",
            sa.Integer(),
            sa.ForeignKey("exams.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "lecturer_id",
            sa.Integer(),
            sa.ForeignKey("course_lecturers.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("exam_lecturers")
    op.drop_table("exam_question_topics")

    # Drop only the indexes we created EXPLICITLY in upgrade(); the ones from
    # `index=True` go away automatically when the table is dropped.
    op.drop_index("ix_exam_questions_id", table_name="exam_questions")
    op.drop_table("exam_questions")

    op.drop_index("ix_exams_id", table_name="exams")
    op.drop_table("exams")

    op.drop_index("ix_course_question_types_id", table_name="course_question_types")
    op.drop_table("course_question_types")
