# Project Map

## Backend (`/backend`)

| File | Responsibility |
|------|---------------|
| `main.py` | FastAPI app, lifespan (file-system reconciliation), all route definitions |
| `models.py` | SQLAlchemy ORM models: User, Document, Thread, Message, Chunk, PageSummary, Persona |
| `schemas.py` | Pydantic request/response shapes |
| `services.py` | All AI logic: `ask_gemini`, `compose_system_prompt`, `TRAIT_LIBRARY`, RAG, thread history (hybrid Python/SQL CTE), PDF extraction |
| `app/core/database.py` | SQLAlchemy engine + `get_db` dependency |
| `app/core/security.py` | Password hashing, JWT creation |
| `alembic/` | DB migrations — versions are volume-mounted into Docker |

### Key DB Schema Facts
- `Persona.manual_prompt_override` — if set, bypasses trait builder entirely.
- `Persona.traits` — JSONB `{pedagogy, style, tone, language}` — drives `compose_system_prompt`.
- `Document.is_public` + `Document.shared_at` — community sharing fields (UI not yet built).
- `Thread.forked_from_message_id` uses `use_alter=True` FK to break circular dependency with `Message`.
- `Chunk.embedding` — `Vector(768)` via pgvector.

### Critical Logic Paths
1. **Prompt assembly:** `get_chat_response_for_thread` → `compose_system_prompt` → `TRAIT_LIBRARY` → structured system prompt injected into Gemini call.
2. **Thread forking:** `POST /threads/{id}/fork/` creates a child thread; `get_full_thread_history` walks the tree via hybrid Python/SQL CTE.
3. **RAG:** `find_relevant_chunks` embeds the query, runs cosine distance via pgvector, injects top-3 chunks into context.
4. **Startup reconciliation:** Lifespan deletes orphaned files in `uploads/` not referenced in the DB.

---

## Frontend (`/ai-study-client/src`)

### Entry & Routing
| File | Responsibility |
|------|---------------|
| `App.tsx` | Thin orchestrator (~60 lines). Composes hooks, routes between AuthView / PersonaLab / main shell. |
| `main.tsx` | Vite entry, React root |

### Hooks (`src/hooks/`)
| File | Owns |
|------|------|
| `useAuth.ts` | `isAuthenticated`, `view`, startup health check |
| `useDocuments.ts` | `file`, `documentId`, `numPages`, `currentPage`, `userDocs`, upload/select/delete handlers |
| `useChat.ts` | `threads`, messages, fork, quick/smart actions. Clears+refetches threads on `documentId` change. |

### Layout Components (`src/components/layout/`)
| File | Owns |
|------|------|
| `Header.tsx` | Logo, DocumentPicker, tree-view selector, Persona Lab button, logout. Zero state. |
| `MainWorkspace.tsx` | `scale`, `chatWidth`, `isDragging`, `pdfContainerRef`, `handleTextSelection`. Renders PdfViewer + drag divider + ChatPanel. |

### Feature Components (`src/components/`)
| File | Responsibility |
|------|---------------|
| `PersonaLab.tsx` | Full-page persona builder: trait grid, name input, 4-step synthesis animation, success/error states |
| `ChatPanel.tsx` | Thread tree (Miller/Breadcrumb/Graph), active chat, page summary tab |
| `PdfViewer.tsx` | react-pdf viewer, page navigation, zoom, text-selection overlay, thread markers |
| `FileUploadView.tsx` | Upload drop zone + global summary toggle |
| `AuthView.tsx` | Login / register / guest login |
| `DocumentPicker.tsx` | Dropdown to switch active document |
| `ConfirmModal.tsx` | Generic confirmation dialog (used for document deletion) |

### Global State
| File | Owns |
|------|------|
| `store/useAppStore.ts` | `textSelection`, `activeThread`, `setTextSelection`, `setActiveThread`, `clearSelection` — Zustand, accessed directly by hooks |
| `types/index.ts` | `Message`, `Thread` TypeScript interfaces |
| `services/api.ts` | Axios client with JWT interceptor. All API calls live here. |

---

## Infrastructure

| File | Responsibility |
|------|---------------|
| `docker-compose.yml` | Orchestrates db (pgvector/pg16), backend (FastAPI), frontend (React+Nginx). Volumes: `uploads/`, `alembic/versions/`, `letsencrypt/` |
| `Dockerfile.backend` | Python 3.13 + UV, copies backend source |
| `Dockerfile.frontend` | Node build + Nginx serve |
| `nginx.conf` (in frontend image) | Reverse proxy: `/api/*` → backend:8000, static files served directly |

---

## QA / Testing

### Backend (`backend/tests/`) — Pytest
| File | What it tests |
|------|---------------|
| `conftest.py` | Env defaults, `--run-integration` flag, integration test skip marker |
| `test_auth_logic.py` | `get_password_hash`, `verify_password`, `create_access_token` — pure unit tests, no DB |

**Run:** `cd backend && uv run pytest tests/ -v`  
**With integration tests:** add `--run-integration` (requires live PostgreSQL + pgvector)

### Frontend (`ai-study-client/src/tests/`) — Vitest
| File | What it tests |
|------|---------------|
| `api.test.ts` | `localStorage` token storage/retrieval, Axios client patterns |

**Run:** `cd ai-study-client && npm test -- --run`  
**Setup needed:** `npm install -D vitest @vitest/ui`; add `"test": "vitest"` to `package.json` scripts.

### E2E (`tests/e2e/`) — Playwright
| File | What it tests |
|------|---------------|
| `auth.spec.ts` | Guest login, user registration, wrong-credentials error, duplicate-email rejection |

**Run:** `npx playwright test tests/e2e/`  
**Setup needed:** `npm install -D @playwright/test && npx playwright install chromium`  
**Requires:** Full stack running via `docker compose up`.

### One-line runner
`./run_tests.sh [unit|integration|frontend|e2e|all]`

---

## Legacy
- Local LM Studio integration exists only in side-branches. Never merge to `main`.
- `estimate-summary` endpoint and `count_tokens_in_text` were removed in Phase 1.
