"""
app/api/routers/admin.py
─────────────────────────
Phase-5 admin panel endpoints — the user-facing surface for managing the
multi-tenancy hierarchy (orgs, communities, role assignments).

All routes here are **always enforced** via `require_can()` — they don't
honour `PERMISSIONS_ENFORCE_WRITES`. The flag exists to ramp enforcement
on pre-existing user-facing routes; admin endpoints are new, have no
legacy traffic, and must be locked down from the moment they ship.

Mounted at /api/v1/admin in app/main.py.

What this surface lets a super-user do (the only role who can see
everything in v1):
  - List every user in the system
  - Create real organizations and communities
  - Grant / revoke role assignments at any scope
  - View role assignments by user or by scope

Org / community admins (once they exist) get a scoped view of the same
endpoints — `require_can(view_role_assignments, scope)` returns True only
when the caller has admin rights at or above that scope.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import (
    Community, Organization, RoleAssignment, User,
)
from app.services.permissions import (
    AdminCapabilities,
    CommunityCapabilities,
    DEFAULT_ORG_ID,
    PlatformCapabilities,
    Scope,
    UserCapabilities,
    require_can,
)

router = APIRouter(tags=["admin"])


# ── Schemas ────────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:                   int
    email:                str
    auth_provider:        str
    subscription_tier:    str
    home_organization_id: Optional[int] = None
    created_at:           datetime


class OrgOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:         int
    name:       str
    slug:       str
    created_at: datetime


class OrgCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=64,
                      pattern=r"^[a-z0-9][a-z0-9-]*$",
                      description="URL-safe lowercase, dash-separated")


class CommunityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:              int
    organization_id: int
    name:            str
    slug:            str
    created_at:      datetime


class CommunityCreate(BaseModel):
    organization_id: int
    name:            str = Field(min_length=1, max_length=120)
    slug:            str = Field(min_length=1, max_length=64,
                                 pattern=r"^[a-z0-9][a-z0-9-]*$")


class RoleAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:           int
    user_id:      int
    user_email:   str   # denormalized for the admin table view
    role:         str
    scope_type:   str
    scope_id:     Optional[int] = None
    granted_by:   Optional[int] = None
    granted_via:  str
    granted_at:   datetime


class RoleAssignmentCreate(BaseModel):
    """Grant a role to a user. The caller must satisfy
    `assign_role` at the target scope (super_user always; otherwise
    org_admin/community_admin/course_admin within their scope).
    """
    user_id:    int
    role:       str = Field(description="super_user / org_admin / community_admin / course_admin / member")
    scope_type: str = Field(description="platform / organization / community / course")
    scope_id:   Optional[int] = Field(None,
                description="Required for non-platform scopes; omitted for super_user")


VALID_ROLES = {"super_user", "org_admin", "community_admin", "course_admin", "member"}
VALID_SCOPES = {"platform", "organization", "community", "course"}


# ── Helpers ────────────────────────────────────────────────────────────────

def _ra_to_out(r: RoleAssignment, email: str) -> RoleAssignmentOut:
    return RoleAssignmentOut(
        id=r.id,
        user_id=r.user_id,
        user_email=email,
        role=r.role,
        scope_type=r.scope_type,
        scope_id=r.scope_id,
        granted_by=r.granted_by,
        granted_via=r.granted_via,
        granted_at=r.granted_at,
    )


def _validate_role_assignment_payload(payload: RoleAssignmentCreate) -> None:
    if payload.role not in VALID_ROLES:
        raise HTTPException(422, f"Invalid role '{payload.role}'. Must be one of {sorted(VALID_ROLES)}.")
    if payload.scope_type not in VALID_SCOPES:
        raise HTTPException(422, f"Invalid scope_type '{payload.scope_type}'. Must be one of {sorted(VALID_SCOPES)}.")
    if payload.scope_type == "platform":
        if payload.scope_id is not None:
            raise HTTPException(422, "scope_id must be omitted when scope_type='platform'.")
        if payload.role != "super_user":
            raise HTTPException(422, "platform scope is only valid for role='super_user'.")
    else:
        if payload.scope_id is None:
            raise HTTPException(422, f"scope_id is required for scope_type='{payload.scope_type}'.")


def _scope_from_payload(payload: RoleAssignmentCreate) -> Scope:
    if payload.scope_type == "platform":
        return Scope.platform()
    if payload.scope_type == "organization":
        return Scope.organization(payload.scope_id)  # type: ignore[arg-type]
    if payload.scope_type == "community":
        return Scope.community(payload.scope_id)    # type: ignore[arg-type]
    if payload.scope_type == "course":
        return Scope.course(payload.scope_id)       # type: ignore[arg-type]
    raise HTTPException(422, f"Unhandled scope_type '{payload.scope_type}'.")


# ── Users ──────────────────────────────────────────────────────────────────

@router.get("/users", response_model=List[UserOut])
def list_all_users(
    email_contains: Optional[str] = Query(None, max_length=120),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List every user in the system (super-user only). Useful for
    picking a user when granting a role from the admin panel."""
    require_can(current_user, AdminCapabilities.list_all_users, Scope.platform(), db)

    q = db.query(User).order_by(User.id.asc())
    if email_contains:
        like = f"%{email_contains.lower()}%"
        q = q.filter(User.email.ilike(like))
    return [UserOut.model_validate(u) for u in q.limit(500).all()]


