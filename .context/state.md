# Project State & Session Memory

## Current Context
- **MVP Status:** Live on AWS — Nginx reverse proxy, HTTPS, fully Dockerized.
- **Core Engine:** FastAPI + SQLAlchemy (PostgreSQL/pgvector) + React/TS.
- **AI Logic:** Hybrid thread history (Python/SQL CTE), RAG with 768-dim embeddings (Gemini `gemini-2.5-flash-lite`).
- **Vision:** "Study Commons" — community-driven processed knowledge sharing.

---

## Phase Status

### Phase 1 — Refactoring & Infrastructure Prep ✅ COMPLETE
- **Token Estimation removed:** `estimate-summary` endpoint, `count_tokens_in_text`, and all frontend token-gate UI deleted. Generate Summary now fires directly.
- **Gemini unified:** All Gemini calls route through `ask_gemini()`. `generate_document_summary` no longer calls `llm.invoke()` directly.
- **Schema expanded:**
  - `Document`: added `is_public` (Boolean, default=False), `shared_at` (DateTime, nullable).
  - `Persona`: renamed `system_prompt` → `manual_prompt_override` (nullable), added `traits` (JSONB).
  - Alembic migrations applied and verified.
- **Volume mount fixed:** `./backend/alembic/versions` is now mounted in `docker-compose.yml` — no more `docker cp` for migrations.

### Phase 2 — Modular Persona Engine ✅ COMPLETE
- **Backend `TRAIT_LIBRARY`** — module-level dict in `services.py` mapping trait keys (`pedagogy`, `style`, `tone`, `language`) to prompt fragments.
- **`compose_system_prompt(persona_id, db)`** — priority chain: `manual_prompt_override` → traits → default. Builds a structured prompt with `## ROLE / TEACHING METHOD / RESPONSE STYLE / TONE / LANGUAGE` sections.
- **`get_chat_response_for_thread`** updated to call `compose_system_prompt` instead of inline DB query.
- **`POST /personas/`** endpoint added with 409 conflict guard.
- **`schemas.py`** updated: `PersonaCreate` + `PersonaResponse` match new model (no `system_prompt`).
- **Seed:** `socratic_mentor` persona seeded with traits `{pedagogy: socratic, style: concise, tone: encouraging, language: hebrew}`.

### Phase 3 — Frontend Refactor & Persona Lab ✅ COMPLETE

#### App.tsx Refactor (God Component → Thin Orchestrator)
- **`src/hooks/useAuth.ts`** — `isAuthenticated`, `view`, startup health check.
- **`src/hooks/useDocuments.ts`** — file, documentId, upload, select (Blob load), delete, `reset()`. Uses Zustand directly for `setActiveThread`.
- **`src/hooks/useChat.ts`** — threads, messages, fork, quick/smart actions, `reset()`. Owns thread lifecycle: clears + re-fetches on `documentId` change.
- **`src/components/layout/Header.tsx`** — pure display, zero state. Props: userDocs, treeViewMode, callbacks.
- **`src/components/layout/MainWorkspace.tsx`** — owns `scale`, `chatWidth`, `isDragging`, `pdfContainerRef`, `handleTextSelection`. Renders PdfViewer + drag divider + ChatPanel.
- **`App.tsx`** reduced from ~525 lines to ~60 lines.

#### Persona Lab (`src/components/PersonaLab.tsx`)
- Trait grid (2×2): Pedagogy, Style, Tone, Language — card-based chip selection.
- Persona Name input with live ID preview (`slugify`).
- 4-step synthesis animation: Analyzing → Synthesizing → Building → Finalizing (progress bar, 700ms steps).
- POST `/personas/` on completion; success state shows composed prompt preview.
- Error state with retry.
- Accessed via "Persona Lab" button in Header (`FlaskConical` icon, indigo palette).

---

### Phase 3.5 — Landing Page ✅ COMPLETE
- **`LandingPage.tsx`** (`src/components/layout/LandingPage.tsx`) — hero section with gradient headline, 3 feature cards (Analyze/Customize/Connect), indigo-violet gradient CTA.
- **`useAuth`** extended with `showAuthForm` + `handleLogoutToLanding()`. Logout returns user to landing, not raw auth form.
- **App.tsx routing:** unauthenticated → LandingPage → (CTA) → AuthView → main app.

