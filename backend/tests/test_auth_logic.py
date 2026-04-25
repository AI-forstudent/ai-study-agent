"""
backend/tests/test_auth_logic.py
──────────────────────────────────
Unit tests for app/core/security.py (password hashing + JWT creation).

All tests here are pure-function unit tests — no database, no HTTP client.
They run in any environment without a PostgreSQL connection.

Run with:
    cd backend && uv run pytest tests/test_auth_logic.py -v
"""

import pytest
import jwt
from datetime import datetime, timezone

from app.core.security import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    get_password_hash,
    verify_password,
)
from app.core.config import ALGORITHM, SECRET_KEY


# ══════════════════════════════════════════════════════════════════════════
# Password hashing  (bcrypt — app/core/security.py)
# ══════════════════════════════════════════════════════════════════════════

class TestPasswordHashing:

    def test_correct_password_verifies(self):
        pw = "super-secret-123"
        assert verify_password(pw, get_password_hash(pw)) is True

    def test_wrong_password_rejected(self):
        hashed = get_password_hash("correct-horse-battery")
        assert verify_password("not-the-right-password", hashed) is False

    def test_hash_is_salted(self):
        """bcrypt produces a different hash each call due to random salt."""
        pw = "same-password"
        assert get_password_hash(pw) != get_password_hash(pw)

    def test_empty_password_round_trips(self):
        """Empty string is a legal (if weak) password — must not raise."""
        assert verify_password("", get_password_hash("")) is True

    def test_unicode_password_round_trips(self):
        """Non-ASCII characters hash and verify correctly."""
        pw = "sécurité-パスワード-🔑"
        assert verify_password(pw, get_password_hash(pw)) is True

    def test_hash_output_is_string(self):
        result = get_password_hash("any-password")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_correct_password_does_not_verify_against_other_hash(self):
        """Hashes are not interchangeable between different passwords."""
        hash_a = get_password_hash("password-A")
        hash_b = get_password_hash("password-B")
        assert verify_password("password-A", hash_b) is False
        assert verify_password("password-B", hash_a) is False


# ══════════════════════════════════════════════════════════════════════════
# JWT creation  (PyJWT — app/core/security.py)
# ══════════════════════════════════════════════════════════════════════════

class TestJWTCreation:

    def test_token_is_decodable_with_correct_secret(self):
        token = create_access_token({"sub": "42"})
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["sub"] == "42"

    def test_token_contains_exp_claim(self):
        token = create_access_token({"sub": "1"})
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert "exp" in payload

    def test_token_expiry_is_in_the_future(self):
        token = create_access_token({"sub": "1"})
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        exp_dt = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        assert exp_dt > datetime.now(timezone.utc)

    def test_token_expiry_matches_configured_duration(self):
        """Expiry should be ACCESS_TOKEN_EXPIRE_MINUTES from now (±1 min tolerance)."""
        token = create_access_token({"sub": "1"})
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        exp_dt = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        delta_minutes = (exp_dt - datetime.now(timezone.utc)).total_seconds() / 60
        assert abs(delta_minutes - ACCESS_TOKEN_EXPIRE_MINUTES) < 1

    def test_tampered_secret_raises_decode_error(self):
        """Token signed with our key cannot be decoded with a different secret."""
        token = create_access_token({"sub": "99"})
        with pytest.raises(jwt.exceptions.DecodeError):
            jwt.decode(token, "attacker-secret", algorithms=[ALGORITHM])

    def test_arbitrary_payload_fields_are_preserved(self):
        token = create_access_token({"sub": "5", "role": "admin", "tier": "pro"})
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["role"] == "admin"
        assert payload["tier"] == "pro"

    def test_numeric_string_sub_preserved(self):
        """User IDs are stored as string 'sub' — type must be preserved."""
        token = create_access_token({"sub": "12345"})
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["sub"] == "12345"
        assert isinstance(payload["sub"], str)

    def test_token_is_a_non_empty_string(self):
        token = create_access_token({"sub": "1"})
        assert isinstance(token, str)
        assert len(token) > 0


# ══════════════════════════════════════════════════════════════════════════
# Regression tests  (bugs that were fixed — must never return)
# ══════════════════════════════════════════════════════════════════════════

class TestRegressions:

    def test_verify_password_does_not_raise_on_mismatched_types(self):
        """
        Regression: early implementations crashed when hashed_password was bytes.
        get_password_hash must return str, and verify_password must accept str.
        """
        hashed = get_password_hash("my-password")
        assert isinstance(hashed, str), "hash must be str, not bytes"
        result = verify_password("my-password", hashed)  # must not raise TypeError
        assert result is True
