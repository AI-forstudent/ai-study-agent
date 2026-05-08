"""
app/api/routers/personas.py
────────────────────────────
Persona CRUD endpoints.

Mounted at /api/v1/personas in app/main.py.

JSON shape deliberately mirrors the TypeScript `Persona` interface so the
frontend can use the response without any transformation:

  id, name, description, icon, type, author, communityId?,
  tags, tagTypes?, rating, reviewsCount, usageCount, wordCount,
  linkedDocIds, systemPrompt, isCloned, isTransient?,
  originalPersonaId?, createdAt, updatedAt
"""

from __future__ import annotations

import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import Folder, Persona, SessionMemory, StudySession, Thread, User

router = APIRouter(tags=["personas"])


# ── Response schema ────────────────────────────────────────────────────────
# Field names match the frontend TypeScript interface exactly (camelCase).

class PersonaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:                 str
    name:               str
    description:        str
    icon:               str
    type:               str          # 'global' | 'community' | 'personal'
    author:             str
    communityId:        Optional[str]            = None
    tags:               list[str]               = []
    tagTypes:           Optional[dict[str, str]] = None
    rating:             float                   = 0.0
    reviewsCount:       int                     = 0
    usageCount:         int                     = 0
    wordCount:          int                     = 0
    linkedDocIds:       list[int]               = []
    systemPrompt:       str                     = ""
    isCloned:           bool                    = False
    isTransient:        Optional[bool]           = None
    originalPersonaId:  Optional[str]            = None
    createdAt:          str
    updatedAt:          str


def _to_response(p: Persona) -> PersonaResponse:
    """Map ORM Persona → camelCase PersonaResponse."""
    traits: dict[str, Any] = p.traits or {}
    created_iso = p.created_at.isoformat() if p.created_at else ""

    return PersonaResponse(
        id=p.id,
        name=p.display_name,
        description=p.description or "",
        icon=traits.get("icon", "🤖"),
        type=p.persona_type or "global",
        author=traits.get("author", "System"),
        communityId=traits.get("communityId"),
        tags=traits.get("tags", []),
        tagTypes=traits.get("tagTypes"),
        rating=float(traits.get("rating", 0.0)),
        reviewsCount=int(traits.get("reviewsCount", 0)),
        usageCount=int(traits.get("usageCount", 0)),
        wordCount=p.word_count or 0,
        linkedDocIds=[],
        systemPrompt=p.system_prompt or p.manual_prompt_override or "",
        isCloned=p.original_persona_id is not None,
        originalPersonaId=p.original_persona_id,
        createdAt=created_iso,
        updatedAt=created_iso,   # updated_at column not yet added; mirrors createdAt
    )


# ── Seed data ──────────────────────────────────────────────────────────────
# Canonical copy lives here so both the lifespan event and the manual
# /seed fallback endpoint share it without circular imports.

_SEED_PERSONAS: list[dict[str, Any]] = []
"""Default AI Teachers were removed (F-022) per the user's brief: 'I did
NOT add any, they appeared as defaults. No defaults should exist for now.'

The legacy seed list (global_socratic_mentor / community_bgu_data_structures
/ personal_default_concise) is deleted from any pre-existing dev/prod DB
by migration r3q4p5o6n7m8. Setting this list to empty here means
`seed_db()` is a no-op going forward — the lifespan startup hook still
calls it but there's nothing to insert.

Cloned personas users created from these seeds (with author_id = user.id)
are NOT touched — those are real user-owned data.
"""

