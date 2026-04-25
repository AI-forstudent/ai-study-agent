# Architecture Patterns

Established patterns that should be followed for all new code in this project.

---

## Backend Patterns

### 1. All Gemini calls go through `ask_gemini()`
Every AI call in `services.py` uses the unified `ask_gemini(prompt, use_smart_model)` function.
- `use_smart_model=True` → `gemini-2.5-flash-lite` at temperature 0.3 (summaries, structured output)
- `use_smart_model=False` → same model at temperature 0.5 (chat responses)
- Never call `llm.invoke()` directly outside this function.

### 2. Persona prompt assembly via `compose_system_prompt`
Do not inline persona logic in route handlers or other service functions.
```python
system_prompt = compose_system_prompt(active_persona_id, db)
# Priority: manual_prompt_override → TRAIT_LIBRARY build → _DEFAULT_SYSTEM_PROMPT
```

### 3. Thread history: hybrid Python/SQL CTE
- Shallow trees (≤3 levels): `get_thread_history_python`
- Deep trees: automatic fallback to `get_thread_history_sql` (recursive CTE)
- Entry point is always `get_full_thread_history` — never call the inner functions directly.

### 4. Circular FK handling on deletion
Before deleting a Document, null out `Thread.forked_from_message_id` and `Thread.parent_thread_id`
to avoid FK violation cascades. See `delete_document` in `main.py`.

### 5. Alembic migration rules
- Column **renames**: always write manually with `op.alter_column(..., new_column_name=...)` — `autogenerate` treats renames as drop+add (data loss).
- New `nullable=False` columns on tables with existing rows: always include `server_default` in the migration.
- New migration files go in `backend/alembic/versions/` which is volume-mounted — no `docker cp` needed.

---

## Frontend Patterns

### 6. Hook-based state separation
State is separated by domain into custom hooks. Each hook is the single owner of its state:

| Domain | Hook | Key rule |
|--------|------|----------|
| Auth & view routing | `useAuth` | Only source of `isAuthenticated` and `view` |
| Document lifecycle | `useDocuments` | Only place that calls `api.uploadDocument`, `api.deleteDocument`, `api.getFile` |
| Conversation tree | `useChat` | Only place that calls `api.getThreads`, `api.createThread`, `api.sendMessage`, `api.forkThread` |

### 7. Zustand for cross-hook global state
`textSelection` and `activeThread` live in `useAppStore` and are accessed directly by hooks.
Do not prop-drill these through App.tsx → hook chains.

```ts
// Correct: hook reads from store directly
const { textSelection, setTextSelection, setActiveThread } = useAppStore();

// Wrong: passing setActiveThread as a parameter from App.tsx to a hook
```

### 8. Thread lifecycle ownership
`useChat`'s `useEffect([documentId])` is the single owner of thread clear + refetch.
```ts
useEffect(() => {
  setThreads([]);
  if (documentId) api.getThreads(documentId).then(res => setThreads(res.data));
}, [documentId]);
```
Changing `documentId` in `useDocuments` automatically triggers this. Never manually call `setThreads([])` from `useDocuments` or route handlers.

### 9. Layout state stays in layout components
`scale`, `chatWidth`, `isDragging`, `pdfContainerRef`, and `handleTextSelection` live in `MainWorkspace.tsx`.
These are pure layout concerns and should not be lifted to App.tsx or hooks.

### 10. API client
All HTTP calls go through the `api` object in `src/services/api.ts`.
The Axios interceptor automatically attaches the JWT from `localStorage`.
Never call `axios` directly; always add new endpoints to the `api` object.

---

---

## QA & Testing Strategy

### The Three-Layer QA Pyramid

```
        ┌──────────────┐
        │  E2E Tests   │  ← Playwright  (tests/e2e/)
        │  (few, slow) │     Full browser, real stack running
        ├──────────────┤
        │  Frontend    │  ← Vitest  (ai-study-client/src/tests/)
        │  Unit Tests  │     Hooks, utils, API client (mocked Axios)
        ├──────────────┤
        │  Backend     │  ← Pytest  (backend/tests/)
        │  Unit Tests  │     Pure functions: JWT, bcrypt, services
        └──────────────┘     No DB required for unit tier
```

### Pytest (Backend)

**Tool:** `pytest` via `uv run pytest` — no separate install needed.

**Two tiers of test:**
- **Unit** (default): pure-function tests with no DB dependency. Run anywhere.
- **Integration** (opt-in with `--run-integration`): tests that hit a real PostgreSQL + pgvector DB. Never run in CI unless a test-DB service is available.

**Key conventions:**
- Test classes are grouped by module: `TestPasswordHashing`, `TestJWTCreation`, `TestRegressions`.
- Regression tests go in a dedicated `TestRegressions` class with a comment linking to the bug ID in `active_tracker.md`.
- `conftest.py` sets env defaults before any app module imports so tests never fail due to missing `.env`.
- Never use SQLite as a pgvector substitute — the `Vector` type has no SQLite equivalent. Use mocks or a real DB.

### Vitest (Frontend)

**Tool:** Vitest — Vite-native, zero-config when using a Vite project.  
**Setup:** `npm install -D vitest @vitest/ui` + `"test": "vitest"` in `package.json`.

**What to test:**
- Token storage/retrieval logic (localStorage utilities)
- Zustand store action purity (state transitions without side effects)
- `api.ts` functions — mock Axios with `vi.mock('axios')`, verify correct endpoint + payload shape
- Hook logic in isolation using `@testing-library/react-hooks`

**What not to test:** Full component renders (that's the E2E layer's job). Avoid snapshot tests — they are brittle and carry no semantic value.

### Playwright (E2E)

**Tool:** `@playwright/test` — Chromium by default; add Firefox/WebKit for cross-browser.  
**Run command:** `npx playwright test tests/e2e/`  
**Prerequisite:** Full Docker stack must be running (`docker compose up`). Set `PLAYWRIGHT_BASE_URL` to override the default `http://localhost:5173`.

**What to test:** Complete user flows end-to-end — guest login, registration, document upload, session start. One happy-path test + key error states per feature.

**Selector strategy:** Prefer `getByRole` and `getByPlaceholder` over CSS selectors — they survive component refactors and are more accessible.

### Running All Layers

```bash
./run_tests.sh           # all three layers in sequence
./run_tests.sh unit      # backend unit only (fast, no dependencies)
./run_tests.sh frontend  # Vitest only
./run_tests.sh e2e       # Playwright only (stack must be running)
```

---

## Color / Design Conventions

| Context | Palette |
|---------|---------|
| Primary actions | `blue-600` |
| Page summaries | `purple-600` / `purple-50` |
| Persona Lab | `indigo-600` / `violet-600` gradient |
| Warnings / cost | `amber-500` |
| Success | `emerald-500` |
| Destructive | `red-500` |
| Background | `slate-50` |
| Cards | `white` + `border-slate-200` |

All new views use `rounded-xl` / `rounded-2xl` cards, `shadow-sm`, and RTL (`dir="rtl"`) for Hebrew UI, LTR for English-only views (e.g., Persona Lab).
