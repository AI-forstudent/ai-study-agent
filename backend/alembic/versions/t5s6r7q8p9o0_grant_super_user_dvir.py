"""grant_super_user_dvir

Adds `dvireshel216@gmail.com` as a second platform-scope `super_user`,
mirroring the bootstrap that the Phase-1 multi-tenancy migration
(`p1o2n3m4l5k6`) did for `lior.livovsky213@gmail.com`.

Per-user note (2026-05-08): Lior asked for Dvir to be added as a
super_user; the admin-UI flow was throwing an error on his end. Going
through Alembic side-steps any UI bug AND keeps the grant reproducible
across environments — every dev/prod box that runs `alembic upgrade
head` ends up with both super-users.

Difference from the original bootstrap
──────────────────────────────────────
The original p1o2n3m4l5k6 RAISEd an exception if Lior's user row was
missing — the whole multi-tenancy story was load-bearing on him being
a super-user. This migration is *additive*: if Dvir hasn't registered
yet (no `users` row with that email) we just emit a NOTICE and skip,
so the migration still applies cleanly on environments where he isn't
seeded yet. He becomes super-user the moment the migration is re-run
after registration — except the admin UI also accepts manual grants,
so in practice you'd just register, then have Lior grant via UI
without redeploying.

Idempotency: ON CONFLICT DO NOTHING. Re-running the migration after
revoking via the admin UI will NOT re-grant — that's intentional, the
admin UI is the authoritative surface once a super-user exists.

Revision ID: t5s6r7q8p9o0
Revises: s4r5q6p7o8n9
Create Date: 2026-05-08
"""

from alembic import op


revision      = "t5s6r7q8p9o0"
down_revision = "s4r5q6p7o8n9"
branch_labels = None
depends_on    = None


TARGET_EMAIL = "dvireshel216@gmail.com"


def upgrade() -> None:
    # The DO block is the same shape as the Phase-1 bootstrap. The only
    # behavioural change is RAISE NOTICE (skip) vs RAISE EXCEPTION (abort)
    # on missing user — see the docstring for why.
    op.execute(f"""
        DO $$
        DECLARE
            target_id integer;
        BEGIN
            SELECT id INTO target_id
              FROM users
             WHERE email = '{TARGET_EMAIL}';

            IF target_id IS NULL THEN
                RAISE NOTICE
                    'super_user grant skipped — no user row with email '
                    '{TARGET_EMAIL}. Have them register, then re-run '
                    'this migration or grant via the admin UI.';
            ELSE
                INSERT INTO role_assignments
                    (user_id, role, scope_type, scope_id, granted_by,
                     granted_via, granted_at)
                VALUES
                    (target_id, 'super_user', 'platform', NULL, NULL,
                     'super_user_bootstrap', now())
                ON CONFLICT DO NOTHING;
            END IF;
        END$$;
    """)


def downgrade() -> None:
    # Revoke the platform-scope super_user grant for this exact email.
    # Doesn't touch any other roles the user might hold (e.g. an
    # org_admin grant in some org) — those came in via different paths
    # and shouldn't disappear when this migration is rolled back.
    op.execute(f"""
        DELETE FROM role_assignments ra
         USING users u
         WHERE ra.user_id    = u.id
           AND u.email       = '{TARGET_EMAIL}'
           AND ra.role       = 'super_user'
           AND ra.scope_type = 'platform'
           AND ra.scope_id   IS NULL;
    """)
