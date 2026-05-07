"""library_restructure_metadata

Adds the columns needed for the My Library 3-lane restructure (Sessions /
Files / Folders) and the Courses tabbed-page rework:

  • Thread.session_title         — AI-generated collective title for a chat
                                   session, set once after the first
                                   user+assistant exchange and frozen
                                   thereafter (per the locked decision —
                                   only generated once, never refreshed).
                                   NULL for legacy rows; back-filled lazily
                                   by the next message exchange.
  • UserDocument.last_opened_at  — bumps on every doc open (PATCH /touch)
                                   so the Files lane can sort by
                                   recency-of-use rather than recency-of-
                                   upload. NULL for legacy rows; treated
                                   as the doc's `created_at` by the
                                   sessions/library queries until it gets
                                   its first touch.
  • CourseMembership.is_hidden   — lets users hide a course from the My
                                   Courses default view without
                                   unstarring/unowning it. Defaults to
                                   false. Indexed on (user_id, is_hidden)
                                   so the "visible vs hidden" partition
                                   query is a quick range scan.

This migration is purely additive — no NOT NULL, no data backfill (the
new columns default to NULL or false, both of which existing readers
handle as the "not yet known / not hidden" case). Reversible via
`alembic downgrade -1`.

Revision ID: q2p3o4n5m6l7
Revises: p1o2n3m4l5k6
Create Date: 2026-05-08
"""

from alembic import op
import sqlalchemy as sa


revision      = "q2p3o4n5m6l7"
down_revision = "p1o2n3m4l5k6"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # Thread.session_title — collective title for the conversation tree.
    op.add_column("threads", sa.Column("session_title", sa.Text(), nullable=True))

    # UserDocument.last_opened_at — recency-of-use for the Files lane sort.
    op.add_column(
        "userdocuments",
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_userdocuments_last_opened_at",
        "userdocuments",
        ["last_opened_at"],
    )

    # CourseMembership.is_hidden — Visible/Hidden toggle on My Courses.
    op.add_column(
        "course_memberships",
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index(
        "ix_course_memberships_user_hidden",
        "course_memberships",
        ["user_id", "is_hidden"],
    )


def downgrade() -> None:
    op.drop_index("ix_course_memberships_user_hidden", table_name="course_memberships")
    op.drop_column("course_memberships", "is_hidden")

    op.drop_index("ix_userdocuments_last_opened_at", table_name="userdocuments")
    op.drop_column("userdocuments", "last_opened_at")

    op.drop_column("threads", "session_title")
