"""remove_default_seed_personas

Removes the three default AI Teachers seeded on first boot of every
dev/prod environment by `personas.py::_SEED_PERSONAS`. Per the user's
2026-05-08 feedback: "Remove all default AI Teachers — I did NOT add
any, they appeared as defaults. No defaults should exist for now."

The seeded personas removed by this migration:
  - global_socratic_mentor
  - community_bgu_data_structures
  - personal_default_concise

Going forward, `_SEED_PERSONAS` is empty so the lifespan startup
seed call becomes a no-op (F-022).

Cloned personas users created from these seeds (rows with
`author_id = user.id` AND `original_persona_id` pointing at one of the
seeds) are NOT touched — those are real user-owned data. We just null
their `original_persona_id` link so the FK constraint doesn't violate
when the seed row goes away.

Other inbound FK references to the seed ids are also cleaned up so
the DELETE doesn't hit IntegrityError:
  - folders.persona_id            → NULL  (default tutor unset)
  - threads.persona_id            → NULL
  - study_sessions.persona_id     → NULL
  - personas.original_persona_id  → NULL  (clones lose their backlink)
  - session_memories.persona_id   → row hard-deleted (NOT NULL column)

Reversible. The downgrade re-inserts the three rows verbatim with the
original system_prompts so anyone who relied on them can keep going.

Revision ID: r3q4p5o6n7m8
Revises: q2p3o4n5m6l7
Create Date: 2026-05-08
"""

from alembic import op
import sqlalchemy as sa


revision      = "r3q4p5o6n7m8"
down_revision = "q2p3o4n5m6l7"
branch_labels = None
depends_on    = None


SEED_IDS = (
    "global_socratic_mentor",
    "community_bgu_data_structures",
    "personal_default_concise",
)


def upgrade() -> None:
    bind = op.get_bind()

    # Detach all inbound FK references to the seed ids.
    bind.execute(
        sa.text("UPDATE folders SET persona_id = NULL WHERE persona_id = ANY(:ids)"),
        {"ids": list(SEED_IDS)},
    )
    bind.execute(
        sa.text("UPDATE threads SET persona_id = NULL WHERE persona_id = ANY(:ids)"),
        {"ids": list(SEED_IDS)},
    )
    bind.execute(
        sa.text("UPDATE study_sessions SET persona_id = NULL WHERE persona_id = ANY(:ids)"),
        {"ids": list(SEED_IDS)},
    )
    bind.execute(
        sa.text("UPDATE personas SET original_persona_id = NULL WHERE original_persona_id = ANY(:ids)"),
        {"ids": list(SEED_IDS)},
    )
    # session_memories.persona_id is NOT NULL — hard-delete those rows.
    bind.execute(
        sa.text("DELETE FROM session_memories WHERE persona_id = ANY(:ids)"),
        {"ids": list(SEED_IDS)},
    )
    # Finally drop the seed personas themselves.
    bind.execute(
        sa.text("DELETE FROM personas WHERE id = ANY(:ids)"),
        {"ids": list(SEED_IDS)},
    )


def downgrade() -> None:
    """Re-insert the legacy seed personas verbatim.

    System prompts are kept intentionally short here — anyone restoring
    these can re-edit via the persona editor afterwards.
    """
    bind = op.get_bind()
    bind.execute(sa.text("""
        INSERT INTO personas
            (id, display_name, persona_type, description, system_prompt,
             word_count, traits, created_at)
        VALUES
            ('global_socratic_mentor', 'Socratic Mentor', 'global',
             'Guides learning through questions rather than direct answers.',
             '## ROLE\nYou are a Socratic Mentor.', 0,
             '{"icon":"🏛️","author":"System","tags":["Pedagogy","Socratic"]}'::jsonb,
             now()),
            ('community_bgu_data_structures', 'BGU Data Structures TA', 'community',
             'Specialized TA for BGU''s Data Structures course.',
             '## ROLE\nYou are a TA for the BGU Data Structures course.', 0,
             '{"icon":"🎓","author":"BGU Community","tags":["Data Structures","BGU"]}'::jsonb,
             now()),
            ('personal_default_concise', 'Concise Explainer', 'personal',
             'Quick, bullet-point explanations.',
             '## ROLE\nYou are a concise explainer.', 0,
             '{"icon":"⚡","author":"Me","tags":["Concise"]}'::jsonb,
             now())
        ON CONFLICT (id) DO NOTHING
    """))
