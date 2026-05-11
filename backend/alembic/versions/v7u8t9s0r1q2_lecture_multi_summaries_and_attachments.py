"""lecture_multi_summaries_and_attachments

F-034 — Lecture becomes a collection of summaries / recordings / notes.

Until now (F-033) a Lecture held single-instance fields:
  • lecturer_summary           TEXT
  • student_summaries          TEXT
  • recording_user_document_id FK
  • notes_user_document_id     FK

The product is moving to multi-instance for all four — a lecture can have
multiple lecturers, each lecturer can have multiple summary versions, the
user can keep peer summaries side-by-side, and there can be more than one
recording (e.g. two-part class) and more than one notes file.

Tables introduced
─────────────────
• lecture_lecturer_summaries
    id, lecture_id, lecturer_id (FK→course_lecturers, NULLABLE because a
    lecture may exist before any course_lecturer is in the DB), title,
    content, created_at, updated_at

• lecture_student_summaries
    id, lecture_id, title (e.g. "Summary by Yael"), content,
    created_at, updated_at

• lecture_recordings
    id, lecture_id, user_document_id (FK→userdocuments, ON DELETE SET NULL
    so cleaning the library doesn't lose lecture metadata), title,
    created_at

• lecture_notes
    id, lecture_id, user_document_id (FK→userdocuments, ON DELETE SET NULL),
    title, created_at

Backfill
────────
For every existing lecture we copy old single-column data into a single
new-table row so no user data is lost. Title defaults are friendly Hebrew
labels so the user can recognise them in the new sidebar:
  • lecturer_summary  → title "סיכום מרצה", lecturer_id = first row in
                        course_lecturers for the lecture's course, or NULL.
  • student_summaries → title "סיכום תלמיד"
  • recording fk      → title from the linked UserDocument's custom_title
  • notes fk          → title from the linked UserDocument's custom_title

After backfill we drop the four old columns from `lectures` so writes
have a single source of truth.

Drop strategy
─────────────
The four old columns are dropped in the same migration. Rollback re-creates
them but **loses any data added after this migration** — that's the
expected cost of converting a single-instance column into a list and is
why a downgrade is for dev only.

Revision ID: v7u8t9s0r1q2
Revises: u6t7s8r9q0p1
Create Date: 2026-05-11
"""

from alembic import op
import sqlalchemy as sa


