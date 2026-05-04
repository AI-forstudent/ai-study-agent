# Backend — Local Directives

> Read `../CLAUDE.md` first. This file adds backend-specific rules.

## Stack quick reference

- **Python 3.13** + **FastAPI 0.128+**
- **PostgreSQL 16 + pgvector** (vectors stored as `Vector(768)`)
- **SQLAlchemy 2.0** ORM (use the 2.0 style — `select()`, `session.execute()`, not legacy `query()`)
- **Alembic** for all migrations — never modify the schema by hand
- **`uv`** for dependency management — never use `pip install` directly
- **`google-genai` SDK + `langchain-google-genai`** — all LLM calls route through `app.services.genai_client`

## Mandatory paths

- **Models:** `app/models/domain.py` (single file, all SQLAlchemy models)
- **Schemas:** `app/schemas/` (Pydantic v2)
- **Routers:** `app/api/routers/` (one file per resource — auth, chat, documents, threads, personas, folders, personal_hub)
- **Services:** `app/services/` (business logic, not API code)
- **Seeds:** `app/db/seeds/`

## Conventions

- **All new endpoints** go under `/api/v1/<resource>` and live in their own router file.
- **All routes** must use `Depends(get_current_user)` for auth unless explicitly public (showcase/guest mode).
- **All DB sessions** use `Depends(get_db)` — never construct a Session manually inside a route.
- **Field names:** `snake_case` always. The one exception is `PersonaResponse` which uses `camelCase` to match the frontend `Persona` type — do not "fix" this; it is intentional (see `SYSTEM_ARCHITECTURE.md` §12).
- **Migrations:** every model change requires a new Alembic revision with a descriptive name. Never edit a previously-applied migration; create a new one.
- **CAS uploads:** uploads go through the multi-tenant Content-Addressable Storage flow described in `SYSTEM_ARCHITECTURE.md` §7. Do not bypass it.

## Testing

- Use `backend/tests/conftest.py` fixtures — don't reinvent test setup.
- For DB tests, use the in-memory test session, not the real Postgres.
- New router file → new test file mirroring the path: `tests/test_<router>_api.py`.

## Common gotchas

- `psycopg2-binary` is the driver, not `psycopg3`. Connection strings use `postgresql://` not `postgresql+psycopg://`.
- `pdfplumber` extracts Hebrew RTL text in **visual order** (reversed). Always pipe through `python_bidi.get_display()` before sending to Gemini. See `B-003` in the active tracker for the full bug history.
- `pgvector` distance operators in SQLAlchemy: use `Vector(768)` column type from `pgvector.sqlalchemy`. Cosine distance is `<=>`, L2 is `<->`.
- Circular FKs (thread fork parent ↔ child) require `use_alter=True` on the relationship — see existing thread model for the pattern.
