# AI Study Partner — System Architecture

> **Maintenance Rule:** This file MUST be updated whenever a new file is created, a file is deleted, a core data structure changes, or routing/state management is altered.

---

## 1. Project Overview

AI Study Partner is a web application that lets students study PDF documents alongside AI agents ("Personas") that guide learning through conversation. Users upload documents, pick or clone a study persona (Socratic mentor, course TA, etc.), and chat in a thread tree that is anchored to specific pages and selected text. Session memory can be compressed and written back into a persona's system prompt so the agent "remembers" the student across sessions.

---

## 2. Tech Stack & Environment

| Layer | Technology | Local Port |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS | 5173 (dev) / 80 (Docker) |
| State | Zustand (`useAppStore`) + React hooks | — |
| **Unified API** | **FastAPI + SQLAlchemy (all routes)** | **8001** |
| Database | PostgreSQL 16 + pgvector | 5433 (host) |
| LLM | Google Gemini (`google-generativeai` + `langchain-google-genai`) | — |
| Reverse Proxy | Nginx | 80 / 443 |
| Container | Docker Compose | — |
| Package mgmt | npm (frontend) / UV (backend) | — |

**Key environment variables:** `VITE_AI_API_URL` (the only API base — port 8001 locally, domain root in production), `GOOGLE_API_KEY`, `DATABASE_URL`.

**Local dev:** `VITE_AI_API_URL=http://localhost:8001` (calls backend directly).  
**Production:** `VITE_AI_API_URL=https://ai-study-agent.com` (Nginx routes `/api/*`, `/uploads/*`, `/health` to `backend:8001`).

---

## 3. Directory Tree

```
AI_Study_Partner/
├── SYSTEM_ARCHITECTURE.md        ← this file
├── CLAUDE.md                     ← Claude Code project instructions
├── docker-compose.yml
│
├── ai-study-client/              ← React frontend
│   ├── src/
│   │   ├── App.tsx               ← root component; all view routing & session logic
│   │   ├── main.tsx              ← React bootstrap
│   │   ├── index.css
│   │   ├── store/
│   │   │   └── useAppStore.ts    ← Zustand global state
│   │   ├── services/
│   │   │   └── api.ts            ← Axios client (port 8000)
│   │   ├── hooks/
│   │   │   ├── useAuth.ts        ← auth state + view routing
│   │   │   ├── useChat.ts        ← thread/message lifecycle
│   │   │   └── useDocuments.ts   ← document upload/select/delete
│   │   ├── types/
│   │   │   ├── index.ts          ← Thread, Message interfaces
│   │   │   └── persona.ts        ← Persona interface + enums
│   │   ├── data/
│   │   │   └── mockPersonas.ts   ← seed data for UI (dev only)
│   │   └── components/
│   │       ├── PersonaLab.tsx
│   │       ├── PersonaEditor.tsx
│   │       ├── ChatPanel.tsx
│   │       ├── PdfViewer.tsx
│   │       ├── FileUploadView.tsx
│   │       ├── DocumentPicker.tsx
│   │       ├── BreadcrumbTree.tsx
│   │       ├── MillerColumnsTree.tsx
│   │       ├── PreFlightModal.tsx
│   │       ├── ResumeToast.tsx
│   │       ├── SessionWrapUpModal.tsx
│   │       ├── SwitchPersonaModal.tsx
│   │       ├── PublicGallery.tsx
│   │       ├── layout/
│   │       │   ├── AppLayout.tsx
│   │       │   ├── Sidebar.tsx
│   │       │   ├── LandingPage.tsx
│   │       │   ├── MainWorkspace.tsx
│   │       │   ├── MyLibrary.tsx
│   │       │   ├── Settings.tsx
│   │       │   ├── PageContainer.tsx
│   │       │   ├── PageHeader.tsx
│   │       │   └── WorkspaceHeader.tsx
│   │       └── ui/
│   │           └── AuthModal.tsx
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.ts
│
└── backend/                      ← Unified API (port 8001)
    ├── database.py               ← Legacy DB helper (used by create_tables.py only)
    ├── security.py               ← Legacy security (used by seed_personas.py only)
    ├── Dockerfile.backend
    ├── pyproject.toml
    ├── app/                      ← All active application code lives here
    │   ├── main.py               ← FastAPI entry point; all routers, lifespan, CORS, StaticFiles
    │   ├── core/
    │   │   ├── config.py         ← settings, ALLOWED_ORIGINS, SECRET_KEY
    │   │   ├── database.py       ← SQLAlchemy engine + get_db()
    │   │   └── security.py       ← bcrypt + JWT (create_access_token, verify_password)
    │   ├── schemas/
    │   │   └── schemas.py        ← All Pydantic request/response models
    │   ├── api/
    │   │   └── routers/
    │   │       ├── auth.py       ← /api/v1/auth — register, login, guest-login, get_current_user
    │   │       ├── documents.py  ← /api/v1/documents — upload, list, delete, summaries, visibility
    │   │       ├── threads.py    ← /api/v1/threads — create, get, fork, add messages
    │   │       ├── personas.py   ← /api/v1/personas — CRUD + clone + seed
    │   │       └── chat.py       ← /api/v1/chat — standalone AI chat (no PDF)
    │   ├── models/
    │   │   └── domain.py         ← ORM: User, Document, Thread, Message, Chunk, PageSummary,
    │   │                            Persona, StudySession, SessionMemory, LectureVideo, VideoSyncIndex
    │   └── services/
    │       ├── document_service.py ← PDF extraction, chunking, RAG, thread history, Gemini wrappers
    │       ├── genai_client.py   ← google-genai SDK singleton (used by chat.py)
    │       ├── model_router.py   ← Alias registry + tier routing
    │       └── prompt_builder.py ← system_prompt → manual_prompt_override → default + SessionMemory
    └── alembic/
        ├── env.py
        └── versions/             ← Migration scripts
```

