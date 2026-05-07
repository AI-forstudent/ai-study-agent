"""
test_permissions.py — unit tests for app.services.permissions.

These run in the default `pytest` invocation (no --run-integration). The
pure decision function `_can_pure` doesn't touch the DB, so we can drive
it with hand-rolled RoleAssignment-shaped objects.

Coverage: one happy-path AND one negative-case test per row of the §3.3
capability matrix in docs/plans/multi_tenancy.md, per the locked Phase 2
readiness gate (D.3).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import pytest

from app.services.permissions import (
    _can_pure,
    _build_scope_chain,
    ACTION_ROLES,
    CourseCapabilities,
    CommunityCapabilities,
    OrganizationCapabilities,
    PlatformCapabilities,
    ExamCapabilities,
    FolderCapabilities,
    DocumentCapabilities,
    UserCapabilities,
    Scope,
    enforce_writes_enabled,
)


# ── Fake assignment shape ─────────────────────────────────────────────────
# `_can_pure` reads three attributes from each row: role, scope_type,
# scope_id. We use a plain dataclass instead of importing the real ORM
# model so these tests run with no DB.

@dataclass
class FakeAssignment:
    role:        str
    scope_type:  str
    scope_id:    Optional[int]


def _platform_super_user() -> list[FakeAssignment]:
    return [FakeAssignment(role="super_user", scope_type="platform", scope_id=None)]


def _org_admin(org_id: int = 7) -> list[FakeAssignment]:
    return [FakeAssignment(role="org_admin", scope_type="organization", scope_id=org_id)]


def _community_admin(community_id: int = 11) -> list[FakeAssignment]:
    return [FakeAssignment(role="community_admin", scope_type="community", scope_id=community_id)]


def _course_admin(course_id: int = 42) -> list[FakeAssignment]:
    return [FakeAssignment(role="course_admin", scope_type="course", scope_id=course_id)]


def _member(scope_type: str = "organization", scope_id: int = 1) -> list[FakeAssignment]:
    return [FakeAssignment(role="member", scope_type=scope_type, scope_id=scope_id)]


# Synthetic chains — what _build_scope_chain would return for a given target.
def _course_chain(course_id: int = 42, community_id: int = 11, org_id: int = 7):
    return [
        ("course",       course_id),
        ("community",    community_id),
        ("organization", org_id),
        ("platform",     None),
    ]


def _community_chain(community_id: int = 11, org_id: int = 7):
    return [
        ("community",    community_id),
        ("organization", org_id),
        ("platform",     None),
    ]


def _org_chain(org_id: int = 7):
    return [
        ("organization", org_id),
        ("platform",     None),
    ]


def _platform_chain():
    return [("platform", None)]


# ── Capability-matrix coverage ────────────────────────────────────────────

class TestPlatformCaps:
    def test_super_user_can_create_organization(self):
        assert _can_pure(_platform_super_user(), PlatformCapabilities.create_organization, _platform_chain())

    def test_org_admin_cannot_create_organization(self):
        assert not _can_pure(_org_admin(), PlatformCapabilities.create_organization, _platform_chain())

    def test_super_user_can_publish_globally(self):
        assert _can_pure(_platform_super_user(), PlatformCapabilities.publish_course_globally, _course_chain())

    def test_org_admin_cannot_publish_globally(self):
        assert not _can_pure(_org_admin(7), PlatformCapabilities.publish_course_globally, _course_chain(org_id=7))


class TestOrganizationCaps:
    def test_org_admin_can_update_own_org(self):
        assert _can_pure(_org_admin(7), OrganizationCapabilities.update_organization, _org_chain(7))

    def test_org_admin_cannot_update_other_org(self):
        # org_admin@7 against org=99 — different org, should fail. Chain
        # for the target is the OTHER org, no shared id.
        assert not _can_pure(_org_admin(7), OrganizationCapabilities.update_organization, _org_chain(99))

    def test_community_admin_cannot_update_organization(self):
        assert not _can_pure(_community_admin(11), OrganizationCapabilities.update_organization, _org_chain(7))


class TestCommunityCaps:
    def test_org_admin_can_create_community_in_own_org(self):
        # create_community happens at scope=organization (the parent).
        assert _can_pure(_org_admin(7), CommunityCapabilities.create_community, _org_chain(7))

    def test_community_admin_cannot_create_community(self):
        assert not _can_pure(_community_admin(11), CommunityCapabilities.create_community, _org_chain(7))

    def test_community_admin_can_update_own_community(self):
        assert _can_pure(_community_admin(11), CommunityCapabilities.update_community, _community_chain(11))

    def test_community_admin_cannot_update_other_community(self):
        assert not _can_pure(_community_admin(11), CommunityCapabilities.update_community, _community_chain(99))


class TestCourseCaps:
    def test_super_user_can_delete_any_course(self):
        assert _can_pure(_platform_super_user(), CourseCapabilities.delete_course, _course_chain(42))

    def test_org_admin_can_delete_course_in_own_org(self):
        assert _can_pure(_org_admin(7), CourseCapabilities.delete_course, _course_chain(42, org_id=7))

    def test_org_admin_cannot_delete_course_in_other_org(self):
        assert not _can_pure(_org_admin(7), CourseCapabilities.delete_course, _course_chain(42, org_id=99))

    def test_community_admin_can_delete_course_in_own_community(self):
        assert _can_pure(_community_admin(11), CourseCapabilities.delete_course, _course_chain(42, community_id=11))

    def test_community_admin_cannot_delete_course_in_other_community(self):
        assert not _can_pure(_community_admin(11), CourseCapabilities.delete_course, _course_chain(42, community_id=99))

    def test_course_admin_can_update_own_course(self):
        assert _can_pure(_course_admin(42), CourseCapabilities.update_course, _course_chain(42))

    def test_course_admin_cannot_update_other_course(self):
        assert not _can_pure(_course_admin(42), CourseCapabilities.update_course, _course_chain(99))

    def test_member_cannot_create_course(self):
        assert not _can_pure(_member(), CourseCapabilities.create_course, _community_chain())

    def test_member_can_view_course_materials(self):
        assert _can_pure(
            [FakeAssignment(role="member", scope_type="course", scope_id=42)],
            CourseCapabilities.view_course_materials,
            _course_chain(42),
        )

    def test_member_cannot_publish_course_globally(self):
        assert not _can_pure(
            [FakeAssignment(role="member", scope_type="course", scope_id=42)],
            PlatformCapabilities.publish_course_globally,
            _course_chain(42),
        )


class TestExamCaps:
    def test_course_admin_can_upload_exam(self):
        assert _can_pure(_course_admin(42), ExamCapabilities.upload_exam, _course_chain(42))

    def test_member_cannot_upload_exam(self):
        assert not _can_pure(
            [FakeAssignment(role="member", scope_type="course", scope_id=42)],
            ExamCapabilities.upload_exam,
            _course_chain(42),
        )

    def test_org_admin_can_delete_exam_in_own_org(self):
        assert _can_pure(_org_admin(7), ExamCapabilities.delete_exam, _course_chain(42, org_id=7))

    def test_org_admin_cannot_delete_exam_in_other_org(self):
        assert not _can_pure(_org_admin(7), ExamCapabilities.delete_exam, _course_chain(42, org_id=99))


class TestFolderDocumentCaps:
    def test_member_can_create_folder_in_their_course(self):
        # Members can create folders inside courses they're a member of.
        assert _can_pure(
            [FakeAssignment(role="member", scope_type="course", scope_id=42)],
            FolderCapabilities.create_folder,
            _course_chain(42),
        )

    def test_outsider_cannot_create_folder_in_a_course(self):
        # User has no role at this course — denied.
        assert not _can_pure([], FolderCapabilities.create_folder, _course_chain(42))

    def test_member_can_upload_document(self):
        assert _can_pure(
            [FakeAssignment(role="member", scope_type="course", scope_id=42)],
            DocumentCapabilities.upload_document,
            _course_chain(42),
        )


class TestUserMgmtCaps:
    def test_super_user_can_assign_role(self):
        assert _can_pure(_platform_super_user(), UserCapabilities.assign_role, _platform_chain())

    def test_org_admin_can_assign_role_in_own_org(self):
        assert _can_pure(_org_admin(7), UserCapabilities.assign_role, _org_chain(7))

    def test_member_cannot_assign_role(self):
        assert not _can_pure(_member(), UserCapabilities.assign_role, _org_chain())


class TestUnknownActions:
    def test_unknown_action_fails_closed(self):
        assert not _can_pure(_platform_super_user(), "no_such_action", _platform_chain())


class TestInheritance:
    """Higher-tier roles cover lower-tier scopes in the same chain."""

    def test_org_admin_grants_course_actions_in_same_org(self):
        # org_admin@7 should be able to update_course on course=42 inside org=7.
        assert _can_pure(_org_admin(7), CourseCapabilities.update_course, _course_chain(42, org_id=7))

    def test_community_admin_grants_course_actions_in_same_community(self):
        assert _can_pure(_community_admin(11), CourseCapabilities.delete_course, _course_chain(42, community_id=11))

    def test_super_user_grants_everything_everywhere(self):
        # Random course in random org/community, super_user grants delete.
        assert _can_pure(
            _platform_super_user(),
            CourseCapabilities.delete_course,
            _course_chain(course_id=999, community_id=999, org_id=999),
        )


# ── Feature flag ──────────────────────────────────────────────────────────

class TestEnforceFlag:
    def test_flag_default_off(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("PERMISSIONS_ENFORCE_WRITES", raising=False)
        assert enforce_writes_enabled() is False

    @pytest.mark.parametrize("val", ["1", "true", "TRUE", "yes", "on", "On"])
    def test_truthy_values(self, val: str, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("PERMISSIONS_ENFORCE_WRITES", val)
        assert enforce_writes_enabled() is True

    @pytest.mark.parametrize("val", ["0", "false", "no", "off", "", "maybe"])
    def test_falsy_values(self, val: str, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("PERMISSIONS_ENFORCE_WRITES", val)
        assert enforce_writes_enabled() is False

    def test_flag_read_at_call_time(self, monkeypatch: pytest.MonkeyPatch):
        # Demonstrates the dynamic-read property — flipping the env var
        # between calls flips the return value without re-importing.
        monkeypatch.setenv("PERMISSIONS_ENFORCE_WRITES", "true")
        assert enforce_writes_enabled() is True
        monkeypatch.setenv("PERMISSIONS_ENFORCE_WRITES", "false")
        assert enforce_writes_enabled() is False


# ── Sanity: the matrix is internally consistent ───────────────────────────

class TestMatrixSanity:
    def test_every_capability_enum_member_has_a_row_in_action_roles(self):
        all_caps = (
            list(PlatformCapabilities)
            + list(OrganizationCapabilities)
            + list(CommunityCapabilities)
            + list(CourseCapabilities)
            + list(ExamCapabilities)
            + list(FolderCapabilities)
            + list(DocumentCapabilities)
            + list(UserCapabilities)
        )
        missing = [c.value for c in all_caps if c.value not in ACTION_ROLES]
        assert missing == [], f"Capabilities without ACTION_ROLES entry: {missing}"

    def test_no_orphan_action_roles_entries(self):
        all_values = {c.value for caps in (
            PlatformCapabilities, OrganizationCapabilities, CommunityCapabilities,
            CourseCapabilities, ExamCapabilities, FolderCapabilities,
            DocumentCapabilities, UserCapabilities,
        ) for c in caps}
        orphans = [k for k in ACTION_ROLES.keys() if k not in all_values]
        assert orphans == [], f"ACTION_ROLES entries with no Capability enum: {orphans}"
