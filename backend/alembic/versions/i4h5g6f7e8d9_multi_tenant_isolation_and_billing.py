"""multi_tenant_isolation_and_billing

Hardens multi-tenant data isolation and lays the groundwork for token/credit
billing. Phase 1 of the per-user data model — the schema lands here; logging
into usage_events, quota enforcement, and the Settings usage bar are added in
later phases.

Adds to `users`:
  - subscription_tier (String, NOT NULL, default 'free')
  - auth_provider     (String, NOT NULL, default 'password')
  - google_sub        (String, nullable, unique) — Google OAuth subject claim

Adds to `threads`:
  - user_id (Integer, nullable, FK→users.id) — direct ownership of every thread,
    including standalone chat threads with no document. Backfilled from
    userdocuments.user_id where document_id IS NOT NULL; left NULL for
    pre-existing standalone threads (orphans). Listing endpoints filter on
    user_id, so orphan threads remain in the DB but are invisible.

Creates `usage_events`:
  - One row per LLM call. Indexed on (user_id, created_at) for fast
    rolling-window aggregation.

Notes
─────
• Existing users: server defaults backfill subscription_tier='free' and
  auth_provider='password' for every existing row in `users`.
• The legacy shared guest account (email='guest@studyagent.ai') is reclassified
  to subscription_tier='guest' so its tier matches its function. Newly created
  guests will get unique emails of the form 'guest-<uuid>@studyagent.ai'.
• No data migration is performed for `personas.author_id`. Pre-existing personal
  personas with NULL author_id remain in the DB but are filtered out of the
  per-user list view added in this phase. They can still be cleaned up by hand
  via SQL if desired — see active_tracker.md.

Revision ID: i4h5g6f7e8d9
Revises: h3g4f5e6d7c8
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa


revision      = "i4h5g6f7e8d9"
down_revision = "h3g4f5e6d7c8"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # ── 1. Add user-level subscription/auth fields ─────────────────────────
    op.add_column(
        "users",
        sa.Column(
            "subscription_tier",
            sa.String(),
            nullable=False,
            server_default="free",
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "auth_provider",
            sa.String(),
            nullable=False,
            server_default="password",
        ),
    )
    op.add_column(
        "users",
        sa.Column("google_sub", sa.String(), nullable=True),
    )
    op.create_index(
        "ix_users_google_sub",
        "users",
        ["google_sub"],
        unique=True,
    )

    # Reclassify the legacy shared-guest account to tier='guest'.
    # Idempotent: matches by email; no-op if the row was never created.
    op.execute(
        "UPDATE users "
        "SET subscription_tier = 'guest' "
        "WHERE email = 'guest@studyagent.ai'"
    )

    # ── 2. threads.user_id — direct per-user attribution ───────────────────
    op.add_column(
        "threads",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )
    op.create_index("ix_threads_user_id", "threads", ["user_id"])

    # Backfill from userdocuments where the FK chain exists. Standalone threads
    # (document_id IS NULL) and threads pointing at deleted UserDocuments
    # remain NULL — those are filtered out of the per-user listing.
    op.execute(
        "UPDATE threads t "
        "SET user_id = ud.user_id "
        "FROM userdocuments ud "
        "WHERE t.document_id = ud.id"
    )

    # ── 3. usage_events — per-LLM-call billing log ─────────────────────────
    op.create_table(
        "usage_events",
        sa.Column("id",              sa.Integer(),  primary_key=True, autoincrement=True),
        sa.Column("user_id",         sa.Integer(),  sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("provider",        sa.String(),     nullable=False),
        sa.Column("model_alias",     sa.String(16),   nullable=True),
        sa.Column("model_name",      sa.String(),     nullable=True),
        sa.Column("endpoint",        sa.String(),     nullable=False),
        sa.Column("input_tokens",    sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("output_tokens",   sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("credits",         sa.Integer(),    nullable=False, server_default="0"),
        # BIGINT — aggregating micros across many events can exceed INT32 quickly.
        sa.Column("cost_usd_micros", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.create_index("ix_usage_events_id",      "usage_events", ["id"])
    op.create_index("ix_usage_events_user_id", "usage_events", ["user_id"])
    op.create_index(
        "ix_usage_events_user_created_at",
        "usage_events",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_usage_events_user_created_at", table_name="usage_events")
    op.drop_index("ix_usage_events_user_id",         table_name="usage_events")
    op.drop_index("ix_usage_events_id",              table_name="usage_events")
    op.drop_table("usage_events")

    op.drop_index("ix_threads_user_id", table_name="threads")
    op.drop_column("threads", "user_id")

    op.drop_index("ix_users_google_sub", table_name="users")
    op.drop_column("users", "google_sub")
    op.drop_column("users", "auth_provider")
    op.drop_column("users", "subscription_tier")
