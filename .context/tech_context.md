# Tech Context

## Backend Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Runtime | Python 3.13 | Managed with UV |
| Framework | FastAPI | Async-capable; lifespan used for startup reconciliation |
| ORM | SQLAlchemy 2.x | Declarative models; JSONB via `sqlalchemy.dialects.postgresql` |
| DB | PostgreSQL 16 (pgvector image) | `pgvector` extension for 768-dim cosine similarity search |
| Migrations | Alembic | `autogenerate` for schema additions; manual for renames |
| AI | `langchain-google-genai` | `ChatGoogleGenerativeAI` + `GoogleGenerativeAIEmbeddings` |
| Model | `gemini-2.5-flash-lite` | Chat + embeddings. Embeddings at 768 dims via `output_dimensionality=768` |
| Embedding model | `models/gemini-embedding-001` | Task type `retrieval_document` |
| PDF | `pdfplumber` | Text extraction page-by-page |
| Chunking | `langchain_text_splitters.RecursiveCharacterTextSplitter` | 1000 chars, 200 overlap |
| Auth | JWT (HS256) + bcrypt | `python-jose` / `passlib`; token via `OAuth2PasswordBearer` |

## Frontend Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Framework | React 18 + TypeScript | Strict mode |
| Build | Vite 7 | `?url` import for PDF worker |
| Styling | TailwindCSS | Utility-first; no CSS modules |
| State | Zustand | Global: `textSelection`, `activeThread` only. Local state in hooks. |
| HTTP | Axios | Single `apiClient` instance with JWT interceptor |
| PDF | `react-pdf` + `pdfjs-dist` | Worker loaded via Vite URL import |
| Math rendering | KaTeX via `rehype-katex` + `remark-math` | Applied in ChatPanel message renderer |
| Markdown | `react-markdown` + `remark-gfm` | Tables, lists, headings in AI responses |
| Icons | `lucide-react` | All icons from this library only |

## Infrastructure

| Component | Details |
|-----------|---------|
| Hosting | AWS (EC2 or similar) |
| Reverse proxy | Nginx — routes `/api/*` to FastAPI:8000, serves React static files |
| TLS | Let's Encrypt — certs mounted at `/etc/letsencrypt` |
| Container orchestration | `docker-compose` — three services: `db`, `backend`, `frontend` |
| DB persistence | Docker named volume `pgdata` |
| File persistence | `./backend/uploads` bind-mounted to `/app/uploads` |
| Migration sync | `./backend/alembic/versions` bind-mounted to `/app/alembic/versions` |

## Environment Variables

| Variable | Used in | Purpose |
|----------|---------|---------|
| `GOOGLE_API_KEY` | backend | Gemini API authentication |
| `DATABASE_URL` | backend | `postgresql://user:password@db:5432/app_db` |
| `ALLOWED_ORIGINS` | backend | CORS whitelist (comma-separated) |
| `VITE_API_URL` | frontend build arg | Base URL for Axios client (defaults to `http://127.0.0.1:8000`) |
| `SECRET_KEY` | backend | JWT signing secret |

## Key Version Constraints
- PostgreSQL must be the `pgvector/pgvector:pg16` image — standard pg16 lacks the vector extension.
- Embedding dimensions are fixed at **768** across the entire stack (model output, DB column, query embedding). Changing this requires a full re-embedding of all chunks.
- `gemini-2.5-flash-lite` model ID is the current correct identifier. Do not use `gemini-flash` or older aliases.