# Kept for reference / forensic comparison if we ever re-introduce seeds.
_LEGACY_SEED_PERSONAS = [
    {
        "id": "global_socratic_mentor",
        "display_name": "Socratic Mentor",
        "persona_type": "global",
        "description": (
            "Guides learning through questions rather than direct answers. "
            "Encourages deep thinking and self-discovery."
        ),
        "system_prompt": (
            "## ROLE\n"
            "You are a Socratic Mentor — a wise, patient guide who never gives direct answers.\n\n"
            "## TEACHING METHOD\n"
            "Answer every question with a clarifying question. Guide the student to discover "
            "the answer themselves. When they are close, affirm their direction and push them "
            "one step further.\n\n"
            "## TONE\n"
            "Warm, encouraging, and intellectually curious. Celebrate reasoning, not just "
            "correct answers.\n\n"
            "## STYLE\n"
            "Keep responses concise. One guiding question per turn. Avoid walls of text.\n\n"
            "## LANGUAGE\n"
            "Match the student's language automatically."
        ),
        "word_count": 85,
        "traits": {
            "icon": "🏛️",
            "author": "System",
            "tags": ["Pedagogy", "Critical Thinking", "Socratic", "Encouraging", "General"],
            "tagTypes": {
                "Pedagogy": "knowledge",
                "Critical Thinking": "extra",
                "Socratic": "instructions",
                "Encouraging": "personality",
                "General": "extra",
            },
            "rating": 4.8,
            "reviewsCount": 1240,
            "usageCount": 18500,
        },
    },
    {
        "id": "community_bgu_data_structures",
        "display_name": "BGU Data Structures TA",
        "persona_type": "community",
        "description": (
            "Specialized TA for BGU's Data Structures course. Covers arrays, linked lists, "
            "trees, graphs, and complexity analysis in the style of the BGU curriculum."
        ),
        "system_prompt": (
            "## ROLE\n"
            "You are a TA for the Data Structures course at Ben-Gurion University.\n\n"
            "## SCOPE\n"
            "Focus strictly on topics covered in the BGU DSA course: arrays, linked lists, "
            "stacks, queues, trees (BST, AVL, heaps), graphs (BFS/DFS), and Big-O analysis.\n\n"
            "## STYLE\n"
            "Use diagrams described in plain text when helpful. Ask the student to trace "
            "through examples by hand before confirming their answer.\n\n"
            "## LANGUAGE\n"
            "Hebrew by default; switch to English if the student writes in English."
        ),
        "word_count": 72,
        "traits": {
            "icon": "🎓",
            "author": "BGU Community",
            "communityId": "bgu_cs",
            "tags": ["Data Structures", "Algorithms", "BGU", "Hebrew", "CS"],
            "tagTypes": {
                "Data Structures": "knowledge",
                "Algorithms": "knowledge",
                "BGU": "extra",
                "Hebrew": "style",
                "CS": "knowledge",
            },
            "rating": 4.5,
            "reviewsCount": 312,
            "usageCount": 4800,
        },
    },
    {
        "id": "personal_default_concise",
        "display_name": "Concise Explainer",
        "persona_type": "personal",
        "description": (
            "A personal persona optimised for quick, bullet-point explanations. "
            "No fluff — just the core idea."
        ),
        "system_prompt": (
            "## ROLE\n"
            "You are a concise explainer. Your goal is maximum clarity in minimum words.\n\n"
            "## RULES\n"
            "- Never use more than 3 sentences per answer unless code is involved.\n"
            "- Prefer bullet points over prose.\n"
            "- Lead with the conclusion, then support it.\n\n"
            "## TONE\n"
            "Direct, confident, neutral."
        ),
        "word_count": 48,
        "traits": {
            "icon": "⚡",
            "author": "Me",
            "tags": ["Concise", "Bullet Points", "General"],
            "tagTypes": {
                "Concise": "style",
                "Bullet Points": "style",
                "General": "extra",
            },
            "rating": 0,
            "reviewsCount": 0,
            "usageCount": 0,
        },
    },
]


class CreatePersonaRequest(BaseModel):
    id: str
    display_name: str
    description: str = ""
    persona_type: str = "personal"
    system_prompt: str = ""
    tags: list[str] = []
    icon: str = "🤖"
    original_persona_id: Optional[str] = None


