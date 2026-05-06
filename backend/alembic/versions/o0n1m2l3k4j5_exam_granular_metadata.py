"""exam_granular_metadata

Splits the single overloaded `Exam.semester` field into three independent
columns per the user spec — semester / moed / exam_type are distinct
concepts and must be queryable separately.

New columns
───────────
• exams.moed         (String, nullable)  values: 'A', 'B', 'C', 'D', 'Special'
• exams.exam_type    (String, nullable)  values: 'midterm', 'final', 'quiz', 'practice', 'other'

Existing column
───────────────
• exams.semester remains, but its value space is restricted to academic
  semesters: 'Fall', 'Spring', 'Summer', 'Other'. The backfill below moves
  any "Moed X" string the previous schema accepted into the new `moed`
  column and clears `semester`.

Backfill rules
──────────────
The previous form crammed semester + moed into one field. Patterns we've
seen there:
    "Fall"          → semester='Fall',   moed=NULL
    "Spring"        → semester='Spring', moed=NULL
    "Moed A"        → semester=NULL,     moed='A'
    "Moed B"        → semester=NULL,     moed='B'
    "Moed C"        → semester=NULL,     moed='C'
    "Moed D"        → semester=NULL,     moed='D'
    "Moed Meyuhad"  → semester=NULL,     moed='Special'
Other / unknown   → keep semester as-is, leave moed=NULL.

`exam_type` is left NULL for all existing rows — the prompt extension
will fill it on next retry / next upload.

Revision ID: o0n1m2l3k4j5
Revises: n9m0l1k2j3i4
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa


revision      = "o0n1m2l3k4j5"
down_revision = "n9m0l1k2j3i4"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.add_column("exams", sa.Column("moed",      sa.String(), nullable=True))
    op.add_column("exams", sa.Column("exam_type", sa.String(), nullable=True))

    # Backfill: split anything that looks like "Moed X" out of `semester`
    # into the new `moed` column. Use plain SQL CASE so this runs once at
    # migration time and not against the application's ORM mappings.
    op.execute("""
        UPDATE exams
        SET moed = CASE
            WHEN semester ILIKE 'moed a%'        THEN 'A'
            WHEN semester ILIKE 'moed b%'        THEN 'B'
            WHEN semester ILIKE 'moed c%'        THEN 'C'
            WHEN semester ILIKE 'moed d%'        THEN 'D'
            WHEN semester ILIKE 'moed meyuhad%'  THEN 'Special'
            WHEN semester ILIKE 'moed special%'  THEN 'Special'
            ELSE NULL
        END,
        semester = CASE
            WHEN semester ILIKE 'moed%'  THEN NULL
            ELSE semester
        END
        WHERE semester IS NOT NULL
    """)


def downgrade() -> None:
    # Best-effort restore — re-cram `moed` back into `semester` so anyone
    # downgrading doesn't lose the data.
    op.execute("""
        UPDATE exams
        SET semester = CASE
            WHEN moed IS NOT NULL AND semester IS NULL THEN 'Moed ' || moed
            ELSE semester
        END
        WHERE moed IS NOT NULL
    """)
    op.drop_column("exams", "exam_type")
    op.drop_column("exams", "moed")
