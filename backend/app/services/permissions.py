"""
app/services/permissions.py
───────────────────────────
Centralized permission service — the single capability gate for all
write routes once Phase 2 of the multi-tenancy rollout is enabled.

The plan that drives this lives at docs/plans/multi_tenancy.md. §3.3
holds the capability matrix this module encodes; §3.2 holds the role
inheritance rules; §3.2c holds the Default-org cross-user isolation rule.

Public surface
──────────────
  Scope                     — a (type, id?) target descriptor
  CourseCapabilities        — domain-grouped action enums
  CommunityCapabilities
  OrganizationCapabilities
  ExamCapabilities
  FolderCapabilities
  DocumentCapabilities
  UserCapabilities
  PlatformCapabilities
  can(user, action, scope, db, ...)        — DB-backed gate
  can_or_owner(user, action, scope, db, owner_id, ...)  — self-service fallback
  enforce_writes_enabled()  — reads PERMISSIONS_ENFORCE_WRITES at call time

Design notes
────────────
• `can()` walks the scope hierarchy (course → community → organization →
  platform) and returns True iff one of the user's role assignments lands
  on a chain entry AND that role is listed for the requested action.
• Inheritance is encoded by walking the chain; we don't write derived
  member-rows when an admin creates an admin-scope assignment. See §3.2.
• Default-org isolation: when the target lives in organization id=1
  ('Default') AND the action targets another user's row, can() returns
  False regardless of the caller's role. Default is a parking lot, not
  a collaborative tenant. The `target_user_id` kwarg surfaces this.
• Self-service fallback: in Default, a user can mutate their own rows
  (matching today's behaviour for everyone in v1). Use `can_or_owner()`
  to express that intent in routes.
• The feature flag is read **dynamically at call time** so flipping
  `PERMISSIONS_ENFORCE_WRITES` doesn't require a redeploy. Routes call
  `enforce_writes_enabled()` and only raise 403 on deny when it returns
  True; otherwise denials are logged but allowed (shadow mode).

This module is import-light on purpose — no FastAPI dependencies. Routes
import it for `can*()` checks; tests import it without spinning up the app.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from enum import StrEnum
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.models.domain import (
    Community, Course, Organization, RoleAssignment, User,
)


logger = logging.getLogger("app.permissions")


# ── Constants ──────────────────────────────────────────────────────────────

DEFAULT_ORG_ID: int = 1   # Seeded by migration p1o2n3m4l5k6 — the parking lot.


# ── Capability enums (domain-grouped, format: verb_noun_target) ────────────
# Per the locked decision (§6 / B.3): strict StrEnums per domain so typos
# fail at import time. Adding a new action means a new enum member here
# AND a new row in `ACTION_ROLES` below.

class PlatformCapabilities(StrEnum):
    create_organization     = "create_organization"
    delete_organization     = "delete_organization"
    publish_course_globally = "publish_course_globally"
    create_user             = "create_user"
    delete_user             = "delete_user"


class OrganizationCapabilities(StrEnum):
    update_organization = "update_organization"
    invite_org_admin    = "invite_org_admin"
    view_audit_log      = "view_audit_log"


class CommunityCapabilities(StrEnum):
    create_community         = "create_community"
    update_community         = "update_community"
    delete_community         = "delete_community"
    invite_community_admin   = "invite_community_admin"


class CourseCapabilities(StrEnum):
    create_course            = "create_course"
    update_course            = "update_course"
    delete_course            = "delete_course"
    invite_course_admin      = "invite_course_admin"
    invite_student           = "invite_student"
    publish_course_to_org    = "publish_course_to_org"
    view_course_materials    = "view_course_materials"
    start_chat_in_course     = "start_chat_in_course"


class ExamCapabilities(StrEnum):
    upload_exam = "upload_exam"
    delete_exam = "delete_exam"
    update_exam = "update_exam"


class FolderCapabilities(StrEnum):
    create_folder = "create_folder"
    update_folder = "update_folder"
    delete_folder = "delete_folder"


class DocumentCapabilities(StrEnum):
    upload_document = "upload_document"
    delete_document = "delete_document"
    update_document = "update_document"


class UserCapabilities(StrEnum):
    assign_role = "assign_role"
    revoke_role = "revoke_role"


# Master action→roles map. Roles inherit downward at the same scope; the
# walk in `can()` handles cross-scope inheritance separately, so this map
# only lists DIRECT eligibility — e.g. update_course lists course_admin
# (not just community_admin/org_admin/super_user) so a course_admin
# assigned at scope=course can pass.
ACTION_ROLES: dict[str, frozenset[str]] = {
    # Platform
    PlatformCapabilities.create_organization.value:     frozenset({"super_user"}),
    PlatformCapabilities.delete_organization.value:     frozenset({"super_user"}),
    PlatformCapabilities.publish_course_globally.value: frozenset({"super_user"}),
    PlatformCapabilities.create_user.value:             frozenset({"super_user"}),
    PlatformCapabilities.delete_user.value:             frozenset({"super_user"}),
    # Organization
    OrganizationCapabilities.update_organization.value: frozenset({"super_user", "org_admin"}),
    OrganizationCapabilities.invite_org_admin.value:    frozenset({"super_user", "org_admin"}),
    OrganizationCapabilities.view_audit_log.value:      frozenset({"super_user", "org_admin"}),
    # Community
    CommunityCapabilities.create_community.value:       frozenset({"super_user", "org_admin"}),
    CommunityCapabilities.update_community.value:       frozenset({"super_user", "org_admin", "community_admin"}),
    CommunityCapabilities.delete_community.value:       frozenset({"super_user", "org_admin"}),
    CommunityCapabilities.invite_community_admin.value: frozenset({"super_user", "org_admin", "community_admin"}),
    # Course
    CourseCapabilities.create_course.value:             frozenset({"super_user", "org_admin", "community_admin"}),
    CourseCapabilities.update_course.value:             frozenset({"super_user", "org_admin", "community_admin", "course_admin"}),
    CourseCapabilities.delete_course.value:             frozenset({"super_user", "org_admin", "community_admin", "course_admin"}),
    CourseCapabilities.invite_course_admin.value:       frozenset({"super_user", "org_admin", "community_admin", "course_admin"}),
    CourseCapabilities.invite_student.value:            frozenset({"super_user", "org_admin", "community_admin", "course_admin"}),
    CourseCapabilities.publish_course_to_org.value:     frozenset({"super_user", "org_admin", "community_admin", "course_admin"}),
    CourseCapabilities.view_course_materials.value:     frozenset({"super_user", "org_admin", "community_admin", "course_admin", "member"}),
    CourseCapabilities.start_chat_in_course.value:      frozenset({"super_user", "org_admin", "community_admin", "course_admin", "member"}),
    # Course content (anchored to a course scope)
    ExamCapabilities.upload_exam.value:        frozenset({"super_user", "org_admin", "community_admin", "course_admin"}),
    ExamCapabilities.delete_exam.value:        frozenset({"super_user", "org_admin", "community_admin", "course_admin"}),
    ExamCapabilities.update_exam.value:        frozenset({"super_user", "org_admin", "community_admin", "course_admin"}),
    FolderCapabilities.create_folder.value:    frozenset({"super_user", "org_admin", "community_admin", "course_admin", "member"}),
    FolderCapabilities.update_folder.value:    frozenset({"super_user", "org_admin", "community_admin", "course_admin", "member"}),
    FolderCapabilities.delete_folder.value:    frozenset({"super_user", "org_admin", "community_admin", "course_admin", "member"}),
    DocumentCapabilities.upload_document.value: frozenset({"super_user", "org_admin", "community_admin", "course_admin", "member"}),
    DocumentCapabilities.update_document.value: frozenset({"super_user", "org_admin", "community_admin", "course_admin", "member"}),
    DocumentCapabilities.delete_document.value: frozenset({"super_user", "org_admin", "community_admin", "course_admin", "member"}),
    # User management — privileged
    UserCapabilities.assign_role.value: frozenset({"super_user", "org_admin", "community_admin", "course_admin"}),
    UserCapabilities.revoke_role.value: frozenset({"super_user", "org_admin", "community_admin", "course_admin"}),
}


# ── Scope ──────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Scope:
    """A target the action operates on.

    `type` ∈ {'platform', 'organization', 'community', 'course'}.
    `id` is required for everything except 'platform' (super-user scope),
    matching the CHECK constraint on role_assignments.
    """
    type: str
    id:   Optional[int] = None

    @classmethod
    def platform(cls) -> "Scope":
        return cls(type="platform", id=None)

    @classmethod
    def organization(cls, id: int) -> "Scope":
        return cls(type="organization", id=id)

    @classmethod
    def community(cls, id: int) -> "Scope":
        return cls(type="community", id=id)

    @classmethod
    def course(cls, id: int) -> "Scope":
        return cls(type="course", id=id)


# ── Feature flag ───────────────────────────────────────────────────────────

def enforce_writes_enabled() -> bool:
    """Read `PERMISSIONS_ENFORCE_WRITES` at call time so flipping the flag
    doesn't require a redeploy. Truthy values: '1', 'true', 'yes', 'on'
    (case-insensitive). Anything else → off (shadow mode).
    """
    raw = (os.getenv("PERMISSIONS_ENFORCE_WRITES") or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


# ── Internal helpers ───────────────────────────────────────────────────────

def _build_scope_chain(scope: Scope, db: Session) -> list[tuple[str, Optional[int]]]:
    """Build the lookup chain for `scope` — the scope itself, then every
    ancestor scope, ending at platform. Used by `can()` to find a role
    assignment at any level that covers the target.
    """
    chain: list[tuple[str, Optional[int]]] = []

    if scope.type == "course" and scope.id is not None:
        chain.append(("course", scope.id))
        course = db.query(Course).filter(Course.id == scope.id).first()
        if course is not None:
            chain.append(("community", course.community_id))
            chain.append(("organization", course.organization_id))
    elif scope.type == "community" and scope.id is not None:
        chain.append(("community", scope.id))
        community = db.query(Community).filter(Community.id == scope.id).first()
        if community is not None:
            chain.append(("organization", community.organization_id))
    elif scope.type == "organization" and scope.id is not None:
        chain.append(("organization", scope.id))

    chain.append(("platform", None))
    return chain


def _scope_organization_id(scope: Scope, db: Session) -> Optional[int]:
    """Return the organization id that contains `scope`, or None for
    platform scope. Used by the Default-org isolation rule.
    """
    if scope.type == "organization":
        return scope.id
    if scope.type == "community" and scope.id is not None:
        c = db.query(Community).filter(Community.id == scope.id).first()
        return c.organization_id if c else None
    if scope.type == "course" and scope.id is not None:
        c = db.query(Course).filter(Course.id == scope.id).first()
        return c.organization_id if c else None
    return None


def _can_pure(
    assignments: Iterable[RoleAssignment],
    action: str,
    chain: list[tuple[str, Optional[int]]],
) -> bool:
    """Pure decision function — no DB. Returns True iff any of the given
    assignments is at a chain entry (or platform-scope) AND its role is
    listed for the action. Platform-scope (super_user) trumps every chain.
    """
    eligible = ACTION_ROLES.get(action)
    if eligible is None:
        # Unknown action — fail closed.
        return False

    for a in assignments:
        if a.role not in eligible:
            continue
        if a.scope_type == "platform":
            return True
        for chain_type, chain_id in chain:
            if a.scope_type == chain_type and a.scope_id == chain_id:
                return True
    return False


# ── Public API ─────────────────────────────────────────────────────────────

def can(
    user: User,
    action: str,
    scope: Scope,
    db: Session,
    *,
    target_user_id: Optional[int] = None,
) -> bool:
    """Return True iff `user` may perform `action` on `scope`.

    Parameters
    ──────────
    user            — the calling user (from `Depends(get_current_user)`).
    action          — the canonical action string from a Capability enum.
    scope           — the target descriptor.
    db              — open SQLAlchemy session for FK lookups.
    target_user_id  — when the action targets a row owned by another user
                      (e.g. delete_course on someone else's course),
                      pass that user's id so Default-org isolation can
                      deny cross-user writes inside organization id=1.
                      None for self-targeted actions.

    Default-org isolation
    ─────────────────────
    When the target organization is `DEFAULT_ORG_ID` and `target_user_id`
    is set to a different user, this function returns False regardless of
    the caller's role. Real orgs (created later via the admin UI) get the
    full role-based behaviour.
    """
    # Default-org isolation — drops cross-user mutations even for super_users
    # so the parking lot stays a parking lot. See §3.2c.
    if target_user_id is not None and target_user_id != user.id:
        org_id = _scope_organization_id(scope, db)
        if org_id == DEFAULT_ORG_ID:
            return False

    chain = _build_scope_chain(scope, db)
    assignments = (
        db.query(RoleAssignment)
        .filter(RoleAssignment.user_id == user.id)
        .all()
    )
    return _can_pure(assignments, action, chain)


def can_or_owner(
    user: User,
    action: str,
    scope: Scope,
    db: Session,
    *,
    owner_id: int,
) -> bool:
    """Same as `can()` but also returns True when the caller IS the owner of
    the target row inside the Default org. This expresses the v1 "everyone
    in Default can mutate their own stuff regardless of role" semantics.

    Outside Default, ownership alone is NOT enough — the role-based check
    runs as usual. Inside Default, owners win even when the role-based
    check would deny.
    """
    if owner_id == user.id:
        org_id = _scope_organization_id(scope, db)
        if org_id == DEFAULT_ORG_ID:
            return True

    return can(user, action, scope, db, target_user_id=owner_id)


# ── Logging helpers (used by route gates) ──────────────────────────────────

def log_decision(
    *, user_id: int, action: str, scope: Scope, granted: bool, enforced: bool,
) -> None:
    """Emit a structured log line for a permission decision. Routes call
    this after `can*()` so we can grep production logs for unexpected
    denies (or, during the first hour after a flag flip, every decision).
    """
    level = logging.INFO if granted else logging.WARNING
    logger.log(
        level,
        "[perm] action=%s scope=%s/%s user=%d granted=%s enforced=%s",
        action,
        scope.type,
        scope.id if scope.id is not None else "-",
        user_id,
        "yes" if granted else "no",
        "yes" if enforced else "shadow",
    )


def gate_or_403(
    user: User,
    action: str,
    scope: Scope,
    db: Session,
    *,
    owner_id: Optional[int] = None,
    target_user_id: Optional[int] = None,
) -> None:
    """Standard write-route gate. Calls `can_or_owner()` (when `owner_id`
    is given) or `can()` (when only `target_user_id` is given), logs the
    decision, and raises `HTTPException(403)` on deny **only when the
    `PERMISSIONS_ENFORCE_WRITES` flag is on**. With the flag off, the
    decision is shadow-logged but the request proceeds — that's how Phase
    2 lands without breaking existing behaviour.

    Routes pass `owner_id` when the action targets an existing row that
    has a recorded owner (e.g. `Course.owner_id`); the v1 self-service
    semantics in Default org let owners pass regardless of role.

    For actions on rows that aren't owned by anyone yet (creation flows),
    pass `owner_id=current_user.id` — the action is implicitly self-owned.
    """
    # Importing FastAPI inside the function keeps this module testable
    # without the FastAPI dependency in the hot import path.
    from fastapi import HTTPException

    if owner_id is not None:
        granted = can_or_owner(user, action, scope, db, owner_id=owner_id)
    else:
        granted = can(user, action, scope, db, target_user_id=target_user_id)

    enforce = enforce_writes_enabled()
    log_decision(
        user_id=user.id, action=action, scope=scope,
        granted=granted, enforced=enforce,
    )

    if not granted and enforce:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have permission to perform '{action}' on this resource.",
        )
