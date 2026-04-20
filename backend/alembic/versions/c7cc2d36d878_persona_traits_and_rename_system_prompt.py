"""persona_traits_and_rename_system_prompt

Revision ID: c7cc2d36d878
Revises: 7d17ad8b41b7
Create Date: 2026-04-13 15:39:49.036716

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c7cc2d36d878'
down_revision: Union[str, Sequence[str], None] = '7d17ad8b41b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename system_prompt → manual_prompt_override and drop NOT NULL constraint.
    # Data is preserved in-place by PostgreSQL during the rename.
    op.alter_column(
        'personas', 'system_prompt',
        new_column_name='manual_prompt_override',
        existing_type=sa.Text(),
        nullable=True,
    )
    # Add the new traits column for the component-based prompt builder.
    op.add_column('personas', sa.Column('traits', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('personas', 'traits')
    op.alter_column(
        'personas', 'manual_prompt_override',
        new_column_name='system_prompt',
        existing_type=sa.Text(),
        nullable=False,
    )
