"""
app/services/usage_logger.py
─────────────────────────────
F-005 Phase 2 (T-008) — write a `UsageEvent` row for every metered LLM call.

Pricing model
─────────────
Public list prices per provider, expressed in micro-USD per 1k tokens
($0.000001 units). Edit freely — already-written `cost_usd_micros` values
stay frozen because the row stores the actual computed cost, not a rate.
The cost-to-credits conversion uses `quota_config.CREDIT_USD_RATE` so
"how many credits" is a derived integer.

Failure mode
────────────
Logging is best-effort. If the insert fails (DB hiccup, missing FK, etc.)
we swallow the exception and log a warning — a stuck logging path must
never block a chat reply. Quota enforcement (Phase 3) will treat a missing
row as "free of charge" until the next successful write catches up.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.core.quota_config import CREDIT_USD_RATE
from app.models.domain import UsageEvent
from app.services.llm_providers import LLMReply

log = logging.getLogger(__name__)


# ── Pricing table — micro-USD per 1k tokens ───────────────────────────────
# Loosely calibrated from public price pages (2026-Q1). Adjust per your
# actual provider invoice; the field is just a stored integer so changes
# don't require a migration.

_PRICING: dict[str, dict[str, int]] = {
    # Google Gemini
    "gemini-2.5-flash-lite":     {"input": 75,     "output": 300},
    "gemini-2.5-flash":          {"input": 75,     "output": 300},
    "gemini-2.5-pro":            {"input": 1_250,  "output": 10_000},
    # OpenAI
    "gpt-4o-mini":               {"input": 150,    "output": 600},
    "gpt-4o":                    {"input": 2_500,  "output": 10_000},
    "gpt-4.1":                   {"input": 2_000,  "output": 8_000},
    # Anthropic
    "claude-haiku-4-5-20251001": {"input": 1_000,  "output": 5_000},
    "claude-sonnet-4-6":         {"input": 3_000,  "output": 15_000},
    "claude-opus-4-7":           {"input": 15_000, "output": 75_000},
}

# Fallback when an unknown model id slips through (new model the price
# table hasn't been updated for). Conservative mid-tier estimate so we
# never quietly bill someone $0 for an expensive call.
_FALLBACK_PRICE = {"input": 1_000, "output": 5_000}


def _compute_cost_micros(model: str, input_tokens: int, output_tokens: int) -> int:
    p = _PRICING.get(model, _FALLBACK_PRICE)
    input_cost  = (input_tokens  * p["input"])  // 1000
    output_cost = (output_tokens * p["output"]) // 1000
    return input_cost + output_cost


def _cost_to_credits(cost_usd_micros: int) -> int:
    """Convert micro-USD to credits using the global rate. Rounds *up* so
    a fractional credit charge is never silently free."""
    if cost_usd_micros <= 0:
        return 0
    cost_usd = cost_usd_micros / 1_000_000
    if CREDIT_USD_RATE <= 0:
        return 0
    return max(1, int((cost_usd / CREDIT_USD_RATE) + 0.5))


def write_usage_event(
    db:           Session,
    user_id:      Optional[int],
    endpoint:     str,
    reply:        LLMReply,
    model_alias:  Optional[str] = None,
) -> Optional[UsageEvent]:
    """Persist a single `UsageEvent` row and return it.

    `user_id` may be None for legacy thread-anchored chats whose Thread row
    pre-dates Phase-1 ownership enforcement; we drop the row in that case
    rather than violate the NOT NULL constraint. Once T-007 is cleaned up
    this branch becomes dead code.
    """
    if user_id is None:
        return None

    cost_micros = _compute_cost_micros(reply.model, reply.input_tokens, reply.output_tokens)
    credits     = _cost_to_credits(cost_micros)

    try:
        ev = UsageEvent(
            user_id=user_id,
            provider=reply.provider,
            model_alias=model_alias[:16] if model_alias else None,
            model_name=reply.model,
            endpoint=endpoint,
            input_tokens=reply.input_tokens,
            output_tokens=reply.output_tokens,
            credits=credits,
            cost_usd_micros=cost_micros,
        )
        db.add(ev)
        db.commit()
        db.refresh(ev)
        return ev
    except Exception as exc:                          # pragma: no cover
        # Don't propagate — usage logging never blocks a reply.
        log.warning("[usage_logger] failed to record event for user %s: %s",
                    user_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        return None
