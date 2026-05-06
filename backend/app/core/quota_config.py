"""
app/core/quota_config.py
─────────────────────────
Single place to tune subscription tiers, period length, and credit pricing.

Why this file exists
────────────────────
Phase 1 ships only the *schema* (User.subscription_tier, usage_events table).
Logging into usage_events, quota enforcement, and the Settings usage bar arrive
in later phases. Until then, this module is read-only documentation of the
intended config — no runtime code reads it yet, but the structure is fixed so
later phases can plug in without rewriting how the rest of the app thinks about
quotas.

Design choices
──────────────
• `period_seconds` is a single number — flip "daily" to "weekly" by changing
  86_400 → 604_800. Keep it uniform across tiers; per-tier periods complicate
  reset logic for marginal benefit.
• `credits_per_period = None` means "unlimited" (the pro tier).
• `CREDIT_USD_RATE` is the conversion used at write time when we record a
  UsageEvent. Adjust freely later — already-written `credits` values stay frozen.
• Adjust the numbers in TIER_QUOTAS without a migration. Adjust the period
  the same way. Tier *names* are referenced from User.subscription_tier
  values, so renaming a tier requires a data migration to rename existing rows.
"""

from __future__ import annotations

from typing import Optional, TypedDict


# ── Period length (uniform across tiers) ───────────────────────────────────

# Daily reset by default. To change cadence project-wide, set this to e.g.
# 604_800 (weekly) or 30 * 86_400 (monthly).
PERIOD_SECONDS: int = 86_400


# ── Pricing ────────────────────────────────────────────────────────────────

# 1 credit ≈ this many USD. Picked so that "100,000 credits" reads like a
# generous free allowance ($100 of LLM equivalent at the current bottom tier).
# Recompute provider cost at write time and store the integer count of credits
# in UsageEvent.credits — adjust this rate later without rewriting old rows.
CREDIT_USD_RATE: float = 0.001


# ── Tiers ──────────────────────────────────────────────────────────────────

class TierQuota(TypedDict):
    credits_per_period: Optional[int]    # None = unlimited
    label:              str               # human-readable, shown in the UI


TIER_QUOTAS: dict[str, TierQuota] = {
    "guest": {"credits_per_period": 5_000,    "label": "Guest"},
    "free":  {"credits_per_period": 50_000,   "label": "Free"},
    "plus":  {"credits_per_period": 500_000,  "label": "Plus"},
    "pro":   {"credits_per_period": None,     "label": "Pro"},
}

DEFAULT_TIER: str = "free"


def get_tier_quota(tier: str | None) -> TierQuota:
    """Lookup with safe fallback to the default tier."""
    return TIER_QUOTAS.get(tier or DEFAULT_TIER, TIER_QUOTAS[DEFAULT_TIER])
