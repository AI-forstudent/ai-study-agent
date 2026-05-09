"""lectures_phase_1

F-031 Phase 1 — first-class Lecture entity inside a Course.

A Lecture is a learning unit that lives inside a course. It carries up to:
  • one recording   (UserDocument with doc_type 'AUDIO')
  • one notes file  (UserDocument with doc_type 'GENERAL' for PDF, or 'IMAGE'
                     for handwritten/photographed notes)
  • one manual summary (TEXT, written by the user)

Phase 2 (deferred) will add automatic transcription of the recording and a
fused AI summary that combines transcript + notes + manual_summary into one
structured artifact (key points, exercises, Q&A). Those fields aren't created
here — the smart-summary call will land its output in a JSONB column added by
a future migration so the manual_summary column stays the user-owned source
of truth.

Tables
──────
• lectures
    id                            PK
    course_id                     FK → courses.id (CASCADE on delete)
    community_id / organization_id NOT NULL — denormalized from parent course
                                  to match the Phase-1 multi-tenant scope
                                  pattern used by Course/Exam/Folder
    title                         VARCHAR NOT NULL
    lecture_date                  DATE      nullable
    manual_summary                TEXT      nullable
    recording_user_document_id    FK → userdocuments.id, ON DELETE SET NULL
    notes_user_document_id        FK → userdocuments.id, ON DELETE SET NULL
    created_at / updated_at       TIMESTAMPTZ

No data migration. Existing courses get zero lectures.

Revision ID: s4r5q6p7o8n9
Revises: r3q4p5o6n7m8
Create Date: 2026-05-08
"""

from alembic import op
import sqlalchemy as sa


revision      = "s4r5q6p7o8n9"
down_revision = "r3q4p5o6n7m8"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "lectures",
        sa.Column("id",              sa.Integer(),       primary_key=True, autoincrement=True),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Phase-1 multi-tenant denormalized scope. Both required, copied from
        # the parent course at insert time. Matching Exam / Folder pattern.
        sa.Column(
            "community_id",
            sa.Integer(),
            sa.ForeignKey("communities.id"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column("title",          sa.String(),  nullable=False),
        sa.Column("lecture_date",   sa.Date(),    nullable=True),
        sa.Column("manual_summary", sa.Text(),    nullable=True),
        # Both attachments are optional. SET NULL on delete so the user can
        # clean up library files without nuking the lecture row itself.
        sa.Column(
            "recording_user_document_id",
            sa.Integer(),
            sa.ForeignKey("userdocuments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "notes_user_document_id",
            sa.Integer(),
            sa.ForeignKey("userdocuments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_lectures_id",              "lectures", ["id"])
    op.create_index("ix_lectures_course_id",       "lectures", ["course_id"])
    op.create_index("ix_lectures_community_id",    "lectures", ["community_id"])
    op.create_index("ix_lectures_organization_id", "lectures", ["organization_id"])


def downgrade() -> None:
    op.drop_index("ix_lectures_organization_id", table_name="lectures")
    op.drop_index("ix_lectures_community_id",    table_name="lectures")
    op.drop_index("ix_lectures_course_id",       table_name="lectures")
    op.drop_index("ix_lectures_id",              table_name="lectures")
    op.drop_table("lectures")
