"""courses_and_memberships

Adds the top-level Course entity and the membership edge table that drives
"appears in My Library" for any combination of (created / admin-assigned /
starred-from-public). Folders gain an optional `course_id` so they can either
sit at the user's library root or nest inside a Course.

Tables
──────
• courses             — id, owner_id, title, description, visibility,
                        color, icon, course_metadata, created_at
• course_memberships  — (user_id, course_id, role); role is one of
                        'owner' | 'admin_assigned' | 'starred'

Folders
───────
• folders.course_id   — Integer, FK → courses.id, NULLable.
                        NULL = top-level folder (current behaviour, unchanged).

No data migration required: existing folders keep `course_id=NULL` and remain
top-level. Existing users get zero membership rows, so the Courses tab and the
"My Courses" lane both render empty for them on first deploy.

Revision ID: j5i6h7g8f9e0
Revises: i4h5g6f7e8d9
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision      = "j5i6h7g8f9e0"
down_revision = "i4h5g6f7e8d9"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # ── 1. courses ─────────────────────────────────────────────────────────
    op.create_table(
        "courses",
        sa.Column("id",              sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_id",        sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title",           sa.String(),  nullable=False),
        sa.Column("description",     sa.Text(),    nullable=True),
        sa.Column(
            "visibility",
            sa.String(),
            nullable=False,
            server_default="private",
        ),
        sa.Column("color",           sa.String(),  nullable=True),
        sa.Column("icon",            sa.String(),  nullable=True),
        sa.Column(
            "course_metadata",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_courses_id",         "courses", ["id"])
    op.create_index("ix_courses_owner_id",   "courses", ["owner_id"])
    op.create_index("ix_courses_visibility", "courses", ["visibility"])

    # ── 2. course_memberships ──────────────────────────────────────────────
    op.create_table(
        "course_memberships",
        sa.Column("id",        sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id"),
            nullable=False,
        ),
        sa.Column(
            "role",
            sa.String(),
            nullable=False,
            server_default="starred",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # A user has at most one membership row per course — the role evolves
        # in place rather than spawning duplicates.
        sa.UniqueConstraint("user_id", "course_id", name="uq_course_memberships_user_course"),
    )
    op.create_index("ix_course_memberships_id",        "course_memberships", ["id"])
    op.create_index("ix_course_memberships_user_id",   "course_memberships", ["user_id"])
    op.create_index("ix_course_memberships_course_id", "course_memberships", ["course_id"])

    # ── 3. folders.course_id ───────────────────────────────────────────────
    op.add_column(
        "folders",
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id"),
            nullable=True,
        ),
    )
    op.create_index("ix_folders_course_id", "folders", ["course_id"])


def downgrade() -> None:
    op.drop_index("ix_folders_course_id", table_name="folders")
    op.drop_column("folders", "course_id")

    op.drop_index("ix_course_memberships_course_id", table_name="course_memberships")
    op.drop_index("ix_course_memberships_user_id",   table_name="course_memberships")
    op.drop_index("ix_course_memberships_id",        table_name="course_memberships")
    op.drop_table("course_memberships")

    op.drop_index("ix_courses_visibility", table_name="courses")
    op.drop_index("ix_courses_owner_id",   table_name="courses")
    op.drop_index("ix_courses_id",         table_name="courses")
    op.drop_table("courses")
