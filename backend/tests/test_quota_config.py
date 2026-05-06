"""
backend/tests/test_quota_config.py
───────────────────────────────────
Unit tests for app/core/quota_config.py.

Pure-config tests — no DB, no HTTP client. Run by default.
"""

from __future__ import annotations

import pytest

from app.core import quota_config
from app.core.quota_config import (
    CREDIT_USD_RATE,
    DEFAULT_TIER,
    PERIOD_SECONDS,
    TIER_QUOTAS,
    get_tier_quota,
)


class TestTierQuotas:
    def test_default_tier_is_present(self):
        assert DEFAULT_TIER in TIER_QUOTAS

    def test_all_required_tiers_defined(self):
        for tier in ("guest", "free", "plus", "pro"):
            assert tier in TIER_QUOTAS, f"missing tier: {tier}"

    def test_each_tier_has_required_keys(self):
        for tier, quota in TIER_QUOTAS.items():
            assert "credits_per_period" in quota, f"{tier} missing credits_per_period"
            assert "label"              in quota, f"{tier} missing label"

    def test_credits_per_period_is_int_or_none(self):
        for tier, quota in TIER_QUOTAS.items():
            limit = quota["credits_per_period"]
            assert limit is None or isinstance(limit, int), (
                f"{tier}.credits_per_period must be int or None, got {type(limit)}"
            )

    def test_pro_tier_is_unlimited(self):
        """Convention: None means unlimited."""
        assert TIER_QUOTAS["pro"]["credits_per_period"] is None

    def test_finite_tiers_are_strictly_positive(self):
        """Non-pro tiers must allow at least one credit per period."""
        for tier, quota in TIER_QUOTAS.items():
            limit = quota["credits_per_period"]
            if limit is not None:
                assert limit > 0, f"{tier} has non-positive limit {limit}"

    def test_tier_limits_are_monotonically_non_decreasing(self):
        """Higher tiers should never give fewer credits than lower tiers."""
        ladder = ["guest", "free", "plus", "pro"]
        prev_limit = 0
        for tier in ladder:
            limit = TIER_QUOTAS[tier]["credits_per_period"]
            if limit is None:
                # 'pro' is unlimited — terminates the ladder
                continue
            assert limit >= prev_limit, (
                f"{tier} limit {limit} is below previous tier's {prev_limit}"
            )
            prev_limit = limit


class TestPeriodSeconds:
    def test_period_is_positive(self):
        assert PERIOD_SECONDS > 0

    def test_period_is_int(self):
        """Avoid float seconds — they make rolling-window math fragile."""
        assert isinstance(PERIOD_SECONDS, int)

    def test_default_period_is_daily(self):
        """The current default is 24h. If we change it, this test enforces
        that the change is intentional (and that the related UI copy gets
        updated)."""
        assert PERIOD_SECONDS == 86_400


class TestCreditUsdRate:
    def test_rate_is_positive(self):
        assert CREDIT_USD_RATE > 0

    def test_rate_is_float(self):
        assert isinstance(CREDIT_USD_RATE, float)


class TestGetTierQuota:
    def test_known_tier_returns_its_quota(self):
        assert get_tier_quota("free") is TIER_QUOTAS["free"]
        assert get_tier_quota("pro")  is TIER_QUOTAS["pro"]

    def test_none_falls_back_to_default(self):
        assert get_tier_quota(None) is TIER_QUOTAS[DEFAULT_TIER]

    def test_unknown_tier_falls_back_to_default(self):
        """A typo or stale row should not crash — quota defaults to free."""
        assert get_tier_quota("nonexistent") is TIER_QUOTAS[DEFAULT_TIER]

    def test_empty_string_falls_back_to_default(self):
        assert get_tier_quota("") is TIER_QUOTAS[DEFAULT_TIER]


class TestRegressions:
    def test_period_seconds_is_module_level_constant(self):
        """Regression: enforcement and reporting should both read from the same
        constant. If someone redefined this as a function or dict key in the
        future, the pattern would drift."""
        assert isinstance(quota_config.PERIOD_SECONDS, int)

    def test_aggregate_micros_motivates_bigint_column(self):
        """Regression / sanity-check: if `cost_usd_micros` were INT32 instead
        of BIGINT, summing across a busy month overflows. This test documents
        why the column type matters — keep them in lockstep."""
        # 10 million credits × CREDIT_USD_RATE ($0.001) × 1_000_000 micros/USD
        # = 10,000,000,000 (10 billion) micros, which exceeds INT32's 2.147B.
        max_credits = 10_000_000
        max_cost_micros = int(max_credits * CREDIT_USD_RATE * 1_000_000)
        INT32_MAX = 2_147_483_647
        assert max_cost_micros > INT32_MAX, (
            "If this assertion fails, INT32 is sufficient and BIGINT is overkill — "
            "but verify before downgrading the column."
        )