### Phase 4 — Study Commons: Infrastructure & Visibility ✅ COMPLETE

#### Backend
- **`PATCH /documents/{document_id}/visibility`** — toggles `is_public`, sets `shared_at = now()` on publish, clears on unpublish. JWT-authenticated; 403 if not owner.
- **`GET /documents/public`** — unauthenticated public feed. Returns all `is_public=True` documents with `owner_email` + `summary`. Ordered by `shared_at` desc.
- **`schemas.py`** — `DocumentResponse` now includes `is_public` + `shared_at`. Added `VisibilityUpdate` (request body) and `PublicDocumentResponse` (feed response).

#### Frontend
- **`api.ts`** — `toggleVisibility(documentId, isPublic)` + `getPublicDocuments()` added.
- **`useDocuments`** — `isPublic` state synced from `userDocs` on `documentId` change. `handleToggleVisibility()` with optimistic update + error rollback.
- **`Header.tsx`** — visibility toggle pill next to DocumentPicker. Globe (emerald) when public, LockKeyhole (slate) when private. Hidden when no document selected.

---

### Phase 4B — Public Gallery ✅ COMPLETE

- **`PublicGallery.tsx`** (`src/components/PublicGallery.tsx`) — responsive 3-col grid fetching `GET /documents/public`. Works for both authenticated and unauthenticated users.
  - **DocCard:** title, owner email, 3-line clamped summary, shared date, Preview + Add actions.
  - **PreviewPanel:** fixed right slide-over (480px) with full summary, meta, CTA. Shows "Sign in to clone" for unauthenticated users.
  - **Clone intent:** `console.log('INTENT: clone', id)` + optimistic `clonedIds` Set with CheckCircle feedback. Real clone API wired in next step.
  - **Client-side search:** filters on title + summary + owner email.
  - **Empty/loading/error states** all handled.
- **`LandingPage.tsx`** — `onOpenGallery` prop added; "Community" nav link + "Explore Community Library" secondary CTA.
- **`Header.tsx`** — "Community" button (violet palette, `Library` icon) added left of Persona Lab.
- **`useAuth.ts`** — `view` type extended to `'main' | 'lab' | 'gallery'`.
- **`App.tsx`** — `showGallery` local state; gallery routed for both auth states; `onOpenGallery` wired to LandingPage and Header.

---

### Phase 3.5.1 — Design System Constitution + Auth Modal ✅ COMPLETE
- **`.context/design_system.md`** — Notion-inspired constitution: colors, typography, shadows, buttons, inputs, banned patterns.
- **`tailwind.config.js`** — Inter font, `notion-*` color tokens.
- **`index.css`** — Google Fonts import, global body defaults, selection highlight.
- **`AuthModal.tsx`** (`src/components/ui/AuthModal.tsx`) — modal overlay (not full-page). Google "G" placeholder + OR divider + email/password form + guest login. Backdrop click + Escape to close.
- **`AuthView.tsx`** — DELETED (replaced by modal).
- **Guest login backend:** `POST /guest-login/` — create-or-get guest user, no password. Fixes "Guest login failed" bug from two-step dance.
- **Routing change:** unauthenticated views (Landing/Gallery) always rendered; AuthModal floats on top.