---

## 4. File Index & Dependencies

### Frontend — Store & Services

**`src/store/useAppStore.ts`**
Global Zustand store. Owns `personas[]` (fetched from Grand Vision `/api/v1/personas`), `activeSession {documentId, personaId}` (persisted to localStorage), `selectedModelTier`, and `showResumePrompt`. Key actions: `fetchPersonas`, `clonePersona`, `createPersona`, `updatePersona`, `deletePersona`, `saveSessionMemory`. Called by almost every component and all three hooks.

**`src/services/api.ts`**
Axios instance using `VITE_AI_API_URL` (unified API, port 8001). Injects `Authorization: Bearer <token>` on every request. All routes now use `/api/v1/...` prefixes: auth at `/api/v1/auth/*`, documents at `/api/v1/documents/*`, threads at `/api/v1/threads/*`, personas at `/api/v1/personas/*`. Imported by `useAuth`, `useChat`, `useDocuments`, and `App.tsx`.

---

### Frontend — Hooks

**`src/hooks/useAuth.ts`**
Manages `isAuthenticated`, `view` (which top-level page to show), and `isAuthModalOpen`. Reads/writes `access_token` from localStorage. Imported by `App.tsx`; drives the outer layout switch.

**`src/hooks/useChat.ts`**
Owns the thread/message lifecycle: `threads[]`, `activeThread`, `inputMessage`, `isSending`. Exposes `handleCreateThread`, `handleQuickAction`, `handleSmartAction`, `handleForkMessage`. Re-fetches threads whenever `documentId` prop changes. Reads `activeSession` and `selectedModelTier` from `useAppStore`.

**`src/hooks/useDocuments.ts`**
Owns document state: `file`, `documentId`, `numPages`, `currentPage`, `userDocs[]`. Handles upload (FormData to `/api/v1/documents/`), blob download via `/uploads/<path>`, and visibility toggle. Calls `fetchPersonas` on mount to warm the persona cache.

---

### Frontend — Types

**`src/types/persona.ts`**
Defines `PersonaType` (`'global' | 'community' | 'personal'`), `TagCategory`, and the `Persona` interface. Field names are camelCase and mirror the backend `PersonaResponse` schema exactly — no transformation needed. Imported by `useAppStore`, `PersonaLab`, `PersonaEditor`, `PreFlightModal`, `SwitchPersonaModal`.

**`src/types/index.ts`**
Defines `Message` (`id, role, content`) and `Thread` (`id, page_number, selected_text, coordinates, messages[], parent_thread_id?, forked_from_message_id?, title?, emoji?`). Imported by `useChat`, `ChatPanel`, `BreadcrumbTree`, `MillerColumnsTree`.

---

### Frontend — Top-Level Components

