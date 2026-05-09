"""
app/api/routers/auth.py
───────────────────────
User registration, login, guest login, Google OAuth, and the
get_current_user dependency.

Mounted at /api/v1/auth in app/main.py.

get_current_user is exported so document and thread routers can depend on it
without a circular import.
"""

from __future__ import annotations

import uuid

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import (
    ALGORITHM,
    GOOGLE_OAUTH_CLIENT_ID,
    SECRET_KEY,
)
from app.core.database import get_db
from app.core.security import create_access_token, get_password_hash, verify_password
from app.models.domain import RoleAssignment, User
from app.schemas.schemas import UserCreate, UserResponse

router = APIRouter(tags=["auth"])

# tokenUrl must match the full mounted path so Swagger UI's Authorize works
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


# ── Dependency ─────────────────────────────────────────────────────────────

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency: decode JWT and return the authenticated User row."""
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except Exception:
        raise credentials_exception

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise credentials_exception
    return user


# ── Helpers ────────────────────────────────────────────────────────────────

def _issue_token_for(user: User) -> dict:
    """Wrap a User row in the response shape the frontend expects."""
    return {
        "access_token": create_access_token(data={"sub": str(user.id)}),
        "token_type": "bearer",
    }


# ── Routes ─────────────────────────────────────────────────────────────────

# ── Whoami ─────────────────────────────────────────────────────────────────

class RoleAssignmentOut(BaseModel):
    """Compact view of a role assignment, returned by /auth/me so the
    frontend can decide which admin pages to expose without fetching
    the full assignments list."""
    id:           int
    role:         str
    scope_type:   str
    scope_id:     int | None
    granted_via:  str

    class Config:
        from_attributes = True


class MeResponse(BaseModel):
    id:                   int
    email:                str
    auth_provider:        str
    subscription_tier:    str
    home_organization_id: int | None
    is_super_user:        bool
    has_admin_role:       bool   # any of super_user / org_admin / community_admin / course_admin
    role_assignments:     list[RoleAssignmentOut]


@router.get("/me", response_model=MeResponse)
def whoami(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the calling user's identity + their role assignments.

    Drives the Admin sidebar entry's visibility on the frontend (shown
    when `has_admin_role` is true) and the Phase-5 admin UI's gate
    decisions on which sub-tabs to render. Cheap query — one row from
    `users` + every row this user holds in `role_assignments`.
    """
    rows = (
        db.query(RoleAssignment)
        .filter(RoleAssignment.user_id == current_user.id)
        .order_by(RoleAssignment.granted_at.asc())
        .all()
    )

    is_super = any(r.role == "super_user" for r in rows)
    has_admin = any(r.role in {
        "super_user", "org_admin", "community_admin", "course_admin",
    } for r in rows)

    return MeResponse(
        id=current_user.id,
        email=current_user.email,
        auth_provider=current_user.auth_provider,
        subscription_tier=current_user.subscription_tier,
        home_organization_id=current_user.home_organization_id,
        is_super_user=is_super,
        has_admin_role=has_admin,
        role_assignments=[RoleAssignmentOut.model_validate(r) for r in rows],
    )


@router.post("/register", response_model=UserResponse, status_code=201)
def register(user: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    new_user = User(
        email=user.email,
        password_hash=get_password_hash(user.password),
        auth_provider="password",
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.post("/guest-login")
def guest_login(db: Session = Depends(get_db)):
    """Create a fresh, isolated guest account and issue a token.

    Each call mints a brand-new User with a UUID-based email so guests cannot
    see each other's data. Tier is set to 'guest' so the future quota system
    applies the smallest credit allowance to these accounts.

    Intentionally open — no password required.
    """
    guest_email = f"guest-{uuid.uuid4().hex[:12]}@studyagent.ai"
    guest = User(
        email=guest_email,
        password_hash=get_password_hash(uuid.uuid4().hex),  # unguessable, never used
        auth_provider="password",
        subscription_tier="guest",
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)
    return _issue_token_for(guest)


@router.post("/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    # OAuth2PasswordRequestForm uses 'username' field; we treat it as email
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return _issue_token_for(user)


# ── Google Sign-In ─────────────────────────────────────────────────────────

class GoogleLoginRequest(BaseModel):
    """Body for POST /api/v1/auth/google.

    `id_token` is the JWT issued by Google Identity Services on the frontend
    (the `credential` field returned by `google.accounts.id`). The backend
    re-verifies the signature, audience, and issuer before trusting any claims.
    """
    id_token: str


@router.post("/google")
def google_login(payload: GoogleLoginRequest, db: Session = Depends(get_db)):
    """Verify a Google ID token and issue our own JWT.

    Account-linking strategy:
      1. If a user with `google_sub == sub` exists → log them in.
      2. Else if a user with the same `email` exists (legacy password account)
         → attach `google_sub` to that row, mark `auth_provider='google'`, log in.
      3. Else → create a fresh user with tier='free' and auth_provider='google'.

    The flow refuses to accept the token unless `email_verified` is true so a
    Google account using an unverified email cannot hijack a password account
    that registered with the same address.
    """
    if not GOOGLE_OAUTH_CLIENT_ID:
        raise HTTPException(
            status_code=503,
            detail="Google Sign-In is not configured on this server.",
        )

    # Lazy import: keeps `google-auth` out of the cold-start path for deployments
    # that disable Google Sign-In via missing env var.
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token
    except ImportError as exc:  # pragma: no cover — install error
        raise HTTPException(
            status_code=503,
            detail="Google Sign-In dependency missing — install google-auth.",
        ) from exc

    try:
        idinfo = google_id_token.verify_oauth2_token(
            payload.id_token,
            google_requests.Request(),
            GOOGLE_OAUTH_CLIENT_ID,
        )
    except ValueError as exc:
        # Invalid signature, expired token, wrong audience, etc.
        raise HTTPException(status_code=401, detail=f"Invalid Google ID token: {exc}")

    sub = idinfo.get("sub")
    email = (idinfo.get("email") or "").lower()
    email_verified = idinfo.get("email_verified", False)

    if not sub or not email:
        raise HTTPException(status_code=401, detail="Google token missing required claims.")

    if not email_verified:
        # Reject unverified emails — without this an attacker controlling a
        # Google account with someone else's address could hijack their data.
        raise HTTPException(
            status_code=403,
            detail="Google account email is not verified.",
        )

    # 1. Existing google-linked user
    user = db.query(User).filter(User.google_sub == sub).first()

    # 2. Pre-existing password user with the same email — link & upgrade
    if user is None:
        user = db.query(User).filter(User.email == email).first()
        if user is not None:
            user.google_sub = sub
            user.auth_provider = "google"

    # 3. Brand-new account
    if user is None:
        user = User(
            email=email,
            # Random unguessable password — Google flow is the only login path
            password_hash=get_password_hash(uuid.uuid4().hex),
            auth_provider="google",
            google_sub=sub,
            subscription_tier="free",
        )
        db.add(user)

    db.commit()
    db.refresh(user)
    return _issue_token_for(user)
