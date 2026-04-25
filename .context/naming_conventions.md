# StudyAgent — Naming Conventions

This file is the shared vocabulary contract across the entire codebase
(backend Python, frontend TypeScript, prompts, migrations, and docs).
When a name changes here it must change everywhere simultaneously.

---

## General Rules

| Layer | Convention | Example |
|-------|------------|---------|
| Python functions / variables | `snake_case` | `get_persona_by_id` |
| Python classes | `PascalCase` | `StudySession` |
| TypeScript variables / functions | `camelCase` | `fetchPersonas` |
| TypeScript components / types | `PascalCase` | `PersonaCard` |
| Database tables | `snake_case` (plural) | `study_sessions` |
| Database columns | `snake_case` | `created_at` |
| API routes | `kebab-case` | `/api/v1/chat-sessions` |
| Environment variables | `SCREAMING_SNAKE_CASE` | `GOOGLE_API_KEY` |

---

## AI Model Manifest

All callers **must** use these internal aliases — never hard-code a Google
model string in business logic.  The canonical mapping lives in
`backend/app/services/model_router.py → MODEL_MANIFEST`.

| Alias | Google Model String | Intended Use |
|-------|--------------------|------------------------------------|
| `DUST` | `gemini-2.0-flash-lite` | Ultra-cheap side tasks (metadata gen, emoji, quick classify) |
| `SPARK` | `gemini-2.5-flash-lite` | Page summaries, memory compression |
| `BREEZE` | `gemini-2.0-flash` | Backup / fallback when primary model is unavailable |
| `VOLT` | `gemini-2.5-flash` | Main balanced chat interactions |
| `ATLAS` | `gemini-2.5-pro` | Complex document reasoning, deep analysis |
| `INDEX` | `gemini-embedding` | RAG vector search (embedding generation) |

### Usage pattern (Python)

```python
from app.services.model_router import route_llm_request, get_model_for_alias

# Resolve by task (preferred — uses smart defaults)
model = route_llm_request("chat")            # → "gemini-2.5-flash"  (VOLT)
model = route_llm_request("summary")         # → "gemini-2.5-flash-lite" (SPARK)
model = route_llm_request("chat", "pro")     # → "gemini-2.5-pro"  (ATLAS, user override)

# Resolve by alias (explicit)
model = get_model_for_alias("DUST")          # → "gemini-2.0-flash-lite"
```

### Task → Default alias mapping

| task_type string | Default alias |
|------------------|---------------|
| `"chat"` | `VOLT` |
| `"summary"`, `"page_summary"` | `SPARK` |
| `"memory"` | `SPARK` |
| `"background"` | `DUST` |
| `"embed"` | `INDEX` |
| `"deep_analysis"` | `ATLAS` |

---

## Route Namespace

| Prefix | Owner |
|--------|-------|
| `/api/v1/personas` | Grand Vision API (port 8001) |
| `/api/v1/chat` | Grand Vision API (port 8001) |
| `/documents`, `/threads`, `/login` | Legacy API (port 8000) |

---

## Key Domain Terms

| Term | Definition |
|------|------------|
| **Persona** | An AI character with a `system_prompt` that shapes model behaviour |
| **Thread** | A single branch of a conversation (may have `parent_thread_id` for forking) |
| **StudySession** | A bounded session: one user + one persona + optional document |
| **SessionMemory** | A persisted memory entry appended to a persona after a session ends |
| **Chunk** | A vector-embedded text fragment from a PDF page |
| **PageSummary** | LLM-generated summary cached per document page |