**`src/App.tsx`**
Root component. Wires together `useAuth`, `useDocuments`, `useChat`, and `useAppStore`. Owns session lifecycle handlers: `handleStartSession` (triggers clone for global/community personas), `handleSwitchPersona`, `handleResumeSession`, `handleWrapUpSave`. Controls which modal is open (PreFlight, WrapUp, SwitchPersona). Renders `AppLayout` or `LandingPage` based on auth state.

**`src/components/PersonaLab.tsx`**
Three-tab persona browser (Store / Community / My Personas). Renders `PersonaCard` grid and `PreviewPanel` slide-over. Opens `PersonaEditor` for edit or clone. Calls `createPersona`, `updatePersona`, `deletePersona` from `useAppStore`. Depends on `PersonaEditor`, the `Persona` type, and `useAppStore`.

**`src/components/PersonaEditor.tsx`**
Full-screen overlay for editing or cloning a persona. Left panel: name, icon, description, tags, system prompt textarea. Right panel: AI refinement chat (integration pending). Two save modes: "Apply to Session" (transient — no DB write) vs "Save Changes" / "Save as Clone" (calls `onSave(updated, false)` which triggers the store). Does not call the store directly — reports upward via `onSave` callback.

**`src/components/ChatPanel.tsx`**
Central study workspace panel. Three inner tabs: Thread Tree (navigation), Chat (messages), Summary (page summaries). Renders `BreadcrumbTree` or `MillerColumnsTree` based on `treeViewMode` from `useAppStore`. Shows fork button on assistant messages, text selection context block, markdown + KaTeX message renderer, and persona bar with "Change" button (opens `SwitchPersonaModal`). Depends on `useChat`, `useAppStore`, and tree strategy components.

**`src/components/PdfViewer.tsx`**
Renders PDF pages using `react-pdf`. Tracks visible page via `IntersectionObserver` and reports to parent. Handles text selection (stores bounding box in `useAppStore`). Draws purple overlay markers for threads that exist on each page. Ctrl+wheel zoom. Depends on `useAppStore` for `textSelection` state.

**`src/components/PreFlightModal.tsx`**
Session start modal. Two modes: `from-doc` (document picked first → choose agent) or `from-persona` (agent picked first → choose document). Shows resume banner when a previous session exists for the same document. On confirm, calls `onStartSession(documentId, personaId)` in `App.tsx`. Reads `personas` from `useAppStore`.

**`src/components/SessionWrapUpModal.tsx`**
End-of-session memory compression modal. Lets user pick compression level (Deep / Thematic / Minimal) and write optional instructions. On save, `App.handleWrapUpSave` calls `saveSessionMemory(personaId, level, instructions)` in `useAppStore`, which appends a formatted block to `persona.systemPrompt`.

**`src/components/SwitchPersonaModal.tsx`**
Mid-session agent switch modal. Lists personal personas with mini cards. Optional "keep conversation context" toggle. On confirm, calls `onSwitch(newPersonaId, keepContext)` in `App.tsx`.

**`src/components/BreadcrumbTree.tsx` / `MillerColumnsTree.tsx`**
Interchangeable thread navigation strategy components. Both receive `threads[]`, `activeThread`, `onSelectThread`, `onCreateThread` as props. `BreadcrumbTree` shows the ancestor path plus sibling threads at each level. `MillerColumnsTree` shows cascading columns. Selected by user preference stored in `useAppStore`.

**`src/components/ResumeToast.tsx`**
Reads `showResumePrompt` from `useAppStore`. Shows a non-blocking toast once per app load if a previous session is stored in localStorage. Calls `dismissResumePrompt()` when dismissed or acted on.

**`src/components/FileUploadView.tsx`**
Drag-and-drop document upload panel. Controlled by `useDocuments`. Receives `onFileChange`, `onUpload`, `isUploading` props. No internal state beyond drag-over indicator.

**`src/components/DocumentPicker.tsx`**
Dropdown to select the active document from `userDocs[]`. Shows delete button per item. Receives `userDocs`, `documentId`, `onSelectDocument`, `onDeleteRequest` as props from `useDocuments`.

---

### Frontend — Layout

**`src/components/layout/AppLayout.tsx`**
Two-column shell: `Sidebar` (left) + main content area (right). Main area receives the current page as a child. Imported only by `App.tsx`.

