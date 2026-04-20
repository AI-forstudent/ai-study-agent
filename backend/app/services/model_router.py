"""
app/services/model_router.py
─────────────────────────────
Internal model alias registry + request routing logic.

Usage
─────
  from app.services.model_router import route_llm_request

  model_string = route_llm_request("chat")             # → "gemini-2.5-flash"
  model_string = route_llm_request("chat", "pro")      # → "gemini-2.5-pro"
  model_string = route_llm_request("summary")          # → "gemini-2.5-flash-lite"

Design intent
─────────────
We never hard-code Google model strings in business logic.  All callers use
the alias ("VOLT", "SPARK", …) or the routing helper below.  When Google
releases a new version we update MODEL_MANIFEST in one place.
"""

from __future__ import annotations


# ── Alias → real model string ──────────────────────────────────────────────

MODEL_MANIFEST: dict[str, str] = {
    "DUST":   "gemini-2.0-flash-lite",     # background tasks, cheapest
    "SPARK":  "gemini-2.5-flash-lite",     # summaries, memory compression
    "BREEZE": "gemini-2.0-flash",          # backup / fallback chat
    "VOLT":   "gemini-2.5-flash",          # main fast chat
    "ATLAS":  "gemini-2.5-pro",            # deep analysis, complex PDFs
    "INDEX":  "gemini-embedding",          # vectorisation for RAG
    "ECHO":   "gemini-2.5-flash-tts",      # text-to-speech / audio
    "BANANA": "nano-banana-2",             # image generation (placeholder)
    "VEO":    "veo",                       # video generation (placeholder)
}


# ── Task-type defaults ─────────────────────────────────────────────────────
#
# Keys must match the task_type strings used by callers.

_TASK_DEFAULTS: dict[str, str] = {
    "chat":          "VOLT",
    "summary":       "SPARK",
    "page_summary":  "SPARK",
    "memory":        "SPARK",
    "background":    "DUST",
    "embed":         "INDEX",
    "deep_analysis": "ATLAS",
    "audio":         "ECHO",
}

# ── User-facing tier → alias ───────────────────────────────────────────────
#
# Maps the values stored in the frontend Zustand store (selectedModelTier)
# to the corresponding alias.  'flash-lite' = "Fast & Efficient" etc.

_TIER_OVERRIDE_MAP: dict[str, str] = {
    "flash-lite": "SPARK",
    "flash":      "BREEZE",   # gemini-2.0-flash — stable fallback for Balanced tier
    "pro":        "ATLAS",
    # human-readable aliases accepted too
    "fast":       "SPARK",
    "balanced":   "BREEZE",   # same as "flash"; 2.0-flash is reliable
    "deep":       "ATLAS",
}


def get_model_for_alias(alias: str) -> str:
    """Return the raw API model string for an internal alias.

    Raises KeyError if the alias is unknown.
    """
    return MODEL_MANIFEST[alias]


def route_llm_request(
    task_type: str,
    user_override_tier: str | None = None,
) -> str:
    """Resolve the best model string for a given task and optional tier.

    Priority order:
      1. user_override_tier  — explicit user preference (UI segmented control)
      2. task_type default   — smart default per task category

    Returns the raw Google model string (e.g. "gemini-2.5-flash").

    Raises ValueError for completely unknown task_type + no override.
    """
    # 1. User tier override takes top priority
    if user_override_tier:
        alias = _TIER_OVERRIDE_MAP.get(user_override_tier.lower())
        if alias:
            return MODEL_MANIFEST[alias]

    # 2. Task-based default
    alias = _TASK_DEFAULTS.get(task_type.lower())
    if alias:
        return MODEL_MANIFEST[alias]

    raise ValueError(
        f"Unknown task_type '{task_type}' and no valid tier override provided. "
        f"Known tasks: {list(_TASK_DEFAULTS.keys())}"
    )


def resolve_alias(
    task_type: str,
    user_override_tier: str | None = None,
) -> str:
    """Return the internal alias (e.g. 'VOLT') for a task and optional tier.

    Mirrors the logic of route_llm_request but returns the alias instead of
    the raw model string — useful when you want to store the alias in the DB
    (e.g. Message.model_alias) and derive the model string separately.
    """
    if user_override_tier:
        alias = _TIER_OVERRIDE_MAP.get(user_override_tier.lower())
        if alias:
            return alias
    return _TASK_DEFAULTS.get(task_type.lower(), "VOLT")


def list_manifest() -> dict[str, str]:
    """Return a copy of the full MODEL_MANIFEST (for introspection endpoints)."""
    return dict(MODEL_MANIFEST)
