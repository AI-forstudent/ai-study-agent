"""unified_summary_pdf_document

F-036 — the unified summary is now rendered into a PDF and stored as a
UserDocument so the lecture viewer can open it inside MainWorkspace
identically to any other PDF in the library.

The markdown text stays on `lectures.unified_summary` for fallback /
future LaTeX export — it's still the canonical AI output. The new
column `lectures.unified_summary_document_id` points at the rendered
PDF UserDocument (nullable, ON DELETE SET NULL so library cleanup
doesn't blow away the lecture row).

Revision ID: x9w0v1u2t3s4
Revises: w8v9u0t1s2r3
Create Date: 2026-05-11
"""

from alembic import op
import sqlalchemy as sa


revision      = "x9w0v1u2t3s4"
down_revision = "w8v9u0t1s2r3"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.add_column(
        "lectures",
        sa.Column(
            "unified_summary_document_id",
            sa.Integer(),
            sa.ForeignKey("userdocuments.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_lectures_unified_summary_document_id",
        "lectures",
        ["unified_summary_document_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_lectures_unified_summary_document_id", table_name="lectures")
    op.drop_column("lectures", "unified_summary_document_id")