**`src/components/layout/Sidebar.tsx`**
Navigation links (Library, Persona Hub, Gallery, Settings), resume session button, and logout. Reads auth state from `useAuth` and session state from `useAppStore`.

**`src/components/layout/MainWorkspace.tsx`**
Side-by-side layout: `PdfViewer` (left, resizable) + `ChatPanel` (right). Receives all PDF and chat props and fans them down. Rendered by `App.tsx` when a session is active.

**`src/components/layout/MyLibrary.tsx`**
Shows `userDocs[]` in a grid with upload zone. Handles open/delete/visibility-toggle per document. Calls `useDocuments` handlers. On document open, fires `onSelectDocument` which may open `PreFlightModal`.

**`src/components/layout/WorkspaceHeader.tsx`**
Top bar during a session. Shows document title, model tier selector (flash-lite / flash / pro), persona name, and "End Session" button. Writes `selectedModelTier` to `useAppStore`.

---

### Backend — Unified API (Port 8001)

**`backend/app/main.py`**
Single FastAPI entry point. Lifespan: enables pgvector extension, seeds canonical personas, reconciles orphaned upload files. Mounts all five routers plus `/uploads` StaticFiles. CORS from `config.py`.

**`backend/app/core/security.py`**
`verify_password`, `get_password_hash` (bcrypt), `create_access_token` (PyJWT). Reads `SECRET_KEY` and `ALGORITHM` from `config.py`. Imported by `auth.py`.

**`backend/app/schemas/schemas.py`**
All Pydantic request/response models: `UserCreate`, `UserResponse`, `MessageCreate`, `MessageResponse`, `ThreadCreate`, `ThreadResponse`, `DocumentResponse`, `VisibilityUpdate`, `PublicDocumentResponse`, `PageSummaryResponse`. Imported by all three new routers.

**`backend/app/api/routers/auth.py`**
Mounted at `/api/v1/auth`. Routes: `POST /register`, `POST /login`, `POST /guest-login`. Exports `get_current_user` FastAPI dependency (JWT decode → User row) — imported by `documents.py` and `threads.py`.

**`backend/app/api/routers/documents.py`**
Mounted at `/api/v1/documents`. Routes: `GET /` (user docs), `POST /` (upload + chunk + embed), `GET /public`, `DELETE /{id}`, `PATCH /{id}/visibility`, `POST /{id}/pages/{page}/summary`, `GET /{id}/summaries`. Depends on `get_current_user` and `document_service.py`.

**`backend/app/api/routers/threads.py`**
Mounted at `/api/v1/threads`. Routes: `GET /document/{doc_id}`, `GET /{id}`, `POST /`, `POST /{id}/messages`, `POST /{id}/fork`. Calls `get_full_thread_history` and `get_chat_response_for_thread` from `document_service.py`.

**`backend/app/api/routers/personas.py`**
Mounted at `/api/v1/personas`. Full Persona CRUD: `GET /`, `POST /`, `PUT /{id}`, `DELETE /{id}`, `POST /{id}/clone`, `POST /seed`. `PersonaResponse` is camelCase — matches frontend `Persona` interface directly.

**`backend/app/api/routers/chat.py`**
Mounted at `/api/v1/chat`. Standalone AI chat (no PDF). Uses `google-genai` SDK, `prompt_builder.resolve_system_prompt`, and `model_router.resolve_alias`.

**`backend/app/services/document_service.py`**
Migrated from legacy `services.py`. Functions: `ask_gemini`, `get_smart_model`/`get_fast_model`, `get_embedding_model`, `extract_text_from_pdf`, `split_text_into_chunks`, `generate_document_summary`, `generate_specific_page_summary`, `find_relevant_chunks`, `get_full_thread_history` (Python walk + SQL CTE hybrid), `get_chat_response_for_thread`, `generate_thread_metadata_background`, `compose_system_prompt` (legacy trait builder — kept for backward compat). Uses `app.models.domain` imports and `resolve_system_prompt` from `prompt_builder`.

**`backend/app/services/prompt_builder.py`**
Priority: `Persona.system_prompt` → `manual_prompt_override` → default. Appends all `SessionMemory` entries in chronological order so learning from past sessions carries forward.

**`backend/app/services/model_router.py`**
`MODEL_MANIFEST` alias registry (DUST/SPARK/BREEZE/VOLT/ATLAS/INDEX). `route_llm_request(task_type, tier)` returns a model string. `resolve_alias` returns the alias string for DB storage.

