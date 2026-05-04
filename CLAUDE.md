# AI Study Partner — Claude Code Directives

> Cleaned 2026-05-04 — see `CHANGES.md`. Prior version referenced a `.context/` directory that does not exist in the repository; those references have been removed and the relevant guidance folded into `SYSTEM_ARCHITECTURE.md`.

## 1. Read-Before-Coding

Before any non-trivial change, read the relevant section(s) of **`SYSTEM_ARCHITECTURE.md`** — that file is the single source of truth for:
- Tech stack & ports (§2)
- Directory tree & file index (§4–§6)
- CAS pipeline, Folder model, data flows (§7–§9)
- ADRs explaining *why* each major choice was made (§10)
- Hard constraints you must respect (§12)

## 2. Build & Run Commands

- **Backend (UV):** `cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload`
- **Frontend (Vite):** `cd ai-study-client && npm run dev`
- **Docker (Dev Environment):** `docker compose up --build`
- **Database Migrations:** `docker exec -it ai_study_backend uv run alembic upgrade head`
- **Generate a new migration:** `docker exec -it ai_study_backend uv run alembic revision --autogenerate -m "describe change"`

## 3. End of Session Rules

- Never leave a task half-finished without documenting the exact state.
- If you alter the database schema, API routing, or overall architecture, you **must** update `SYSTEM_ARCHITECTURE.md` (the relevant file-index entries, ADRs if a decision is being recorded, or §12 constraints).
- Add an entry to `CHANGES.md` describing what changed and why.

## 4. Quality Gate (Mandatory for Every Feature)

- **NO FEATURE WITHOUT TESTS:** Every significant code change must include a corresponding test in the relevant directory (`backend/tests/`, `ai-study-client/src/tests/`, or `tests/e2e/`).
- **EDGE CASE COVERAGE:** Explicitly test for empty states, null values, and network failures — not just the happy path.
- **REGRESSION LOG:** When fixing a bug, add a regression test to ensure it never returns. Label the test class `TestRegressions`.

## 5. Seed Data Policy (Mandatory for Every New Entity)

- Whenever a new database entity or complex UI component is created, realistic Mock Data (Seed Data) **must** be generated.
- **Backend seeds** (`backend/app/db/seeds/`): Python scripts using SQLAlchemy to populate the dev DB with representative data. Run with: `docker exec ai_study_backend uv run python -m app.db.seeds.<script_name>`.
- **Frontend mocks** (`ai-study-client/src/data/mocks/`): TypeScript files exporting typed mock objects that mirror the API response shape. Used during component development and visual testing.
- Both seed and mock files are version-controlled. The app must always be testable visually without manual data entry.

## 6. Style & Conventions

- Backend: `snake_case` field names everywhere except `PersonaResponse` (camelCase — see §12 constraint table).
- Frontend: `camelCase` everywhere; the `Persona` type mirrors backend `PersonaResponse` directly.
- Imports must use the canonical paths: `app.models.domain` (not legacy flat modules), `app.core.config`, etc.
- Prompts: keep section headers consistent (`## ROLE`, `## TONE`, `## STYLE`, `## LANGUAGE`, etc.) — the persona editor parses these visually.
