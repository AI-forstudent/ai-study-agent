"""
test_admin_validator.py — unit tests for app.api.routers.admin
                         _validate_role_assignment_payload.

Pure-Python validation, no DB or FastAPI app needed. Covers the
ultrareview-found B-016 hole where the validator enforced
`platform ⇒ super_user` but not the converse, allowing payloads like
`{role:'super_user', scope_type:'organization', scope_id:5}` to insert
malformed rows that lit up the Admin sidebar but 403'd on every action.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.routers.admin import (
    RoleAssignmentCreate,
    _validate_role_assignment_payload,
    ROLE_REQUIRED_SCOPE,
)


def _payload(**kw):
    """Build a RoleAssignmentCreate with sensible defaults."""
    defaults = {"user_id": 7, "role": "member", "scope_type": "organization", "scope_id": 1}
    defaults.update(kw)
    return RoleAssignmentCreate(**defaults)


class TestHappyPaths:
    def test_super_user_at_platform_passes(self):
        _validate_role_assignment_payload(
            _payload(role="super_user", scope_type="platform", scope_id=None)
        )

    def test_org_admin_at_organization_passes(self):
        _validate_role_assignment_payload(
            _payload(role="org_admin", scope_type="organization", scope_id=5)
        )

    def test_community_admin_at_community_passes(self):
        _validate_role_assignment_payload(
            _payload(role="community_admin", scope_type="community", scope_id=11)
        )

    def test_course_admin_at_course_passes(self):
        _validate_role_assignment_payload(
            _payload(role="course_admin", scope_type="course", scope_id=42)
        )

    @pytest.mark.parametrize("scope_type,scope_id", [
        ("organization", 5),
        ("community",   11),
        ("course",      42),
    ])
    def test_member_passes_at_any_non_platform_scope(self, scope_type, scope_id):
        _validate_role_assignment_payload(
            _payload(role="member", scope_type=scope_type, scope_id=scope_id)
        )


class TestRegressions:
    """B-016 — converse rule: each non-`member` role binds to exactly one
    scope_type. Without this, a phantom-super-user row at organization
    scope inserts cleanly and confuses /auth/me + the Admin UI."""

    @pytest.mark.parametrize("scope_type,scope_id", [
        ("organization", 5),
        ("community",   11),
        ("course",      42),
    ])
    def test_b016_super_user_not_at_platform_raises_422(self, scope_type, scope_id):
        with pytest.raises(HTTPException) as exc_info:
            _validate_role_assignment_payload(
                _payload(role="super_user", scope_type=scope_type, scope_id=scope_id)
            )
        assert exc_info.value.status_code == 422
        assert "super_user" in exc_info.value.detail

    @pytest.mark.parametrize("role,scope_type,scope_id", [
        ("org_admin",       "community", 11),
        ("org_admin",       "course",    42),
        ("community_admin", "organization", 5),
        ("community_admin", "course",       42),
        ("course_admin",    "organization", 5),
        ("course_admin",    "community",    11),
    ])
    def test_b016_admin_role_at_wrong_scope_type_raises_422(
        self, role, scope_type, scope_id,
    ):
        with pytest.raises(HTTPException) as exc_info:
            _validate_role_assignment_payload(
                _payload(role=role, scope_type=scope_type, scope_id=scope_id)
            )
        assert exc_info.value.status_code == 422
        assert role in exc_info.value.detail


class TestExistingForwardRules:
    """Pre-existing rules — make sure the new converse rule doesn't shadow
    or break them."""

    def test_platform_scope_with_non_super_user_raises_422(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_role_assignment_payload(
                _payload(role="member", scope_type="platform", scope_id=None)
            )
        assert exc_info.value.status_code == 422
        assert "platform scope" in exc_info.value.detail

    def test_platform_scope_with_scope_id_raises_422(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_role_assignment_payload(
                _payload(role="super_user", scope_type="platform", scope_id=5)
            )
        assert exc_info.value.status_code == 422

    def test_non_platform_without_scope_id_raises_422(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_role_assignment_payload(
                _payload(role="org_admin", scope_type="organization", scope_id=None)
            )
        assert exc_info.value.status_code == 422

    def test_invalid_role_raises_422(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_role_assignment_payload(
                _payload(role="not_a_real_role", scope_type="organization", scope_id=5)
            )
        assert exc_info.value.status_code == 422

    def test_invalid_scope_type_raises_422(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_role_assignment_payload(
                _payload(role="member", scope_type="not_a_scope", scope_id=5)
            )
        assert exc_info.value.status_code == 422


class TestRoleRequiredScopeTable:
    """Sanity check on the exported lookup so it stays in sync with the
    §3.3 capability matrix."""

    def test_table_covers_all_admin_roles(self):
        assert set(ROLE_REQUIRED_SCOPE.keys()) == {
            "super_user", "org_admin", "community_admin", "course_admin",
        }

    def test_table_member_intentionally_absent(self):
        # `member` is the only multi-scope role per the matrix.
        assert "member" not in ROLE_REQUIRED_SCOPE