**`backend/app/models/domain.py`**
Single source of truth for all ORM models. `User`, `Document`, `Thread`, `Message`, `Chunk`, `PageSummary`, `Persona` (with `persona_type`, `system_prompt`, `original_persona_id`), `StudySession`, `SessionMemory`, `LectureVideo`, `VideoSyncIndex`. Alembic autogenerates migrations from this file.

**`backend/app/core/database.py`**
SQLAlchemy engine (`pool_pre_ping=True`), `SessionLocal`, `Base`, and `get_db()` dependency. All routers import `get_db` from here.

---

## 5. Core Data Flows

### A. Starting a Session (from-doc path)
```
User clicks document in MyLibrary
→ PreFlightModal opens (mode='from-doc')
→ User selects a persona and clicks Start
→ App.handleStartSession(documentId, personaId) fires
→ If persona.type !== 'personal':
    clonePersona(personaId)
    → POST /api/v1/personas/{id}/clone
    → Backend creates Persona row (personal fork, new ID)
    → Returns saved clone; Zustand store updated
    personaId = clone.id
→ setActiveSession({documentId, personaId}) — written to localStorage
→ View switches to MainWorkspace
→ useChat fetches threads for documentId
```

### B. Creating / Editing a Persona
```
User opens PersonaEditor, edits fields, clicks Save
→ onSave(updated, transient=false) fires in PersonaLab.handleEditorSave
→ mode='clone':  createPersona(updated)
    → POST /api/v1/personas  (body: snake_case fields)
    → Backend inserts row, returns PersonaResponse
    → Zustand: temp ID swapped for real DB ID; activeSession patched
→ mode='edit':  updatePersona(updated.id, updated)
    → PUT /api/v1/personas/{id}  (body: only changed fields)
    → Backend updates row, returns PersonaResponse
    → Zustand: personas[] entry replaced with fresh server copy
→ editorState set to null (editor closes)
```

### C. Session Wrap-Up (memory compression)
```
User clicks End Session in WorkspaceHeader
→ SessionWrapUpModal opens
→ User picks compression level + writes instructions → Save
→ App.handleWrapUpSave(level, instructions)
→ saveSessionMemory(personaId, level, instructions) in useAppStore
    → Appends formatted memory block to persona.systemPrompt (local only)
    → NOTE: does not persist to DB — updatePersona should be called here (future work)
→ clearActiveSession() — removes from store + localStorage
→ View returns to MyLibrary
```

### D. Text Selection → Chat
```
User selects text on PDF page
→ onMouseUp stores {text, x, y, width, height} in useAppStore.textSelection
→ Floating action overlay appears
→ User clicks Explain / Quiz / Chat
→ useChat.handleQuickAction(type) pre-fills prompt with selection context
→ handleCreateThread() called
    → POST /api/v1/threads/  (selected_text, coordinates, page_number)
    → POST /api/v1/threads/{id}/messages (initial message)
→ Thread added to tree; ChatPanel switches to Chat tab
→ LLM response streamed back
```

---

## 6. Key Architectural Decisions & Constraints

| Decision | Reason |
|---|---|
| ~~Dual backends~~ → Single backend on 8001 | Phase 1 consolidation complete; legacy main/models/schemas/services.py deleted |
| String PKs for Persona | Allows seeding with human-readable IDs (`global_socratic_mentor`) |
| camelCase in PersonaResponse | Frontend uses the JSON directly without transformation |
| Optimistic clone flow | `clonePersona()` must complete before session starts to avoid FK violations |
| `activeSession` in localStorage | Survives page reload; validated against DB on `fetchPersonas` |
| `saveSessionMemory` is local-only | Memory is appended to Zustand state but not yet PUT to DB on wrap-up |
| `SessionMemory.persona_id` is NOT NULL | Hard-delete required before persona delete (cannot null-out the FK) |
| Nginx routes `/api/`, `/uploads/`, `/health` to `backend:8001` | Single proxy target; frontend JS bundle never contains internal hostnames |
| `VITE_AI_API_URL=https://ai-study-agent.com` in production | Domain-root base URL + hardcoded `/api/v1/` paths = no per-env path config |
| `docker-compose.yml` has 3 services only | `db` + `backend` (port 8001) + `frontend` (Nginx); legacy port-8000 service removed |
