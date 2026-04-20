"""add folders table and update userdocuments

Revision ID: e1f2a3b4c5d6
Revises: d4e5f6a7b8c9
Create Date: 2026-04-20

Changes:
  - Create `folders` table (id, user_id, name, color, is_starred, persona_id, created_at)
  - Drop old String `folder_id` column from `userdocuments`
  - Add Integer FK `folder_id` referencing folders.id to `userdocuments`
  - Add Boolean `is_starred` column to `userdocuments`
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = 'e1f2a3b4c5d6'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Create folders table ──────────────────────────────────────────────
    op.create_table(
        'folders',
        sa.Column('id',         sa.Integer(),                    nullable=False),
        sa.Column('user_id',    sa.Integer(),                    nullable=False),
        sa.Column('name',       sa.String(),                     nullable=False),
        sa.Column('color',      sa.String(),                     nullable=True),
        sa.Column('is_starred', sa.Boolean(),                    nullable=False, server_default='false'),
        sa.Column('persona_id', sa.String(),                     nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),      server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['user_id'],    ['users.id'],    name='fk_folder_user'),
        sa.ForeignKeyConstraint(['persona_id'], ['personas.id'], name='fk_folder_persona'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_folders_id', 'folders', ['id'])

    # ── 2. Migrate userdocuments.folder_id: String → Integer FK ─────────────
    op.drop_column('userdocuments', 'folder_id')
    op.add_column('userdocuments', sa.Column('folder_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_userdoc_folder', 'userdocuments', 'folders',
        ['folder_id'], ['id'],
    )

    # ── 3. Add is_starred to userdocuments ────────────────────────────────────
    op.add_column('userdocuments', sa.Column(
        'is_starred', sa.Boolean(), nullable=False, server_default='false',
    ))


def downgrade() -> None:
    op.drop_column('userdocuments', 'is_starred')
    op.drop_constraint('fk_userdoc_folder', 'userdocuments', type_='foreignkey')
    op.drop_column('userdocuments', 'folder_id')
    op.add_column('userdocuments', sa.Column('folder_id', sa.String(), nullable=True))
    op.drop_index('ix_folders_id', table_name='folders')
    op.drop_table('folders')
