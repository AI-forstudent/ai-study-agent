"""add_manual_gpa_to_academic_profiles

Adds manual_gpa (Float, nullable) to academic_profiles.
This column lets users supply their own GPA override when the calculated
weighted average does not reflect their official transcript.

Revision ID: g2f3e4d5c6b7
Revises: f1e2d3c4b5a6
Create Date: 2026-04-25
"""

from alembic import op
import sqlalchemy as sa

revision      = "g2f3e4d5c6b7"
down_revision = "f1e2d3c4b5a6"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.add_column(
        "academic_profiles",
        sa.Column("manual_gpa", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("academic_profiles", "manual_gpa")
