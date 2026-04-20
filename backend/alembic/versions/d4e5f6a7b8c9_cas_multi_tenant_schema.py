"""CAS multi-tenant schema: BaseDocument + UserDocument split

Replaces the legacy `documents` table with two tables:
  • basedocuments  — SHA-256 content-addressed record (one per unique file)
  • userdocuments  — per-user workspace replica linking to basedocuments

All downstream tables are dropped and recreated with updated FKs:
  • chunks / page_summaries / lecture_videos / video_sync_index
      base_hash (String FK → basedocuments.hash_id)  was: document_id (Integer)
  • threads / study_sessions
      document_id (Integer FK → userdocuments.id)    was: document_id (Integer FK → documents.id)

Data safety: this migration performs a clean drop-and-recreate of all tables
that depended on `documents`. Run only in development after backing up any
data you need to retain.

Revision ID: d4e5f6a7b8c9
Revises: c94831423efe
Create Date: 2026-04-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from pgvector.sqlalchemy import Vector

revision    = 'd4e5f6a7b8c9'
down_revision = 'a573eb3c552f'
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # ── 1. Drop all tables that depend on `documents` (reverse topo-sort) ──
    op.drop_table('session_memories')
    op.drop_table('study_sessions')
    op.drop_table('video_sync_index')
    op.drop_table('lecture_videos')
    op.drop_table('page_summaries')
    op.drop_table('chunks')
    # Break the circular FK threads ↔ messages before dropping either table
    # Constraint name comes from PostgreSQL's default naming (not the use_alter alias)
    op.drop_constraint('threads_forked_from_message_id_fkey', 'threads', type_='foreignkey')
    op.drop_table('messages')
    op.drop_table('threads')
    op.drop_table('documents')

    # ── 2. Create basedocuments ─────────────────────────────────────────────
    op.create_table(
        'basedocuments',
        sa.Column('hash_id',           sa.String(64),  primary_key=True),
        sa.Column('original_filename', sa.String(),    nullable=False),
        sa.Column('file_path',         sa.String(),    nullable=True),
        sa.Column('source_type',       sa.String(),    nullable=False, server_default='UPLOAD'),
        sa.Column('source_url',        sa.String(),    nullable=True),
        sa.Column('doc_type',          sa.String(),    nullable=False, server_default='GENERAL'),
        sa.Column('parent_hash',       sa.String(64),
                  sa.ForeignKey('basedocuments.hash_id'), nullable=True),
        sa.Column('global_summary',    sa.Text(),      nullable=True),
        sa.Column('metadata',          JSONB(),        nullable=False, server_default='{}'),
        sa.Column('created_at',        sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
    )
    op.create_index('ix_basedocuments_hash_id', 'basedocuments', ['hash_id'])

    # ── 3. Create userdocuments ─────────────────────────────────────────────
    op.create_table(
        'userdocuments',
        sa.Column('id',               sa.Integer(),   primary_key=True, autoincrement=True),
        sa.Column('user_id',          sa.Integer(),
                  sa.ForeignKey('users.id'),          nullable=False),
        sa.Column('base_hash',        sa.String(64),
                  sa.ForeignKey('basedocuments.hash_id'), nullable=False),
        sa.Column('custom_title',     sa.String(),    nullable=False),
        sa.Column('folder_id',        sa.String(),    nullable=True),
        sa.Column('personal_summary', sa.Text(),      nullable=True),
        sa.Column('is_public',        sa.Boolean(),   nullable=False, server_default='false'),
        sa.Column('ai_feedback',      JSONB(),        nullable=True),
        sa.Column('created_at',       sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
        sa.Column('shared_at',        sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_userdocuments_id', 'userdocuments', ['id'])

    # ── 4. Recreate threads (document_id → userdocuments.id) ───────────────
    op.create_table(
        'threads',
        sa.Column('id',                     sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('document_id',            sa.Integer(),
                  sa.ForeignKey('userdocuments.id'), nullable=True),
        sa.Column('parent_thread_id',       sa.Integer(),
                  sa.ForeignKey('threads.id'),        nullable=True),
        sa.Column('forked_from_message_id', sa.Integer(), nullable=True),   # circular FK added later
        sa.Column('page_number',            sa.Integer(),  nullable=True),
        sa.Column('coordinates',            JSONB(),       nullable=True),
        sa.Column('selected_text',          sa.Text(),     nullable=True),
        sa.Column('emoji',                  sa.String(),   nullable=True),
        sa.Column('title',                  sa.String(),   nullable=True),
        sa.Column('persona_id',             sa.String(),
                  sa.ForeignKey('personas.id'),       nullable=True),
        sa.Column('created_at',             sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
    )
    op.create_index('ix_threads_id', 'threads', ['id'])

    # ── 5. Recreate messages ────────────────────────────────────────────────
    op.create_table(
        'messages',
        sa.Column('id',          sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('thread_id',   sa.Integer(),
                  sa.ForeignKey('threads.id'), nullable=False),
        sa.Column('role',        sa.String(),  nullable=False),
        sa.Column('content',     sa.Text(),    nullable=False),
        sa.Column('created_at',  sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
        sa.Column('model_alias', sa.String(16), nullable=True),
    )
    op.create_index('ix_messages_id', 'messages', ['id'])

    # Re-add the circular FK from threads.forked_from_message_id → messages.id
    op.create_foreign_key(
        'fk_thread_forked_from_message',
        'threads', 'messages',
        ['forked_from_message_id'], ['id'],
    )

    # ── 6. Recreate chunks (base_hash replaces document_id) ────────────────
    op.create_table(
        'chunks',
        sa.Column('id',          sa.Integer(),    primary_key=True, autoincrement=True),
        sa.Column('base_hash',   sa.String(64),
                  sa.ForeignKey('basedocuments.hash_id'), nullable=False),
        sa.Column('text',        sa.Text(),       nullable=False),
        sa.Column('chunk_index', sa.Integer(),    nullable=False),
        sa.Column('page_number', sa.Integer(),    nullable=True),
        sa.Column('embedding',   Vector(768)),
    )
    op.create_index('ix_chunks_id', 'chunks', ['id'])

    # ── 7. Recreate page_summaries ──────────────────────────────────────────
    op.create_table(
        'page_summaries',
        sa.Column('id',          sa.Integer(),    primary_key=True, autoincrement=True),
        sa.Column('base_hash',   sa.String(64),
                  sa.ForeignKey('basedocuments.hash_id'), nullable=False),
        sa.Column('page_number', sa.Integer(),    nullable=False),
        sa.Column('summary',     sa.Text(),       nullable=False),
        sa.Column('created_at',  sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
    )
    op.create_index('ix_page_summaries_id', 'page_summaries', ['id'])

    # ── 8. Recreate lecture_videos ──────────────────────────────────────────
    op.create_table(
        'lecture_videos',
        sa.Column('id',              sa.Integer(),     primary_key=True, autoincrement=True),
        sa.Column('base_hash',       sa.String(64),
                  sa.ForeignKey('basedocuments.hash_id'), nullable=False),
        sa.Column('video_reference', sa.String(1024),  nullable=False),
        sa.Column('total_duration',  sa.Integer(),     nullable=True),
        sa.Column('created_at',      sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
    )
    op.create_index('ix_lecture_videos_id', 'lecture_videos', ['id'])

    # ── 9. Recreate video_sync_index ────────────────────────────────────────
    op.create_table(
        'video_sync_index',
        sa.Column('id',                sa.Integer(),    primary_key=True, autoincrement=True),
        sa.Column('base_hash',         sa.String(64),
                  sa.ForeignKey('basedocuments.hash_id'), nullable=False),
        sa.Column('lecture_video_id',  sa.Integer(),
                  sa.ForeignKey('lecture_videos.id'),   nullable=False),
        sa.Column('page_or_slide_num', sa.Integer(),    nullable=False),
        sa.Column('start_time_sec',    sa.Integer(),    nullable=False),
        sa.Column('end_time_sec',      sa.Integer(),    nullable=False),
        sa.Column('topics_covered',    sa.Text(),       nullable=True),
    )
    op.create_index('ix_video_sync_index_id', 'video_sync_index', ['id'])

    # ── 10. Recreate study_sessions (document_id → userdocuments.id) ───────
    op.create_table(
        'study_sessions',
        sa.Column('id',               sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id',          sa.Integer(),
                  sa.ForeignKey('users.id'),          nullable=False),
        sa.Column('document_id',      sa.Integer(),
                  sa.ForeignKey('userdocuments.id'),  nullable=True),
        sa.Column('persona_id',       sa.String(),
                  sa.ForeignKey('personas.id'),        nullable=True),
        sa.Column('active_thread_id', sa.Integer(),
                  sa.ForeignKey('threads.id'),         nullable=True),
        sa.Column('created_at',       sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
        sa.Column('last_accessed_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
    )
    op.create_index('ix_study_sessions_id', 'study_sessions', ['id'])

    # ── 11. Recreate session_memories ───────────────────────────────────────
    op.create_table(
        'session_memories',
        sa.Column('id',                   sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('session_id',           sa.Integer(),
                  sa.ForeignKey('study_sessions.id'), nullable=False),
        sa.Column('persona_id',           sa.String(),
                  sa.ForeignKey('personas.id'),        nullable=False),
        sa.Column('compression_level',    sa.Integer(), nullable=False),
        sa.Column('injected_memory_text', sa.Text(),    nullable=False),
        sa.Column('created_at',           sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
    )
    op.create_index('ix_session_memories_id', 'session_memories', ['id'])


def downgrade() -> None:
    # Drop new tables in reverse dependency order
    op.drop_table('session_memories')
    op.drop_table('study_sessions')
    op.drop_table('video_sync_index')
    op.drop_table('lecture_videos')
    op.drop_table('page_summaries')
    op.drop_table('chunks')
    op.drop_constraint('fk_thread_forked_from_message', 'threads', type_='foreignkey')  # new name
    op.drop_table('messages')
    op.drop_table('threads')
    op.drop_table('userdocuments')
    op.drop_table('basedocuments')

    # Restore legacy documents table (data is not restored — dev migration only)
    op.create_table(
        'documents',
        sa.Column('id',                 sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id',            sa.Integer(),
                  sa.ForeignKey('users.id'),           nullable=False),
        sa.Column('title',              sa.String(),   nullable=False),
        sa.Column('file_path',          sa.String(),   nullable=True),
        sa.Column('summary',            sa.Text(),     nullable=True),
        sa.Column('default_persona_id', sa.String(),
                  sa.ForeignKey('personas.id'),        nullable=True),
        sa.Column('is_public',          sa.Boolean(),  nullable=False, server_default='false'),
        sa.Column('shared_at',          sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at',         sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
        sa.Column('content_hash',       sa.String(64), nullable=True),
        sa.Column('storage_url',        sa.String(512), nullable=True),
    )
    op.create_index('ix_documents_id', 'documents', ['id'])
    op.create_index('ix_documents_content_hash', 'documents', ['content_hash'])
    # Note: dependent tables (threads, chunks, etc.) are not restored here.
    # Re-run the previous migration head if you need full rollback.
