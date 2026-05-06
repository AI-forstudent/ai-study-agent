# AI Study Partner — Coding Agent Directives

> **Audience:** Both Claude Code and Gemini CLI read this file (`GEMINI.md` is a symlink to it).
> **Last cleaned:** 2026-05-04 — see `CHANGES.md`.

---

## 1. Read-Before-Coding (mandatory)

Before any non-trivial change, read **`SYSTEM_ARCHITECTURE.md`** — the single source of truth for:

- Tech stack & ports (§2)
- Directory tree & file index (§4–§6)
- CAS pipeline, Folder model, data flows (§7–§9)
- ADRs explaining *why* each major choice was made (§10)
- Hard constraints you must respect (§12)

For supplementary product/vision context (the long-term vision, marketplace plans, the Personal Meta-Data Namespace), read **`docs/vision.md`**.

**At session start, also read `docs/active_tracker.md`** — this tells you what is in flight, what is awaiting user confirmation, and what tech debt is *known and deferred* (so you don't "discover" it as a fresh bug).

---

## 2. Session Protocol

### Start of session
1. Read `SYSTEM_ARCHITECTURE.md` (the relevant sections — use the ToC).
2. Read `docs/active_tracker.md`.
3. State what you understand the task to be in 2–3 sentences before writing any code.

### End of session
1. Update `docs/active_tracker.md` with anything new in flight, awaiting user confirmation, or newly-discovered tech debt.
2. If you altered DB schema, API routing, or overall architecture, update `SYSTEM_ARCHITECTURE.md` (file-index entries, ADRs, or §12 constraints).
3. Add an entry to `CHANGES.md` describing what changed and why — but **only for structural changes** (deletions, renames, doc reorganization). Normal feature work goes in commit messages.
4. Never leave a task half-finished without documenting the exact state in the tracker.

---

## 3. Standing Rules (non-negotiable)

### Bug confirmation rule
A bug **CANNOT** be marked `✅ Fixed` and **CANNOT** be removed from `docs/active_tracker.md` until the **user explicitly confirms** the fix worked in the real UI. LLM self-assessment does not count as confirmation. Logic-only fixes with deterministic tests are the only exception.

### No feature without tests
Every significant code change must include a corresponding test in the relevant directory:
- Backend: `backend/tests/`
- Frontend: `ai-study-client/src/tests/`
- E2E: `tests/e2e/`

### Edge case coverage
Explicitly test for empty states, null values, and network failures — not just the happy path.

### Regression log
When fixing a bug, add a regression test labeled `TestRegressions` to ensure it never returns.

### Seed data policy
Whenever a new database entity or complex UI component is created, realistic seed/mock data **must** be generated:
- Backend seeds: `backend/app/db/seeds/` (Python + SQLAlchemy). Run with `docker exec ai_study_backend uv run python -m app.db.seeds.<script_name>`.
- Frontend mocks: `ai-study-client/src/data/mocks/` (typed TypeScript objects mirroring API response shape).

Both are version-controlled. The app must always be visually testable without manual data entry.

---

## 4. Build & Run Commands

| Action | Command |
|---|---|
| Backend dev (UV) | `cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload` |
| Frontend dev (Vite) | `cd ai-study-client && npm run dev` |
| Full stack (Docker) | `docker compose up --build` |
| Run migrations | `docker exec -it ai_study_backend uv run alembic upgrade head` |
| Generate migration | `docker exec -it ai_study_backend uv run alembic revision --autogenerate -m "describe change"` |
| Backend tests | `cd backend && uv run pytest` |
| Frontend tests | `cd ai-study-client && npm test` |
| E2E tests | `./run_tests.sh` |

---

## 5. Style & Conventions

- **Backend field names:** `snake_case` everywhere except `PersonaResponse` which is `camelCase` (see `SYSTEM_ARCHITECTURE.md` §12 constraint table).
- **Frontend:** `camelCase` everywhere; the `Persona` type mirrors backend `PersonaResponse` directly.
- **Imports:** use canonical paths — `app.models.domain` (not legacy flat modules), `app.core.config`, etc.
- **Persona prompts:** keep section headers consistent (`## ROLE`, `## TONE`, `## STYLE`, `## LANGUAGE`) — the persona editor parses these visually.
- **No new top-level dirs** without updating `SYSTEM_ARCHITECTURE.md` §4.

---

## 6. MCP Tool Usage

Before guessing about the database schema, **use the Postgres MCP server** (`mcp__postgres__*` tools) to query the live schema. This is faster and more reliable than reading `domain.py` from scratch.

Before referencing a library API, **use the Context7 MCP server** to fetch live, version-correct docs. The project uses fast-moving libraries (React 19, FastAPI 0.128+, LangChain, pdfplumber) — your training data may be stale.

For UI changes, **use the Playwright MCP server** to actually verify the change works in a browser before reporting "done."

---

## 7. Sub-Folder Context

When working primarily in `backend/` or `ai-study-client/`, also read the local `CLAUDE.md` in that directory — it has stack-specific rules that don't belong in the root file.
