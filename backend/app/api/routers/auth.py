"""
app/api/routers/auth.py
───────────────────────
User registration, login, guest login, and the get_current_user dependency.

Mounted at /api/v1/auth in app/main.py.

get_current_user is exported so document and thread routers can depend on it
without a circular import.
"""

from __future__ import annotations

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.config import ALGORITHM, SECRET_KEY
from app.core.database import get_db
from app.core.security import create_access_token, get_password_hash, verify_password
from app.models.domain import User
from app.schemas.schemas import UserCreate, UserResponse

router = APIRouter(tags=["auth"])

# tokenUrl must match the full mounted path so Swagger UI's Authorize works
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

GUEST_EMAIL = "guest@studyagent.ai"


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


# ── Routes ─────────────────────────────────────────────────────────────────

@router.post("/register", response_model=UserResponse, status_code=201)
def register(user: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    new_user = User(email=user.email, password_hash=get_password_hash(user.password))
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.post("/guest-login")
def guest_login(db: Session = Depends(get_db)):
    """Creates the shared guest account on first call, then issues a token.
    Intentionally open — no password required."""
    guest = db.query(User).filter(User.email == GUEST_EMAIL).first()
    if not guest:
        guest = User(
            email=GUEST_EMAIL,
            password_hash=get_password_hash("__guest_managed__"),
        )
        db.add(guest)
        db.commit()
        db.refresh(guest)
    return {
        "access_token": create_access_token(data={"sub": str(guest.id)}),
        "token_type": "bearer",
    }


@router.post("/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    # OAuth2PasswordRequestForm uses 'username' field; we treat it as email
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return {
        "access_token": create_access_token(data={"sub": str(user.id)}),
        "token_type": "bearer",
    }