revision      = "v7u8t9s0r1q2"
down_revision = "u6t7s8r9q0p1"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # ── 1. Create the four new tables ──────────────────────────────────────

    op.create_table(
        "lecture_lecturer_summaries",
        sa.Column("id",          sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "lecture_id",
            sa.Integer(),
            sa.ForeignKey("lectures.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "lecturer_id",
            sa.Integer(),
            sa.ForeignKey("course_lecturers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title",       sa.String(), nullable=False, server_default="סיכום מרצה"),
        sa.Column("content",     sa.Text(),   nullable=True),
        sa.Column("created_at",  sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",  sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_lecture_lecturer_summaries_lecture_id",  "lecture_lecturer_summaries", ["lecture_id"])
    op.create_index("ix_lecture_lecturer_summaries_lecturer_id", "lecture_lecturer_summaries", ["lecturer_id"])

    op.create_table(
        "lecture_student_summaries",
        sa.Column("id",          sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "lecture_id",
            sa.Integer(),
            sa.ForeignKey("lectures.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title",       sa.String(), nullable=False, server_default="סיכום תלמיד"),
        sa.Column("content",     sa.Text(),   nullable=True),
        sa.Column("created_at",  sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",  sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_lecture_student_summaries_lecture_id", "lecture_student_summaries", ["lecture_id"])

    op.create_table(
        "lecture_recordings",
        sa.Column("id",          sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "lecture_id",
            sa.Integer(),
            sa.ForeignKey("lectures.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_document_id",
            sa.Integer(),
            sa.ForeignKey("userdocuments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title",       sa.String(), nullable=False, server_default="הקלטה"),
        sa.Column("created_at",  sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_lecture_recordings_lecture_id", "lecture_recordings", ["lecture_id"])

    op.create_table(
        "lecture_notes",
        sa.Column("id",          sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "lecture_id",
            sa.Integer(),
            sa.ForeignKey("lectures.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_document_id",
            sa.Integer(),
            sa.ForeignKey("userdocuments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title",       sa.String(), nullable=False, server_default="הערות"),
        sa.Column("created_at",  sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_lecture_notes_lecture_id", "lecture_notes", ["lecture_id"])

    # ── 2. Backfill old single-instance columns into the new tables ────────
    # We resolve `lecturer_id` via a correlated subquery that picks the
    # first course_lecturer row for the lecture's course. If the course has
    # no lecturers yet, lecturer_id stays NULL (the column is nullable).

    op.execute("""
        INSERT INTO lecture_lecturer_summaries (lecture_id, lecturer_id, title, content)
        SELECT
            l.id AS lecture_id,
            (
                SELECT cl.id
                FROM course_lecturers cl
                WHERE cl.course_id = l.course_id
                ORDER BY cl.id ASC
                LIMIT 1
            ) AS lecturer_id,
            'סיכום מרצה' AS title,
            l.lecturer_summary AS content
        FROM lectures l
        WHERE l.lecturer_summary IS NOT NULL
          AND length(trim(l.lecturer_summary)) > 0;
    """)

    op.execute("""
        INSERT INTO lecture_student_summaries (lecture_id, title, content)
        SELECT
            l.id AS lecture_id,
            'סיכום תלמיד' AS title,
            l.student_summaries AS content
        FROM lectures l
        WHERE l.student_summaries IS NOT NULL
          AND length(trim(l.student_summaries)) > 0;
    """)

    op.execute("""
        INSERT INTO lecture_recordings (lecture_id, user_document_id, title)
        SELECT
            l.id AS lecture_id,
            l.recording_user_document_id AS user_document_id,
            COALESCE(ud.custom_title, 'הקלטה') AS title
        FROM lectures l
        LEFT JOIN userdocuments ud ON ud.id = l.recording_user_document_id
        WHERE l.recording_user_document_id IS NOT NULL;
    """)

    op.execute("""
        INSERT INTO lecture_notes (lecture_id, user_document_id, title)
        SELECT
            l.id AS lecture_id,
            l.notes_user_document_id AS user_document_id,
            COALESCE(ud.custom_title, 'הערות') AS title
        FROM lectures l
        LEFT JOIN userdocuments ud ON ud.id = l.notes_user_document_id
        WHERE l.notes_user_document_id IS NOT NULL;
    """)

    # ── 3. Drop the four legacy single-instance columns ────────────────────
    op.drop_column("lectures", "lecturer_summary")
    op.drop_column("lectures", "student_summaries")
    op.drop_column("lectures", "recording_user_document_id")
    op.drop_column("lectures", "notes_user_document_id")


def downgrade() -> None:
    """Rollback re-creates the old columns BUT data added after the upgrade
    is collapsed: the most recent row in each new table (per lecture) is
    written back to the old single column. Data loss is expected — this
    downgrade is for dev work, not production rollback."""

    op.add_column("lectures", sa.Column("lecturer_summary", sa.Text(), nullable=True))
    op.add_column("lectures", sa.Column("student_summaries", sa.Text(), nullable=True))
    op.add_column(
        "lectures",
        sa.Column(
            "recording_user_document_id",
            sa.Integer(),
            sa.ForeignKey("userdocuments.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "lectures",
        sa.Column(
            "notes_user_document_id",
            sa.Integer(),
            sa.ForeignKey("userdocuments.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Best-effort: write the most-recent row per lecture back into the old
    # single column. Uses DISTINCT ON, a Postgres-specific construct.
    op.execute("""
        UPDATE lectures l
        SET lecturer_summary = sub.content
        FROM (
            SELECT DISTINCT ON (lecture_id) lecture_id, content
            FROM lecture_lecturer_summaries
            ORDER BY lecture_id, created_at DESC
        ) sub
        WHERE l.id = sub.lecture_id;
    """)
    op.execute("""
        UPDATE lectures l
        SET student_summaries = sub.content
        FROM (
            SELECT DISTINCT ON (lecture_id) lecture_id, content
            FROM lecture_student_summaries
            ORDER BY lecture_id, created_at DESC
        ) sub
        WHERE l.id = sub.lecture_id;
    """)
    op.execute("""
        UPDATE lectures l
        SET recording_user_document_id = sub.user_document_id
        FROM (
            SELECT DISTINCT ON (lecture_id) lecture_id, user_document_id
            FROM lecture_recordings
            ORDER BY lecture_id, created_at DESC
        ) sub
        WHERE l.id = sub.lecture_id
          AND sub.user_document_id IS NOT NULL;
    """)
    op.execute("""
        UPDATE lectures l
        SET notes_user_document_id = sub.user_document_id
        FROM (
            SELECT DISTINCT ON (lecture_id) lecture_id, user_document_id
            FROM lecture_notes
            ORDER BY lecture_id, created_at DESC
        ) sub
        WHERE l.id = sub.lecture_id
          AND sub.user_document_id IS NOT NULL;
    """)

    op.drop_index("ix_lecture_notes_lecture_id", table_name="lecture_notes")
    op.drop_table("lecture_notes")

    op.drop_index("ix_lecture_recordings_lecture_id", table_name="lecture_recordings")
    op.drop_table("lecture_recordings")

    op.drop_index("ix_lecture_student_summaries_lecture_id", table_name="lecture_student_summaries")
    op.drop_table("lecture_student_summaries")

    op.drop_index("ix_lecture_lecturer_summaries_lecturer_id", table_name="lecture_lecturer_summaries")
    op.drop_index("ix_lecture_lecturer_summaries_lecture_id",  table_name="lecture_lecturer_summaries")
    op.drop_table("lecture_lecturer_summaries")
