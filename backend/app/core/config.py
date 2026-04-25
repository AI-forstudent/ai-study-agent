"""
app/core/config.py
──────────────────
Central settings object. Reads from the project .env file (same one used
by the existing flat backend).  No extra dependencies required — relies only
on python-dotenv which is already installed.
"""

import os
from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise ValueError(f"[config] Required env variable '{key}' is not set.")
    return val


# ── Database ───────────────────────────────────────────────────────────────

DATABASE_URL: str = _require("DATABASE_URL")

# ── Google AI ─────────────────────────────────────────────────────────────

GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")

# ── CORS ──────────────────────────────────────────────────────────────────

_origins_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _origins_raw.split(",")]

# ── JWT ───────────────────────────────────────────────────────────────────

SECRET_KEY: str = os.getenv("SECRET_KEY", "change-me-in-production")
ALGORITHM: str  = "HS256"

# ── Observability & AI Ops (optional — leave empty to disable) ─────────────

# Sentry: error tracking + performance monitoring.
# Get DSN from https://sentry.io → Project Settings → Client Keys.
SENTRY_DSN: str = os.getenv("SENTRY_DSN", "")

# LangSmith: prompt tracing & RAG evaluation.
# Get key from https://smith.langchain.com → Settings → API Keys.
LANGSMITH_API_KEY: str = os.getenv("LANGSMITH_API_KEY", "")
