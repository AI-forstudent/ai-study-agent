"""lecture_summaries_become_pdf_backed

F-035 — lecturer and student summaries are now PDF uploads, not pasted text.

The previous v7u8t9s0r1q2 migration introduced `content` TEXT on both
`lecture_lecturer_summaries` and `lecture_student_summaries`. Product
direction shifted: a summary is a real document (PDF/DOCX), not freeform
markdown, so the user can open it in a session-style viewer like any
other library document.

Schema changes
──────────────
For each of `lecture_lecturer_summaries` and `lecture_student_summaries`:
  • drop  `content`            TEXT
  • add   `user_document_id`   FK → userdocuments.id, nullable,
                                ON DELETE SET NULL (so library cleanup
                                doesn't lose the lecture metadata row).

Data migration
──────────────
Existing rows from the v7u8t9s0r1q2 backfill (rows that captured the
old single-column F-033 text) will have NULL `user_document_id` after
this migration runs. The text content is lost on purpose — the new
product model treats summaries as documents, not markdown blobs, so
the user is expected to re-upload as a PDF. Empty rows surface a clear
"missing file" state in the UI rather than a half-converted artifact.

Revision ID: w8v9u0t1s2r3
Revises: v7u8t9s0r1q2
Create Date: 2026-05-11
"""

from alembic import op
import sqlalchemy as sa


revision      = "w8v9u0t1s2r3"
down_revision = "v7u8t9s0r1q2"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # ── lecture_lecturer_summaries ─────────────────────────────────────────
    op.add_column(
        "lecture_lecturer_summaries",
        sa.Column(
            "user_document_id",
            sa.Integer(),
            sa.ForeignKey("userdocuments.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_lecture_lecturer_summaries_user_document_id",
        "lecture_lecturer_summaries",
        ["user_document_id"],
    )
    op.drop_column("lecture_lecturer_summaries", "content")

    # ── lecture_student_summaries ──────────────────────────────────────────
    op.add_column(
        "lecture_student_summaries",
        sa.Column(
            "user_document_id",
            sa.Integer(),
            sa.ForeignKey("userdocuments.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_lecture_student_summaries_user_document_id",
        "lecture_student_summaries",
        ["user_document_id"],
    )
    op.drop_column("lecture_student_summaries", "content")


def downgrade() -> None:
    op.add_column("lecture_student_summaries", sa.Column("content", sa.Text(), nullable=True))
    op.drop_index("ix_lecture_student_summaries_user_document_id", table_name="lecture_student_summaries")
    op.drop_column("lecture_student_summaries", "user_document_id")

    op.add_column("lecture_lecturer_summaries", sa.Column("content", sa.Text(), nullable=True))
    op.drop_index("ix_lecture_lecturer_summaries_user_document_id", table_name="lecture_lecturer_summaries")
    op.drop_column("lecture_lecturer_summaries", "user_document_id")
