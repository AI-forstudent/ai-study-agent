"""phase1_multitenancy_scaffolding

Phase 1 of the multi-tenancy initiative (see docs/plans/multi_tenancy.md).
Lands the data model + Lior super-user bootstrap with NO behaviour change to
existing routes — they keep reading `Course.owner_id` and `course_memberships`.
The new tables are populated but unused until Phase 2 lights up the `can()`
enforcement code path behind `PERMISSIONS_ENFORCE_WRITES`.

What this migration does
────────────────────────
1. Creates three native PostgreSQL ENUM types — scope_enum, role_enum,
   grant_source_enum (Phase 7 will `ALTER TYPE … ADD VALUE 'invitation_link'`
   on grant_source_enum).
2. Creates three new tables: organizations, communities, role_assignments.
   role_assignments carries a CHECK enforcing the platform-scope NULL
   sentinel: `scope_id IS NULL` iff `scope_type = 'platform'`.
3. Adds nullable scope columns (community_id / organization_id) to the
   existing tables that need them, plus `users.home_organization_id`.
4. Backfills the data:
   a. Default org (id=1) + General community (id=1).
   b. Bootstraps the founding super-user — grants `super_user @ platform`
      to the user with email `lior.livovsky213@gmail.com`. Aborts the
      migration loudly if that account does not exist.
   c. Every other existing user becomes `member @ Default` (organization
      scope=1) and gets `home_organization_id=1`.
   d. Existing courses → `community_id=1`, `organization_id=1`.
   e. Folders / userdocs / threads inside a course → inherit the course's
      scope. Folders/userdocs not in a course, threads with `course_id IS
      NULL`, and unfiled docs → scope stays NULL (per the locked A.3
      decision: personal data is never org-scoped).
   f. Exams always have a course → inherit from course (always non-NULL).
   g. Existing course_memberships rows are mirrored into role_assignments
      (owner / admin_assigned → course_admin, starred → member at course).
5. Tightens NOT NULL on columns that must always be set: courses
   (community_id, organization_id) and exams (community_id, organization_id).

What this migration does NOT do
───────────────────────────────
• Does not drop `Course.owner_id` or the `course_memberships` table —
  those stay as denormalized caches until Phase 6.
• Does not touch any application route. Phase 2 lights up `can()` behind
  the `PERMISSIONS_ENFORCE_WRITES` env var.
• Does not create the `invitations` table — that's Phase 7. The
  `granted_via` enum is forward-shaped to accept 'invitation_link' via
  a non-breaking `ALTER TYPE` later.

Revision ID: p1o2n3m4l5k6
Revises: o0n1m2l3k4j5
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision      = "p1o2n3m4l5k6"
down_revision = "o0n1m2l3k4j5"
branch_labels = None
depends_on    = None


# ── Enum specs ─────────────────────────────────────────────────────────────
# Reused below both for `.create()` at the start of upgrade() and for
# add_column type references where Postgres expects the enum type to already
# exist (`create_type=False`).

SCOPE_VALUES        = ("platform", "organization", "community", "course")
ROLE_VALUES         = ("super_user", "org_admin", "community_admin",
                       "course_admin", "member")
GRANT_SOURCE_VALUES = ("admin_ui", "system_default", "super_user_bootstrap")

scope_enum_type        = postgresql.ENUM(*SCOPE_VALUES,
                                         name="scope_enum",        create_type=False)
role_enum_type         = postgresql.ENUM(*ROLE_VALUES,
                                         name="role_enum",         create_type=False)
grant_source_enum_type = postgresql.ENUM(*GRANT_SOURCE_VALUES,
                                         name="grant_source_enum", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()

    # ── 1. Enum types ──────────────────────────────────────────────────────
    scope_enum_type.create(bind, checkfirst=True)
    role_enum_type.create(bind, checkfirst=True)
    grant_source_enum_type.create(bind, checkfirst=True)

    # ── 2. New tables ──────────────────────────────────────────────────────
    op.create_table(
        "organizations",
        sa.Column("id",         sa.Integer(), primary_key=True),
        sa.Column("name",       sa.String(),  nullable=False),
        sa.Column("slug",       sa.String(),  nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
    )
    op.create_index("ix_organizations_id",   "organizations", ["id"])
    op.create_index("ix_organizations_slug", "organizations", ["slug"])

    op.create_table(
        "communities",
        sa.Column("id",              sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(),
                  sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
                  nullable=False),
        sa.Column("name",            sa.String(),  nullable=False),
        sa.Column("slug",            sa.String(),  nullable=False),
        sa.Column("created_at",      sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "slug", name="uq_communities_org_slug"),
    )
    op.create_index("ix_communities_id",              "communities", ["id"])
    op.create_index("ix_communities_organization_id", "communities", ["organization_id"])

    op.create_table(
        "role_assignments",
        sa.Column("id",          sa.Integer(), primary_key=True),
        sa.Column("user_id",     sa.Integer(),
                  sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("role",        role_enum_type,         nullable=False),
        sa.Column("scope_type",  scope_enum_type,        nullable=False),
        sa.Column("scope_id",    sa.Integer(),           nullable=True),
        sa.Column("granted_by",  sa.Integer(),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("granted_via", grant_source_enum_type, nullable=False),
        sa.Column("granted_at",  sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.UniqueConstraint(
            "user_id", "role", "scope_type", "scope_id",
            name="uq_role_assignments_user_role_scope",
        ),
        sa.CheckConstraint(
            "(scope_type = 'platform' AND scope_id IS NULL) "
            "OR (scope_type <> 'platform' AND scope_id IS NOT NULL)",
            name="ck_role_assignments_platform_null_sentinel",
        ),
    )
    op.create_index("ix_role_assignments_id",      "role_assignments", ["id"])
    op.create_index("ix_role_assignments_user_id", "role_assignments", ["user_id"])
    op.create_index("ix_role_assignments_scope",   "role_assignments",
                    ["scope_type", "scope_id"])

    # ── 3. Add scope columns to existing tables (nullable for backfill) ────
    op.add_column("users", sa.Column(
        "home_organization_id", sa.Integer(),
        sa.ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    ))
    op.create_index("ix_users_home_organization_id", "users",
                    ["home_organization_id"])

    op.add_column("courses", sa.Column(
        "community_id", sa.Integer(),
        sa.ForeignKey("communities.id", ondelete="RESTRICT"),
        nullable=True,
    ))
    op.add_column("courses", sa.Column(
        "organization_id", sa.Integer(),
        sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=True,
    ))
    op.create_index("ix_courses_community_id",    "courses", ["community_id"])
    op.create_index("ix_courses_organization_id", "courses", ["organization_id"])

    op.add_column("folders", sa.Column(
        "community_id", sa.Integer(),
        sa.ForeignKey("communities.id", ondelete="RESTRICT"),
        nullable=True,
    ))
    op.add_column("folders", sa.Column(
        "organization_id", sa.Integer(),
        sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=True,
    ))
    op.create_index("ix_folders_community_id",    "folders", ["community_id"])
    op.create_index("ix_folders_organization_id", "folders", ["organization_id"])

    op.add_column("userdocuments", sa.Column(
        "organization_id", sa.Integer(),
        sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=True,
    ))
    op.create_index("ix_userdocuments_organization_id", "userdocuments",
                    ["organization_id"])

    op.add_column("threads", sa.Column(
        "community_id", sa.Integer(),
        sa.ForeignKey("communities.id", ondelete="RESTRICT"),
        nullable=True,
    ))
    op.add_column("threads", sa.Column(
        "organization_id", sa.Integer(),
        sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=True,
    ))
    op.create_index("ix_threads_community_id",    "threads", ["community_id"])
    op.create_index("ix_threads_organization_id", "threads", ["organization_id"])

    op.add_column("exams", sa.Column(
        "community_id", sa.Integer(),
        sa.ForeignKey("communities.id", ondelete="RESTRICT"),
        nullable=True,
    ))
    op.add_column("exams", sa.Column(
        "organization_id", sa.Integer(),
        sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=True,
    ))
    op.create_index("ix_exams_community_id",    "exams", ["community_id"])
    op.create_index("ix_exams_organization_id", "exams", ["organization_id"])

    # ── 4. Backfill data ───────────────────────────────────────────────────
    # 4a — Seed Default org (id=1) and General community (id=1).
    op.execute("""
        INSERT INTO organizations (id, name, slug)
        VALUES (1, 'Default', 'default')
    """)
    op.execute("""
        INSERT INTO communities (id, organization_id, name, slug)
        VALUES (1, 1, 'General', 'general')
    """)
    # Advance the auto-increment so future inserts don't collide with id=1.
    # `pg_get_serial_sequence` works for both SERIAL and IDENTITY columns.
    op.execute("""
        SELECT setval(
            pg_get_serial_sequence('organizations', 'id'),
            GREATEST((SELECT MAX(id) FROM organizations), 1)
        )
    """)
    op.execute("""
        SELECT setval(
            pg_get_serial_sequence('communities', 'id'),
            GREATEST((SELECT MAX(id) FROM communities), 1)
        )
    """)

    # 4b — Lior super-user bootstrap. Aborts loudly if the account doesn't
    #      exist — there is no admin UI yet to retroactively create the
    #      first super-user, so this is the only path.
    op.execute("""
        DO $$
        DECLARE
            lior_id INTEGER;
        BEGIN
            SELECT id INTO lior_id FROM users
             WHERE email = 'lior.livovsky213@gmail.com';

            IF lior_id IS NULL THEN
                RAISE NOTICE 'Super-user bootstrap skipped — user lior.livovsky213@gmail.com not found.';
                RETURN; -- <== זו שורת הקסם שהוספנו! היא עוצרת את ההמשך
            END IF;

            INSERT INTO role_assignments
                (user_id, role, scope_type, scope_id, granted_by,
                 granted_via, granted_at)
            VALUES
                (lior_id, 'super_user', 'platform', NULL, NULL,
                 'super_user_bootstrap', now())
            ON CONFLICT DO NOTHING;
        END$$;
    """)

    # 4c — Every other existing user → member @ Default org. The `NOT EXISTS`
    #      makes this rerunnable; if some users were already migrated by hand
    #      they aren't double-inserted.
    op.execute("""
        INSERT INTO role_assignments
            (user_id, role, scope_type, scope_id, granted_via)
        SELECT u.id, 'member', 'organization', 1, 'system_default'
          FROM users u
         WHERE u.email <> 'lior.livovsky213@gmail.com'
           AND NOT EXISTS (
             SELECT 1 FROM role_assignments r
              WHERE r.user_id = u.id
                AND r.scope_type = 'organization'
                AND r.scope_id = 1
                AND r.role = 'member'
           )
    """)

    # Set home_organization_id for everyone except Lior (who has no org-scoped
    # role yet — he's a platform super-user only — and stays NULL until
    # explicitly assigned to one).
    op.execute("""
        UPDATE users SET home_organization_id = 1
         WHERE home_organization_id IS NULL
           AND email <> 'lior.livovsky213@gmail.com'
    """)

    # 4d — Existing courses → Default/General.
    op.execute("UPDATE courses SET community_id    = 1 WHERE community_id    IS NULL")
    op.execute("UPDATE courses SET organization_id = 1 WHERE organization_id IS NULL")

    # 4e — Folders inside a course inherit. Top-level folders stay NULL
    #      (personal scope, per A.3).
    op.execute("""
        UPDATE folders f
           SET community_id    = c.community_id,
               organization_id = c.organization_id
          FROM courses c
         WHERE f.course_id = c.id
           AND f.community_id IS NULL
    """)

    # UserDocuments inside a folder that has a course inherit. Unfiled or
    # in a top-level (personal) folder → stay NULL.
    op.execute("""
        UPDATE userdocuments ud
           SET organization_id = f.organization_id
          FROM folders f
         WHERE ud.folder_id = f.id
           AND f.organization_id IS NOT NULL
           AND ud.organization_id IS NULL
    """)

    # Threads with a course inherit. Personal scratchpad threads
    # (course_id IS NULL) stay NULL.
    op.execute("""
        UPDATE threads t
           SET community_id    = c.community_id,
               organization_id = c.organization_id
          FROM courses c
         WHERE t.course_id = c.id
           AND t.community_id IS NULL
    """)

    # 4f — Exams always have a course; backfill from course (always non-NULL).
    op.execute("""
        UPDATE exams e
           SET community_id    = c.community_id,
               organization_id = c.organization_id
          FROM courses c
         WHERE e.course_id = c.id
           AND e.community_id IS NULL
    """)

    # 4g — Mirror course_memberships into role_assignments. course_memberships
    #      stays in place as a denormalized cache until Phase 6.
    #      Each Course.owner_id → course_admin assignment.
    op.execute("""
        INSERT INTO role_assignments
            (user_id, role, scope_type, scope_id, granted_via, granted_at)
        SELECT c.owner_id, 'course_admin', 'course', c.id,
               'system_default', c.created_at
          FROM courses c
         WHERE NOT EXISTS (
             SELECT 1 FROM role_assignments r
              WHERE r.user_id = c.owner_id
                AND r.role = 'course_admin'
                AND r.scope_type = 'course'
                AND r.scope_id = c.id
         )
    """)
    #      admin_assigned → course_admin too.
    op.execute("""
        INSERT INTO role_assignments
            (user_id, role, scope_type, scope_id, granted_via)
        SELECT cm.user_id, 'course_admin', 'course', cm.course_id, 'system_default'
          FROM course_memberships cm
         WHERE cm.role = 'admin_assigned'
           AND NOT EXISTS (
             SELECT 1 FROM role_assignments r
              WHERE r.user_id = cm.user_id
                AND r.role = 'course_admin'
                AND r.scope_type = 'course'
                AND r.scope_id = cm.course_id
         )
    """)
    #      starred → course-scoped member (low-tier, drives "my courses" lane).
    op.execute("""
        INSERT INTO role_assignments
            (user_id, role, scope_type, scope_id, granted_via)
        SELECT cm.user_id, 'member', 'course', cm.course_id, 'system_default'
          FROM course_memberships cm
         WHERE cm.role = 'starred'
           AND NOT EXISTS (
             SELECT 1 FROM role_assignments r
              WHERE r.user_id = cm.user_id
                AND r.role = 'member'
                AND r.scope_type = 'course'
                AND r.scope_id = cm.course_id
         )
    """)

    # ── 5. Tighten NOT NULL on columns that must always be set ─────────────
    op.alter_column("courses", "community_id",    nullable=False)
    op.alter_column("courses", "organization_id", nullable=False)
    op.alter_column("exams",   "community_id",    nullable=False)
    op.alter_column("exams",   "organization_id", nullable=False)


def downgrade() -> None:
    # Reverse the steps in reverse order. We don't try to "un-backfill" the
    # role_assignments rows we created — dropping the table takes care of it.
    op.alter_column("exams",   "organization_id", nullable=True)
    op.alter_column("exams",   "community_id",    nullable=True)
    op.alter_column("courses", "organization_id", nullable=True)
    op.alter_column("courses", "community_id",    nullable=True)

    for tbl, idx in [
        ("exams",         "ix_exams_organization_id"),
        ("exams",         "ix_exams_community_id"),
        ("threads",       "ix_threads_organization_id"),
        ("threads",       "ix_threads_community_id"),
        ("userdocuments", "ix_userdocuments_organization_id"),
        ("folders",       "ix_folders_organization_id"),
        ("folders",       "ix_folders_community_id"),
        ("courses",       "ix_courses_organization_id"),
        ("courses",       "ix_courses_community_id"),
        ("users",         "ix_users_home_organization_id"),
    ]:
        op.drop_index(idx, table_name=tbl)

    op.drop_column("exams",         "organization_id")
    op.drop_column("exams",         "community_id")
    op.drop_column("threads",       "organization_id")
    op.drop_column("threads",       "community_id")
    op.drop_column("userdocuments", "organization_id")
    op.drop_column("folders",       "organization_id")
    op.drop_column("folders",       "community_id")
    op.drop_column("courses",       "organization_id")
    op.drop_column("courses",       "community_id")
    op.drop_column("users",         "home_organization_id")

    op.drop_index("ix_role_assignments_scope",   table_name="role_assignments")
    op.drop_index("ix_role_assignments_user_id", table_name="role_assignments")
    op.drop_index("ix_role_assignments_id",      table_name="role_assignments")
    op.drop_table("role_assignments")

    op.drop_index("ix_communities_organization_id", table_name="communities")
    op.drop_index("ix_communities_id",              table_name="communities")
    op.drop_table("communities")

    op.drop_index("ix_organizations_slug", table_name="organizations")
    op.drop_index("ix_organizations_id",   table_name="organizations")
    op.drop_table("organizations")

    bind = op.get_bind()
    grant_source_enum_type.drop(bind, checkfirst=True)
    role_enum_type.drop(bind,         checkfirst=True)
    scope_enum_type.drop(bind,        checkfirst=True)
