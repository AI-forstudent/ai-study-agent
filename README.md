# AI Study Partner

*A web app where students study PDFs, code, lectures, and exams alongside conversational AI tutors.*

![React](https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![FastAPI](https://img.shields.io/badge/FastAPI-0.128+-005571?style=for-the-badge&logo=fastapi)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![pgvector](https://img.shields.io/badge/pgvector-768d-4169E1?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

## Overview

Upload a document, pick or clone an AI **Persona** (Socratic mentor, course TA, concise explainer, …), and chat in a thread tree anchored to specific pages and selected text. Conversations can be **forked** like git branches, so deep dives never lose the original learning thread. Session memory can be compressed at wrap-up and written back into the persona's system prompt so the agent remembers the student across sessions.

The platform is organised top-down as **Organization → Community → Course → Lecture / Exam / Folder / Session**, with capability-based permissions (Phase 1 of the multi-tenancy plan shipped — see [`docs/plans/multi_tenancy.md`](docs/plans/multi_tenancy.md)).

For deep architectural detail (single source of truth), see **[`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md)**.
For what is currently in flight or awaiting user verification, see **[`docs/active_tracker.md`](docs/active_tracker.md)**.

## Key Features

- **Contextual document interactions** — Highlight any text in a PDF / DOCX / PPTX / source-code file to trigger smart prompts (Explain, Quiz, Translate, Find bugs, Refactor) or open an anchored chat thread. Office formats are converted to PDF server-side via LibreOffice headless.
- **Thread forking** — Branch a conversation from any message. Visualise the tree via three interchangeable strategies (Miller Columns, Node Graph, Breadcrumbs).
- **Multi-provider LLM** — OpenAI (ChatGPT), Anthropic (Claude), or Google Gemini per request, with automatic Gemini fallback when a provider key is absent. Tier selector (Fast / Balanced / Deep) maps to the right model per provider.
- **Persona system** — Seeded global personas + cloneable community personas + full CRUD on personal personas. Authoritative ownership via `Persona.author_id`.
- **Courses** — Public / admin-assigned / private courses, public catalog with starring, course-scoped chat that grounds answers in the course's cached syllabus extraction. Syllabus is extracted **once** per attach (topics, lecturers, weekly breakdown, …) and reused on every turn.
- **Exams** — Upload past papers; an async three-pass pipeline extracts questions, embeds + tags them against the course's evolving taxonomy, and computes a no-LLM difficulty score per question-type cluster. Stats header with question-type / topic / difficulty visualisations.
- **Lectures** — Per-course Lecture entity with manual lecturer summary, peer student summaries, optional audio recording + notes attachment, and a **unified AI summary** generated asynchronously (locked Hebrew skill spec; six-input contract). Lecture-scoped chat is grounded in the unified summary.
- **Personal Hub** — User profile, course-history records, job applications, and BGU-style transcript PDF parsing (`pdfplumber` + `python-bidi` for Hebrew RTL).
- **Drive-style library** — Two-level workspace: Courses / Folders above a Files lane, per-folder default tutor, optimistic star toggles.
- **Auth** — JWT + bcrypt, Google Sign-In (Google Identity Services), and unique-per-call Guest mode for portfolio reviewers.
- **Content-Addressable Storage** — A file is hashed, stored, and embedded **once** regardless of how many users upload it. See [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) §7.
- **Token-usage tracking** — Per-call cost metering routed through `services/usage_logger`; Settings shows quota bar + per-provider mini-cards + recent calls; admin users table carries 24h and lifetime spend columns.
- **Responsive** — Phone / tablet / desktop reflow with iOS-zoom guard, safe-area-inset support, drawer sidebar below `lg`, in-session sidebar collapse.

## Tech Stack

**Frontend** ([`ai-study-client/`](ai-study-client/))
- React 19 + TypeScript + Vite 7
- TailwindCSS 3.4 (+ `@tailwindcss/typography`)
- Zustand 5 (`useAppStore`)
- Axios with JWT interceptor
- `react-pdf` (PDF) · `@monaco-editor/react` (code) · `react-markdown` + `remark-math` + `rehype-katex` (AI output)
- `lucide-react` for icons

**Backend** ([`backend/`](backend/))
- Python 3.13 + FastAPI 0.128+
- PostgreSQL 16 + pgvector (768-dim embeddings)
- SQLAlchemy 2.0 + Alembic
- LLM SDKs: `google-genai`, `openai`, `anthropic`
- `langchain-google-genai` (Gemini binding) + `langchain-text-splitters` (chunking only — not a full LangChain pipeline)
- `pdfplumber` + `python-bidi` + `python-docx` for document extraction
- LibreOffice headless (Docker only) for DOCX/PPTX → PDF
- PyJWT + bcrypt + `google-auth` (Google ID token verification)
- `uv` for dependency management

**Infrastructure**
- Docker Compose — 3-file architecture: `docker-compose.yml` (base) + `docker-compose.override.yml` (dev, git-ignored) + `docker-compose.prod.yml` (prod)
- Nginx reverse proxy (routes `/api/*`, `/uploads/*`, `/health` to `backend:8001`)
- Cloudflare Full (Strict) SSL + Let's Encrypt host-level certs
- GitHub Actions auto-deploy (runs `alembic upgrade head` on each prod release)

## Getting Started — Docker (recommended)

Three containers (DB, backend, frontend) start together with one command.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose plugin
- A Google Gemini API key — free at <https://aistudio.google.com/apikey>
- *(Optional)* OpenAI and/or Anthropic API keys to enable ChatGPT / Claude providers — Gemini is the fallback otherwise

### Steps

```bash
# 1. Clone the repo
git clone <your-repo-url> ai-study-agent
cd ai-study-agent

# 2. Create the .env file in the project root
cat > .env <<'EOF'
GOOGLE_API_KEY=paste-your-gemini-key
OPENAI_API_KEY=                                 # optional — enables ChatGPT
ANTHROPIC_API_KEY=                              # optional — enables Claude
GOOGLE_OAUTH_CLIENT_ID=                         # optional — enables Google Sign-In
SECRET_KEY=$(openssl rand -hex 32)
ALLOWED_ORIGINS=http://localhost,http://localhost:5173
EOF

# 3. Build and start everything
docker compose up --build

# 4. (First boot only) apply DB migrations in another terminal
docker exec -it ai_study_backend uv run alembic upgrade head
```

- Frontend: <http://localhost>
- Backend API docs: <http://localhost:8001/docs>
- Postgres (host-mapped): `localhost:5433`

## Local Development Without Docker

Useful when you want host-level hot reload.

### Prerequisites

- Node.js v18+
- Python 3.13+
- `uv` (`pip install uv`)
- PostgreSQL 16 with the `vector` extension installed

### Backend

```bash
cd backend

uv sync

cat > .env <<'EOF'
GOOGLE_API_KEY=paste-your-gemini-key
DATABASE_URL=postgresql://user:password@localhost:5432/app_db
SECRET_KEY=replace-with-a-long-random-string
EOF

uv run alembic upgrade head
uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### Frontend

```bash
cd ai-study-client

npm install
echo 'VITE_AI_API_URL=http://localhost:8001' > .env.local
npm run dev
```

Open <http://localhost:5173>.

## Common Commands

| Action | Command |
|---|---|
| Backend dev (UV) | `cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload` |
| Frontend dev (Vite) | `cd ai-study-client && npm run dev` |
| Full stack (Docker) | `docker compose up --build` |
| Apply migrations | `docker exec -it ai_study_backend uv run alembic upgrade head` |
| Generate migration | `docker exec -it ai_study_backend uv run alembic revision --autogenerate -m "describe change"` |
| Backend tests | `cd backend && uv run pytest` |
| Frontend tests | `cd ai-study-client && npm test` |
| E2E tests | `./run_tests.sh` |

## Production Deployment

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker exec -it ai_study_backend uv run alembic upgrade head
```

In practice deploys are triggered by GitHub Actions — see `.github/workflows/`. The action SSHes into the host, pulls, runs the compose stack, and applies migrations. Update `nginx.conf` and `docker-compose.prod.yml` with your real domain. SSL / Cloudflare / Certbot setup is documented in [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) §10 (ADR 9).

## Further Reading

- [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) — Single source of truth: file index, data flows, ADRs, hard constraints.
- [`docs/active_tracker.md`](docs/active_tracker.md) — In-flight features, awaiting-confirmation bugs, known tech debt.
- [`docs/vision.md`](docs/vision.md) — Long-term vision, marketplace plans, Personal Meta-Data Namespace.
- [`docs/plans/multi_tenancy.md`](docs/plans/multi_tenancy.md) — Locked multi-tenancy / permissions plan.
- [`CLAUDE.md`](CLAUDE.md) — Coding-agent directives (Claude Code + Gemini CLI).
- [`CHANGES.md`](CHANGES.md) — Structural changes to docs and config.
