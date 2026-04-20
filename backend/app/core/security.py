"""
app/core/security.py
────────────────────
Password hashing (bcrypt) and JWT creation/verification.
SECRET_KEY and ALGORITHM are pulled from app.core.config to keep credentials
in one place.
"""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import ALGORITHM, SECRET_KEY

ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7   # 1 week


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8"),
    )


def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
