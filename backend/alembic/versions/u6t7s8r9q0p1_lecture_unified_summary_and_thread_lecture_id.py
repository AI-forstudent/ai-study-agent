"""lecture_unified_summary_and_thread_lecture_id

F-033 — Unified lecture summary + lecture-scoped chat.

Three lecture-level changes plus one thread-level change.

Lecture side
────────────
1. Rename `lectures.manual_summary` → `lectures.lecturer_summary`. The skill
   that generates the unified summary treats this column as the authoritative
   "lecture notes" input (the structural backbone of the output). Renaming
   makes the contract explicit: this is the lecturer's material, not the
   student's own.

2. Add `lectures.student_summaries` TEXT — peer / classmate / student-written
   summaries. The unified-summary skill IGNORES this column on purpose
   (the spec says "at least one of {manual_summary, recording_transcript}"
   — student summaries are not authoritative). It exists purely for the
   student to keep their own and peers' summaries alongside the lecturer's.

3. Add the unified-summary cache columns:
     • unified_summary             TEXT      — the AI-generated markdown
     • unified_summary_processing  BOOLEAN   — true while a generation BG task is in flight
     • unified_summary_error       TEXT      — last failure message (preserved on failure;
                                               does NOT wipe `unified_summary`)
     • unified_summary_generated_at TIMESTAMPTZ — when the current cached value finished

Thread side
───────────
4. Add `threads.lecture_id` FK → lectures.id, ON DELETE SET NULL, nullable.
   When a lecture session opens a chat thread, the thread is pinned to the
   lecture so the prompt builder can inject a `## LECTURE CONTEXT` block
   (lecture title + cached unified_summary, falling back to lecturer_summary).
   Deleting the lecture nulls the FK; the chat history survives.

No data migration beyond the column rename (Postgres preserves the existing
`manual_summary` values under the new `lecturer_summary` name).

Revision ID: u6t7s8r9q0p1
Revises: t5s6r7q8p9o0
Create Date: 2026-05-11
"""

from alembic import op
import sqlalchemy as sa


revision      = "u6t7s8r9q0p1"
down_revision = "t5s6r7q8p9o0"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # ── Lectures ───────────────────────────────────────────────────────────
    op.alter_column(
        "lectures",
        "manual_summary",
        new_column_name="lecturer_summary",
    )
    op.add_column(
        "lectures",
        sa.Column("student_summaries", sa.Text(), nullable=True),
    )
    op.add_column(
        "lectures",
        sa.Column("unified_summary", sa.Text(), nullable=True),
    )
    op.add_column(
        "lectures",
        sa.Column(
            "unified_summary_processing",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "lectures",
        sa.Column("unified_summary_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "lectures",
        sa.Column(
            "unified_summary_generated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    # ── Threads ────────────────────────────────────────────────────────────
    op.add_column(
        "threads",
        sa.Column(
            "lecture_id",
            sa.Integer(),
            sa.ForeignKey("lectures.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_threads_lecture_id", "threads", ["lecture_id"])


def downgrade() -> None:
    # Threads
    op.drop_index("ix_threads_lecture_id", table_name="threads")
    op.drop_column("threads", "lecture_id")

    # Lectures
    op.drop_column("lectures", "unified_summary_generated_at")
    op.drop_column("lectures", "unified_summary_error")
    op.drop_column("lectures", "unified_summary_processing")
    op.drop_column("lectures", "unified_summary")
    op.drop_column("lectures", "student_summaries")
    op.alter_column(
        "lectures",
        "lecturer_summary",
        new_column_name="manual_summary",
    )