### Phase 4C — Notion Sidebar Layout ✅ COMPLETE
- **`AppLayout.tsx`** (`src/components/layout/AppLayout.tsx`) — two-column shell: fixed sidebar + flex-1 main.
- **`Sidebar.tsx`** (`src/components/layout/Sidebar.tsx`) — `w-60`, `bg-[#F7F7F5]`, `border-e`. Sections: MY LIBRARY (Upload PDF ghost label, DocumentPicker, visibility pill), WORKSPACE (Community, Persona Lab), DISPLAY (treeViewMode select), footer (Settings, Sign out).
- **`Header.tsx`** — DELETED (fully replaced by Sidebar).
- **`App.tsx`** rewritten — all authenticated views wrapped in `AppLayout`. `dir="rtl"` removed from outer wrapper. Sidebar constructed once and passed to all authenticated `AppLayout` instances.
- **`PersonaLab.tsx`** — standalone header removed; outer wrapper changed to `h-full overflow-y-auto bg-[#F7F7F5]`; design system tokens applied throughout.
- **`PublicGallery.tsx`** — `inAppLayout` prop added; standalone top bar conditional; design tokens applied.
- **`FileUploadView.tsx`** — `rounded-3xl` → `rounded-2xl`, `blue-*` → `indigo-*`, `shadow-xl` removed, design tokens applied.
- **`DocumentPicker.tsx`** — `text-blue-600` → `text-[#37352F]`, `shadow-xl` → `shadow-lg border border-[#E8E8E6]`, logical CSS (`end-0`).
- **RTL/i18n prep:** All new code uses logical CSS properties (`ms/me`, `ps/pe`, `border-s/e`, `text-start/end`, `start/end-*`).

---

---

### Infrastructure Standardization & Context Tree ✅ COMPLETE
- **Docker 3-file architecture:** `docker-compose.yml` (base) + `docker-compose.override.yml` (dev/Monster, git-ignored) + `docker-compose.prod.yml` (AWS). Dev frontend now runs Vite HMR via `node:20-slim`, not Nginx.
- **Alembic fix:** Missing `personas` table injected into init migration `b0bdf9f132a3`. Fresh-DB `alembic upgrade head` now succeeds end-to-end.
- **Legacy cleanup:** Deleted `backend/database.py`, `backend/security.py`, `scripts/` directory.
- **Context Tree established:** `CLAUDE.md` rewritten as root directive. `.context/` directory populated: `vision.md`, `design_system.md`, `architecture_patterns.md`, `naming_conventions.md`, `state.md`, `tech_context.md`, `project-map.md`, `active_tracker.md`.
- **Observability skeleton:** Sentry placeholder in `main.py`; `SENTRY_DSN` + `LANGSMITH_API_KEY` env vars in `config.py`.
- **Mermaid diagram:** Added Visual Overview flowchart to `SYSTEM_ARCHITECTURE.md`.
- **Vision updated:** Section 5 (Technical Scalability Roadmap) added to `vision.md`.

---

## Active Next Steps — Feature Development & Optimization

> **Current Track: A (Core Study Engine) + C (Study Commons)**

- **Clone API:** `POST /documents/{id}/clone` backend endpoint — copies `userdocuments` record to the authenticated user's library. Wire `handleClone` in `PublicGallery.tsx` to real API (currently `console.log` only).
- **Global search:** `GET /documents/public/search?q=` — server-side full-text search (currently client-side only).
- **Pagination:** Paginate `GET /documents/public` for large libraries.
- **Session Memory persistence:** `saveSessionMemory` in Zustand only updates local state — `PUT /api/v1/personas/{id}` must be called on session wrap-up to persist to DB.

---

## Lessons Learned & Standing Rules
- **Recursive CTE:** Always use `get_thread_history_sql` for trees deeper than level 3 — Python recursion hits depth limits in prod.
- **CORS/Proxy:** All new endpoints must be covered by Nginx proxy config and CORS middleware.
- **Alembic renames:** `autogenerate` misreads column renames as drop+add (data loss). Always write rename migrations manually using `op.alter_column(..., new_column_name=...)`.
- **Alembic NOT NULL + existing rows:** New `nullable=False` columns require `server_default` in the migration or PostgreSQL will reject it.
- **Docker volumes:** `alembic/versions/` is now mounted — no `docker cp` needed for migrations. `uploads/` was already mounted.
- **Thread lifecycle:** `useChat`'s `useEffect([documentId])` is the single owner of thread clear+refetch. Do not manually call `setThreads([])` from other hooks.
- **Zustand access in hooks:** `useDocuments` and `useChat` import `useAppStore` directly — no prop-drilling of `setActiveThread` through App.