# ── Organizations ──────────────────────────────────────────────────────────

@router.get("/organizations", response_model=List[OrgOut])
def list_organizations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List every organization (super-user only). The admin UI starts at
    this list and drills into a specific org's communities + members."""
    require_can(current_user, AdminCapabilities.list_all_users, Scope.platform(), db)

    rows = db.query(Organization).order_by(Organization.id.asc()).all()
    return [OrgOut.model_validate(o) for o in rows]


@router.post("/organizations", response_model=OrgOut, status_code=201)
def create_organization(
    payload: OrgCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new organization (super-user only)."""
    require_can(current_user, PlatformCapabilities.create_organization, Scope.platform(), db)

    # Slug must be globally unique.
    if db.query(Organization).filter(Organization.slug == payload.slug).first():
        raise HTTPException(409, f"An organization with slug '{payload.slug}' already exists.")

    org = Organization(name=payload.name, slug=payload.slug)
    db.add(org)
    db.commit()
    db.refresh(org)
    return OrgOut.model_validate(org)


# ── Communities ────────────────────────────────────────────────────────────

@router.get("/communities", response_model=List[CommunityOut])
def list_communities(
    organization_id: int = Query(..., description="Restricts results to this org"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List communities inside an organization. Org admins see only
    their own org; super-users see any."""
    require_can(
        current_user, AdminCapabilities.view_role_assignments,
        Scope.organization(organization_id), db,
    )
    rows = (
        db.query(Community)
        .filter(Community.organization_id == organization_id)
        .order_by(Community.id.asc())
        .all()
    )
    return [CommunityOut.model_validate(c) for c in rows]


@router.post("/communities", response_model=CommunityOut, status_code=201)
def create_community(
    payload: CommunityCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a community inside an organization. Super-user creates
    anywhere; org_admin only inside their own org."""
    org = db.query(Organization).filter(Organization.id == payload.organization_id).first()
    if not org:
        raise HTTPException(404, f"Organization {payload.organization_id} not found.")

    require_can(
        current_user, CommunityCapabilities.create_community,
        Scope.organization(payload.organization_id), db,
    )

    # Slug must be unique within the parent org.
    existing = (
        db.query(Community)
        .filter(
            Community.organization_id == payload.organization_id,
            Community.slug == payload.slug,
        )
        .first()
    )
    if existing:
        raise HTTPException(409, f"A community with slug '{payload.slug}' already exists in this org.")

    community = Community(
        organization_id=payload.organization_id,
        name=payload.name,
        slug=payload.slug,
    )
    db.add(community)
    db.commit()
    db.refresh(community)
    return CommunityOut.model_validate(community)


# ── Role assignments ───────────────────────────────────────────────────────

@router.get("/role-assignments", response_model=List[RoleAssignmentOut])
def list_role_assignments(
    user_id:    Optional[int] = Query(None),
    scope_type: Optional[str] = Query(None),
    scope_id:   Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List role assignments, filtered by user OR by scope.

    Authorisation
    ─────────────
    • If filtering by scope: caller must satisfy
      `view_role_assignments` at that scope (super-user always; admin
      of that scope or higher otherwise).
    • If filtering by user OR no filter: caller must be a super-user
      (we don't expose other users' assignments cross-org until Phase
      5 ships scope-bounded views).
    """
    if scope_type is not None:
        if scope_type not in VALID_SCOPES:
            raise HTTPException(422, f"Invalid scope_type '{scope_type}'.")
        if scope_type == "platform":
            scope = Scope.platform()
        else:
            if scope_id is None:
                raise HTTPException(422, f"scope_id required for scope_type='{scope_type}'.")
            scope = Scope(type=scope_type, id=scope_id)
        require_can(current_user, AdminCapabilities.view_role_assignments, scope, db)
    else:
        # No scope filter — only super-users can browse globally.
        require_can(current_user, AdminCapabilities.list_all_users, Scope.platform(), db)

    q = db.query(RoleAssignment, User.email).join(
        User, User.id == RoleAssignment.user_id,
    )
    if user_id is not None:
        q = q.filter(RoleAssignment.user_id == user_id)
    if scope_type is not None:
        q = q.filter(RoleAssignment.scope_type == scope_type)
        if scope_type != "platform":
            q = q.filter(RoleAssignment.scope_id == scope_id)
    q = q.order_by(RoleAssignment.granted_at.asc())
    return [_ra_to_out(r, email) for r, email in q.limit(500).all()]


@router.post("/role-assignments", response_model=RoleAssignmentOut, status_code=201)
def create_role_assignment(
    payload: RoleAssignmentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Grant a role to a user. The caller must hold `assign_role` at
    the target scope (super-user always; admin within scope otherwise).

    Idempotent: trying to insert an assignment that already exists
    returns the existing row instead of raising.
    """
    _validate_role_assignment_payload(payload)
    target_user = db.query(User).filter(User.id == payload.user_id).first()
    if not target_user:
        raise HTTPException(404, f"User {payload.user_id} not found.")

    target_scope = _scope_from_payload(payload)
    require_can(current_user, UserCapabilities.assign_role, target_scope, db)

    # Validate the scope referent exists for non-platform scopes.
    if payload.scope_type == "organization":
        if not db.query(Organization).filter(Organization.id == payload.scope_id).first():
            raise HTTPException(404, f"Organization {payload.scope_id} not found.")
    elif payload.scope_type == "community":
        if not db.query(Community).filter(Community.id == payload.scope_id).first():
            raise HTTPException(404, f"Community {payload.scope_id} not found.")
    elif payload.scope_type == "course":
        from app.models.domain import Course as _Course
        if not db.query(_Course).filter(_Course.id == payload.scope_id).first():
            raise HTTPException(404, f"Course {payload.scope_id} not found.")

    existing = (
        db.query(RoleAssignment)
        .filter(
            RoleAssignment.user_id == payload.user_id,
            RoleAssignment.role == payload.role,
            RoleAssignment.scope_type == payload.scope_type,
            RoleAssignment.scope_id == payload.scope_id,
        )
        .first()
    )
    if existing:
        return _ra_to_out(existing, target_user.email)

    new = RoleAssignment(
        user_id=payload.user_id,
        role=payload.role,
        scope_type=payload.scope_type,
        scope_id=payload.scope_id,
        granted_by=current_user.id,
        granted_via="admin_ui",
    )
    db.add(new)

    # If this is the user's first org-scoped role and they have no home
    # org yet, set it now (per A.2 — first org-scoped acceptance picks
    # the home org). Only for organization/community/course scopes that
    # roll up to an org.
    if payload.scope_type != "platform" and target_user.home_organization_id is None:
        org_id_for_home: Optional[int] = None
        if payload.scope_type == "organization":
            org_id_for_home = payload.scope_id
        elif payload.scope_type == "community":
            c = db.query(Community).filter(Community.id == payload.scope_id).first()
            org_id_for_home = c.organization_id if c else None
        elif payload.scope_type == "course":
            from app.models.domain import Course as _Course
            cc = db.query(_Course).filter(_Course.id == payload.scope_id).first()
            org_id_for_home = cc.organization_id if cc else None
        if org_id_for_home is not None:
            target_user.home_organization_id = org_id_for_home

    db.commit()
    db.refresh(new)
    return _ra_to_out(new, target_user.email)


@router.delete("/role-assignments/{assignment_id}", status_code=204)
def delete_role_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke a role assignment. Caller must satisfy `revoke_role`
    (= same matrix as assign_role) at the target's scope.

    Refuses to revoke the super-user bootstrap row — there must always
    be at least one super-user. Use the admin UI to grant another
    super-user first if you want to retire the bootstrap.
    """
    ra = db.query(RoleAssignment).filter(RoleAssignment.id == assignment_id).first()
    if not ra:
        raise HTTPException(404, "Role assignment not found.")

    target_scope = (
        Scope.platform() if ra.scope_type == "platform"
        else Scope(type=ra.scope_type, id=ra.scope_id)
    )
    require_can(current_user, UserCapabilities.revoke_role, target_scope, db)

    # Last-super-user safety net.
    if ra.role == "super_user" and ra.scope_type == "platform":
        super_count = (
            db.query(RoleAssignment)
            .filter(
                RoleAssignment.role == "super_user",
                RoleAssignment.scope_type == "platform",
            )
            .count()
        )
        if super_count <= 1:
            raise HTTPException(
                status_code=409,
                detail="Cannot revoke the last super-user. Grant another super-user first.",
            )

    db.delete(ra)
    db.commit()