class UpdatePersonaRequest(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    tags: Optional[list[str]] = None
    icon: Optional[str] = None


def seed_db(db: Session) -> int:
    """Insert seed personas when the table is empty.

    Returns the number of rows inserted (0 = table already had data).
    Idempotent — safe to call multiple times.
    """
    if db.query(Persona).count() > 0:
        return 0
    for data in _SEED_PERSONAS:
        db.add(Persona(
            id=data["id"],
            display_name=data["display_name"],
            persona_type=data["persona_type"],
            description=data["description"],
            system_prompt=data["system_prompt"],
            word_count=data["word_count"],
            traits=data["traits"],
        ))
    db.commit()
    return len(_SEED_PERSONAS)


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[PersonaResponse])
def list_personas(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return personas the caller can use.

    Visibility rules:
      - global    : visible to everyone
      - community : visible to everyone
      - personal  : visible only to the persona's author (Persona.author_id)
        Personal personas with NULL author_id (legacy/orphan rows from before
        ownership was enforced) are filtered out — they are dead data and
        re-creatable.
    """
    rows = (
        db.query(Persona)
        .filter(
            or_(
                Persona.persona_type.in_(("global", "community")),
                Persona.author_id == current_user.id,
            )
        )
        .order_by(Persona.persona_type, Persona.display_name)
        .all()
    )
    return [_to_response(p) for p in rows]


@router.post("/", response_model=PersonaResponse, status_code=201)
def create_persona(
    payload: CreatePersonaRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new personal persona (used for deferred clone saves from the frontend).

    Only personal personas can be created via this endpoint. global and
    community personas are seeded at startup and are not user-creatable.
    The caller is recorded as the persona's author.
    """
    if payload.persona_type != "personal":
        raise HTTPException(
            status_code=403,
            detail="Only personal personas can be created via this endpoint.",
        )

    if db.query(Persona).filter(Persona.id == payload.id).first():
        raise HTTPException(status_code=409, detail=f"Persona '{payload.id}' already exists.")

    word_count = len(payload.system_prompt.split()) if payload.system_prompt else 0

    new_persona = Persona(
        id=payload.id,
        display_name=payload.display_name,
        description=payload.description,
        persona_type=payload.persona_type,
        system_prompt=payload.system_prompt,
        word_count=word_count,
        original_persona_id=payload.original_persona_id,
        author_id=current_user.id,
        traits={
            "icon": payload.icon,
            "author": "Me",
            "tags": payload.tags,
        },
    )
    db.add(new_persona)
    db.commit()
    db.refresh(new_persona)
    return _to_response(new_persona)


@router.post("/seed", status_code=200)
def seed_personas(db: Session = Depends(get_db)):
    """Manually trigger persona seeding.

    Idempotent — skips gracefully if the table already has rows.
    Call this if the startup lifespan event failed to seed.
    """
    inserted = seed_db(db)
    if inserted == 0:
        count = db.query(Persona).count()
        return {"message": f"Skipped — {count} persona(s) already exist."}
    return {"message": f"Seeded {inserted} personas."}


def _get_owned_personal_persona(persona_id: str, user: User, db: Session) -> Persona:
    """Fetch a personal persona owned by the caller, or 404.

    Global/community personas always 403 — they are seed data and not editable.
    A personal persona owned by a different user 404s (no existence leak).
    """
    persona = db.query(Persona).filter(Persona.id == persona_id).first()
    if not persona:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' not found.")
    if persona.persona_type != "personal":
        raise HTTPException(
            status_code=403,
            detail="Global and community personas cannot be modified.",
        )
    if persona.author_id != user.id:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' not found.")
    return persona


@router.put("/{persona_id}", response_model=PersonaResponse)
def update_persona(
    persona_id: str,
    payload: UpdatePersonaRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update fields of a personal persona owned by the caller."""
    persona = _get_owned_personal_persona(persona_id, current_user, db)

    if payload.display_name is not None:
        persona.display_name = payload.display_name
    if payload.description is not None:
        persona.description = payload.description
    if payload.system_prompt is not None:
        persona.system_prompt = payload.system_prompt
        persona.word_count = len(payload.system_prompt.split()) if payload.system_prompt else 0

    if payload.tags is not None or payload.icon is not None:
        traits: dict[str, Any] = dict(persona.traits or {})
        if payload.tags is not None:
            traits["tags"] = payload.tags
        if payload.icon is not None:
            traits["icon"] = payload.icon
        persona.traits = traits

    db.commit()
    db.refresh(persona)
    return _to_response(persona)


@router.delete("/{persona_id}", status_code=204)
def delete_persona(
    persona_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a personal persona owned by the caller.

    Global and community personas are protected. A persona owned by a
    different user 404s (no existence leak).

    Before removing the row we null-out every FK that references it so the
    DELETE doesn't hit a PostgreSQL IntegrityError:
      - Folder.persona_id        (folder loses its default tutor)
      - Thread.persona_id
      - StudySession.persona_id
      - Persona.original_persona_id  (clones of this persona become unlinked)
    SessionMemory rows are hard-deleted because persona_id is NOT NULL there.
    """
    persona = _get_owned_personal_persona(persona_id, current_user, db)

    # ── Detach all inbound FK references ──────────────────────────────────
    db.query(Folder).filter(
        Folder.persona_id == persona_id
    ).update({"persona_id": None}, synchronize_session=False)

    db.query(Thread).filter(
        Thread.persona_id == persona_id
    ).update({"persona_id": None}, synchronize_session=False)

    db.query(StudySession).filter(
        StudySession.persona_id == persona_id
    ).update({"persona_id": None}, synchronize_session=False)

    # SessionMemory.persona_id is NOT NULL — delete the rows instead of nulling
    db.query(SessionMemory).filter(
        SessionMemory.persona_id == persona_id
    ).delete(synchronize_session=False)

    # Keep clones alive but unlink them from the deleted source
    db.query(Persona).filter(
        Persona.original_persona_id == persona_id
    ).update({"original_persona_id": None}, synchronize_session=False)

    db.delete(persona)
    db.commit()


@router.post("/{persona_id}/clone", response_model=PersonaResponse, status_code=201)
def clone_persona(
    persona_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Clone an existing persona into a personal persona owned by the caller.

    The source must be visible to the caller — i.e. global, community, or
    a personal persona the caller already owns.

    The clone:
      - persona_type  = 'personal'
      - author_id     = current_user.id   (so it shows up in their list)
      - original_persona_id = source persona id
      - display_name  = 'Copy of {original name}'
      - All other fields inherited from the original.
    """
    original = db.query(Persona).filter(Persona.id == persona_id).first()
    if not original:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' not found.")
    if original.persona_type == "personal" and original.author_id != current_user.id:
        # Cloning another user's personal persona is not allowed — they may
        # have written private content into the system prompt.
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' not found.")

    new_id = f"personal_clone_{persona_id}_{int(time.time())}"

    clone = Persona(
        id=new_id,
        display_name=f"Copy of {original.display_name}",
        description=original.description,
        persona_type="personal",
        system_prompt=original.system_prompt or original.manual_prompt_override,
        manual_prompt_override=original.manual_prompt_override,
        word_count=original.word_count,
        traits=original.traits,
        original_persona_id=original.id,
        author_id=current_user.id,
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)
    return _to_response(clone)
