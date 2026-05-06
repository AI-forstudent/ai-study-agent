"""
app/main.py
───────────
Unified AI Study Partner API — single source of truth on port 8001.

All legacy routes (auth, documents, threads) have been migrated here under
/api/v1/* prefixes alongside the existing personas and chat routers.

Run with:
    cd backend
    uv run uvicorn app.main:app --reload --port 8001
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

# ── Observability (Sentry) ─────────────────────────────────────────────────
# Uncomment and set SENTRY_DSN in .env to enable error tracking.
#
# import sentry_sdk
# from app.core.config import SENTRY_DSN
# if SENTRY_DSN:
#     sentry_sdk.init(
#         dsn=SENTRY_DSN,
#         traces_sample_rate=0.2,   # 20% of requests traced for performance
#         profiles_sample_rate=0.1,
#     )
# ──────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import text

from app.core.config import ALLOWED_ORIGINS
from app.core.database import SessionLocal, engine
from app.models.domain import BaseDocument
from app.services.model_router import list_manifest, route_llm_request
from app.api.routers import personas as personas_router
from app.api.routers import chat as chat_router
from app.api.routers import auth as auth_router
from app.api.routers import documents as documents_router
from app.api.routers import threads as threads_router
from app.api.routers import folders as folders_router
from app.api.routers import personal_hub as personal_hub_router
from app.api.routers import courses as courses_router
from app.api.routers import sessions as sessions_router
from app.api.routers import library as library_router
from app.api.routers.personas import seed_db as _seed_db


# ── Lifespan ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure pgvector extension is available before any ORM queries
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()

    db = SessionLocal()
    try:
        # Seed canonical personas on first boot (idempotent)
        inserted = _seed_db(db)
        if inserted:
            print(f"[seed] Inserted {inserted} seed personas.")
        else:
            print("[seed] Personas table already populated — skipping seed.")

        # Remove uploaded files that have no matching BaseDocument row
        uploads_dir = "uploads"
        os.makedirs(uploads_dir, exist_ok=True)
        valid_paths = {
            row.file_path
            for row in db.query(BaseDocument.file_path)
            .filter(BaseDocument.file_path.isnot(None))
            .all()
        }
        deleted = 0
        for filename in os.listdir(uploads_dir):
            full_path = f"{uploads_dir}/{filename}"
            if full_path not in valid_paths:
                try:
                    os.remove(full_path)
                    deleted += 1
                except Exception as e:
                    print(f"[WARNING] Could not delete orphaned file {full_path}: {e}")
        if deleted:
            print(f"[startup] Removed {deleted} orphaned upload file(s).")
        else:
            print("[startup] Upload directory is in sync with DB.")
    except Exception as exc:
        print(f"[startup] ERROR during startup: {exc}")
    finally:
        db.close()

    yield

    print("[shutdown] Server shutting down cleanly.")


# ── App ────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="AI Study Partner — Unified API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    redirect_slashes=False,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded PDFs as static files (same path the frontend requests)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


# ── Routers ────────────────────────────────────────────────────────────────

app.include_router(auth_router.router,          prefix="/api/v1/auth")
app.include_router(documents_router.router,     prefix="/api/v1/documents")
app.include_router(folders_router.router,       prefix="/api/v1/folders")
app.include_router(threads_router.router,       prefix="/api/v1/threads")
app.include_router(personas_router.router,      prefix="/api/v1/personas")
app.include_router(chat_router.router,          prefix="/api/v1/chat")
app.include_router(personal_hub_router.router,  prefix="/api/v1/profile")
app.include_router(courses_router.router,       prefix="/api/v1/courses")
app.include_router(sessions_router.router,      prefix="/api/v1/sessions")
app.include_router(library_router.router,       prefix="/api/v1/library")


# ── Health ─────────────────────────────────────────────────────────────────

@app.get("/health", tags=["infra"])
def health_check():
    return {"status": "ok", "service": "unified-api", "version": "1.0.0"}


# ── Router test (dev) ──────────────────────────────────────────────────────

class RouterTestRequest(BaseModel):
    task_type: str
    tier: str | None = None


class RouterTestResponse(BaseModel):
    task_type:      str
    tier:           str | None
    resolved_model: str
    manifest:       dict[str, str]


@app.post("/api/v1/router-test", response_model=RouterTestResponse, tags=["model-router"])
def router_test(payload: RouterTestRequest):
    try:
        resolved = route_llm_request(payload.task_type, payload.tier)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return RouterTestResponse(
        task_type=payload.task_type,
        tier=payload.tier,
        resolved_model=resolved,
        manifest=list_manifest(),
    )
