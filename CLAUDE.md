# AI Study Partner - Claude Code Directives (Context Tree Root)

**CRITICAL RULE:** You are operating within a "Context Tree" architecture. To prevent context confusion, do not load all files at once. Read the specific files relevant to your current task.

## 1. Mandatory Routine (Read Before Coding)
Before executing any complex task, you MUST consult the relevant branches of the Context Tree:
* **If modifying UI/UX:** Read `.context/design_system.md` FIRST. Ensure strict compliance with colors, typography, and "Notion-inspired" minimalism.
* **If modifying AI logic/Prompts:** Read `.context/architecture_patterns.md` and `.context/naming_conventions.md`.
* **If starting a new major feature:** Read `.context/vision.md` to ensure the feature aligns with the product's core pillars and parallel tracks.
* **To understand the current state:** Read `.context/state.md`.
* **To understand the infrastructure:** Read `.context/tech_context.md` and `.context/project-map.md`.

## 2. Build & Run Commands
* **Backend (UV):** `cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload`
* **Frontend (Vite):** `cd ai-study-client && npm run dev`
* **Docker (Dev Environment):** `docker compose up --build`
* **Database Migrations:** `docker exec -it ai_study_backend uv run alembic upgrade head`

## 3. End of Session Rules
* Never leave a task half-finished without documenting the exact state.
* If you alter the database schema, API routing, or overall architecture, you MUST update `SYSTEM_ARCHITECTURE.md` to reflect the changes.
* **MEGA-CONTEXT MAINTENANCE:** At the end of every work session, you MUST update `PART 6` and `PART 7` of `.context/GEMINI_MEGA_CONTEXT.md` to reflect the latest milestones achieved, database changes made, new routes added, and the current state of the project. This file is intended to grow indefinitely as the primary synchronization anchor.

## 4. Quality Gate (Mandatory for Every Feature)
* **NO FEATURE WITHOUT TESTS:** Every significant code change must include a corresponding test script in the relevant directory (`backend/tests/`, `ai-study-client/src/tests/`, or `tests/e2e/`).
* **EDGE CASE COVERAGE:** Explicitly test for empty states, null values, and network failures — not just the happy path.
* **REGRESSION LOG:** If a bug from `active_tracker.md` is fixed, a regression test must be added to `backend/tests/` or `tests/e2e/` to ensure it never returns. Label the test class `TestRegressions`.
