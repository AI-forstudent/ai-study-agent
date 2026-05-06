"""exam_processing_status

Adds explicit processing-status tracking on `exams` so the upload flow can
return immediately and run the AI pipeline as a BackgroundTask. Without
this, the synchronous request takes 60-150s for a 25-question exam and
nginx (60s default proxy_read_timeout) drops the connection — users see
"upload got stuck" and can't recover because the file is in CAS.

New columns
───────────
• exams.processing_status (VARCHAR, NOT NULL, default 'pending')
    pending      — exam row created, BackgroundTask queued, not yet running
    processing   — AI pipeline in flight
    completed    — questions extracted, tags assigned, difficulty computed
    failed       — extraction or tagging blew up; processing_error has details

• exams.processing_error  (TEXT, NULL)
    User-friendly message produced by services.llm_json.user_message_for —
    surfaced in the UI on failed exams next to a Retry button.

Backfill
────────
Existing rows: status = 'completed' if processed_at is set, else 'failed'.

Revision ID: m8l9k0j1i2h3
Revises: l7k8j9i0h1g2
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa


revision      = "m8l9k0j1i2h3"
down_revision = "l7k8j9i0h1g2"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.add_column(
        "exams",
        sa.Column(
            "processing_status",
            sa.String(),
            nullable=False,
            server_default="pending",
        ),
    )
    op.add_column(
        "exams",
        sa.Column("processing_error", sa.Text(), nullable=True),
    )

    # Backfill existing rows: anything previously processed is 'completed';
    # anything that was abandoned is 'failed' so the UI can surface it.
    op.execute(
        "UPDATE exams "
        "SET processing_status = CASE "
        "  WHEN processed_at IS NOT NULL THEN 'completed' "
        "  ELSE 'failed' "
        "END"
    )


def downgrade() -> None:
    op.drop_column("exams", "processing_error")
    op.drop_column("exams", "processing_status")
