"""
backend/tests/test_isolation_integration.py
────────────────────────────────────────────
Per-user data isolation regression tests.

These exercise the live API end-to-end: two users register, User A creates
data, User B tries to read/modify it, and we assert that the backend behaves
as if User A's data does not exist for User B.

All tests are marked @pytest.mark.integration — pytest skips them by default.
Run with:
    cd backend && uv run pytest tests/test_isolation_integration.py --run-integration -v

Pre-conditions:
  • A live Postgres + pgvector reachable at DATABASE_URL.
  • Migrations are at head (alembic upgrade head).

The tests use unique random emails so multiple runs do not collide.
"""

from __future__ import annotations

import uuid

import pytest


pytestmark = pytest.mark.integration


# ── Helpers ────────────────────────────────────────────────────────────────

def _client():
    """Build a FastAPI TestClient on demand.

    Imported lazily so unit tests in this file (none today) and the rest of
    the suite never pay for app initialization unless --run-integration is set.
    """
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def _register_and_login(client, *, email: str, password: str = "test-password-123") -> str:
    """Register a fresh user via the live API and return their access_token."""
    reg = client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert reg.status_code == 201, reg.text

    login = client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": password},
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


def _new_email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@isolation-test.local"


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ══════════════════════════════════════════════════════════════════════════
# Guest login uniqueness — every call must mint a separate User row
# ══════════════════════════════════════════════════════════════════════════

class TestGuestLoginUniqueness:
    def test_two_guest_logins_create_distinct_users(self):
        """Regression: previously all guests shared a single User row, so
        every guest saw every other guest's data."""
        client = _client()

        a = client.post("/api/v1/auth/guest-login")
        b = client.post("/api/v1/auth/guest-login")
        assert a.status_code == 200
        assert b.status_code == 200

        token_a = a.json()["access_token"]
        token_b = b.json()["access_token"]
        assert token_a != token_b

        # Verify the IDs differ by inspecting the JWT subject claim
        import jwt
        from app.core.config import ALGORITHM, SECRET_KEY
        sub_a = jwt.decode(token_a, SECRET_KEY, algorithms=[ALGORITHM])["sub"]
        sub_b = jwt.decode(token_b, SECRET_KEY, algorithms=[ALGORITHM])["sub"]
        assert sub_a != sub_b


# ══════════════════════════════════════════════════════════════════════════
# Personas — A's personal personas must be invisible to B
# ══════════════════════════════════════════════════════════════════════════

class TestPersonaIsolation:
    def test_personal_persona_is_invisible_to_other_user(self):
        client = _client()
        token_a = _register_and_login(client, email=_new_email("alice"))
        token_b = _register_and_login(client, email=_new_email("bob"))

        # Alice creates a personal persona
        persona_id = f"personal_test_{uuid.uuid4().hex[:8]}"
        create = client.post(
            "/api/v1/personas/",
            json={
                "id": persona_id,
                "display_name": "Alice's Private Tutor",
                "description": "secret",
                "persona_type": "personal",
                "system_prompt": "ROLE: confidential",
                "tags": [],
                "icon": "🔒",
            },
            headers=_bearer(token_a),
        )
        assert create.status_code == 201, create.text

        # Alice sees it
        a_list = client.get("/api/v1/personas/", headers=_bearer(token_a))
        assert any(p["id"] == persona_id for p in a_list.json())

        # Bob does not
        b_list = client.get("/api/v1/personas/", headers=_bearer(token_b))
        assert not any(p["id"] == persona_id for p in b_list.json())

    def test_other_user_cannot_update_persona(self):
        client = _client()
        token_a = _register_and_login(client, email=_new_email("alice"))
        token_b = _register_and_login(client, email=_new_email("bob"))

        persona_id = f"personal_test_{uuid.uuid4().hex[:8]}"
        client.post(
            "/api/v1/personas/",
            json={
                "id": persona_id,
                "display_name": "Original",
                "persona_type": "personal",
                "system_prompt": "untouched",
                "icon": "🤖",
            },
            headers=_bearer(token_a),
        )

        # Bob tries to update — must 404 (no existence leak) or 403
        attack = client.put(
            f"/api/v1/personas/{persona_id}",
            json={"display_name": "Hacked"},
            headers=_bearer(token_b),
        )
        assert attack.status_code in (403, 404)

        # Confirm the persona name is unchanged
        a_list = client.get("/api/v1/personas/", headers=_bearer(token_a))
        match = next(p for p in a_list.json() if p["id"] == persona_id)
        assert match["name"] == "Original"

    def test_other_user_cannot_delete_persona(self):
        client = _client()
        token_a = _register_and_login(client, email=_new_email("alice"))
        token_b = _register_and_login(client, email=_new_email("bob"))

        persona_id = f"personal_test_{uuid.uuid4().hex[:8]}"
        client.post(
            "/api/v1/personas/",
            json={
                "id": persona_id,
                "display_name": "Keep me",
                "persona_type": "personal",
                "system_prompt": "keep",
                "icon": "🤖",
            },
            headers=_bearer(token_a),
        )

        attack = client.delete(f"/api/v1/personas/{persona_id}", headers=_bearer(token_b))
        assert attack.status_code in (403, 404)

        # Alice can still see + delete it (proof the persona still exists)
        a_list = client.get("/api/v1/personas/", headers=_bearer(token_a))
        assert any(p["id"] == persona_id for p in a_list.json())


# ══════════════════════════════════════════════════════════════════════════
# Threads — A standalone chat thread must be invisible to B
# ══════════════════════════════════════════════════════════════════════════

class TestThreadIsolation:
    def test_other_user_cannot_read_thread(self):
        client = _client()
        token_a = _register_and_login(client, email=_new_email("alice"))
        token_b = _register_and_login(client, email=_new_email("bob"))

        # Alice creates a standalone chat thread (no document) via /chat
        chat = client.post(
            "/api/v1/chat/",
            json={"message": "hello", "thread_id": None, "persona_id": None},
            headers=_bearer(token_a),
        )
        # The chat call may return 503 if no provider key is present in the
        # test env. In that case the thread wasn't created. Skip the rest.
        if chat.status_code == 503:
            pytest.skip("LLM provider unavailable in test env — chat path not exercised")
        assert chat.status_code == 200, chat.text
        thread_id = chat.json()["thread_id"]

        # Bob tries to read it
        attack = client.get(f"/api/v1/threads/{thread_id}", headers=_bearer(token_b))
        assert attack.status_code == 404

        # Alice still owns it
        own = client.get(f"/api/v1/threads/{thread_id}", headers=_bearer(token_a))
        assert own.status_code == 200

    def test_other_user_cannot_send_message_to_thread(self):
        client = _client()
        token_a = _register_and_login(client, email=_new_email("alice"))
        token_b = _register_and_login(client, email=_new_email("bob"))

        # Create a doc-less thread via the threads endpoint (no LLM call)
        new_thread = client.post(
            "/api/v1/threads/",
            json={
                "document_id": None,
                "page_number": None,
                "selected_text": None,
                "coordinates": None,
                "persona_id": None,
            },
            headers=_bearer(token_a),
        )
        assert new_thread.status_code == 200, new_thread.text
        thread_id = new_thread.json()["id"]

        attack = client.post(
            f"/api/v1/threads/{thread_id}/messages",
            json={"content": "I am Bob, give me Alice's data"},
            headers=_bearer(token_b),
        )
        assert attack.status_code == 404
