# 🧠 AI Study Partner

*Your Ultimate Intelligent Learning Assistant, powered by Generative AI and RAG.*

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Gemini](https://img.shields.io/badge/Google%20Gemini-8E75B2?style=for-the-badge&logo=google%20gemini&logoColor=white)

## 📖 Overview

**AI Study Partner** is a full-stack, AI-driven educational platform. Users upload PDF/DOCX/code documents, highlight specific text, and instantly open localized chat threads with an AI tutor.

The system uses Retrieval-Augmented Generation (RAG) over `pgvector`-stored embeddings, a configurable Persona system for AI tutor personalities, and a Hybrid Cloud + (planned) Local AI architecture for cost optimization.

For deep architectural detail, see **[`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md)**.

## ✨ Key Features

* **📝 Contextual Document Interactions** — Highlight any text in a PDF / DOCX / source-code file to trigger smart prompts (Translate, Explain, Quiz) or start an anchored chat thread.
* **🌳 Advanced Thread Management** — Fork conversations into new branches. Visualize history via three interchangeable strategies (Miller Columns, Node Graph, Breadcrumbs).
* **🤖 Persona System** — Pre-built tutors (Socratic Mentor, BGU TAs, Concise Explainer) plus full clone/edit/CRUD. Per-persona Session Memory carries learnings across sessions.
* **🪙 Token-Optimized Page Summaries** — Lazy-loaded, user-approved, persisted to PostgreSQL.
* **📁 Folders / Courses** — Drive-style two-level workspace with per-folder default personas.
* **🔐 Auth + Showcase Mode** — JWT + bcrypt with one-click guest demo for portfolio reviewers.
* **♻️ Garbage Collection** — Automatic cleanup of orphaned files at startup.

## 🛠️ Tech Stack

**Frontend (`ai-study-client/`)**
* React 19 + TypeScript + Vite
* Tailwind CSS + Lucide React
* React-PDF (PDF rendering) + Monaco (code rendering)
* Zustand (state management)
* Axios (with auth interceptor)

**Backend (`backend/`)**
* Python 3.13 + FastAPI
* PostgreSQL 16 + pgvector + SQLAlchemy + Alembic
* LangChain (LLM orchestration)
* `google-genai` SDK (Gemini)
* PyJWT + bcrypt
* `uv` package manager

**Infrastructure**
* Docker + Docker Compose (3-file architecture: base / dev / prod)
* Nginx reverse proxy
* Let's Encrypt SSL

## 🚀 Getting Started — Recommended Path (Docker)

This is the fastest path. Three containers (DB, backend, frontend) start together with one command.

### Prerequisites

* [Docker](https://docs.docker.com/get-docker/) + Docker Compose plugin (included in Docker Desktop)
* A Google Gemini API key — get one free at <https://aistudio.google.com/apikey>

### Steps

```bash
# 1. Clone the repo
git clone <your-repo-url> ai-study-agent
cd ai-study-agent

# 2. Create the .env file in the project root
cat > .env <<'EOF'
GOOGLE_API_KEY=paste-your-real-key-here
SECRET_KEY=$(openssl rand -hex 32)
EOF

# 3. Build and start everything
docker compose up --build

# 4. (First boot only) apply DB migrations in another terminal
docker exec -it ai_study_backend uv run alembic upgrade head
```

Open the frontend at <http://localhost> (or whatever port your `docker-compose.override.yml` exposes).
Backend API docs live at <http://localhost:8001/docs>.

## 🧪 Local Development Without Docker (Optional)

Useful when you want fast hot-reload on the host machine.

### Prerequisites

* Node.js (v18+)
* Python (v3.13+)
* `uv` — install via `pip install uv`
* PostgreSQL 16 running locally with the `vector` extension

### 1. Backend

```bash
cd backend

# Install dependencies (uv reads pyproject.toml; no requirements.txt is used)
uv sync

# Create .env (uv will read from the current directory)
cat > .env <<'EOF'
GOOGLE_API_KEY=paste-your-real-key-here
DATABASE_URL=postgresql://user:password@localhost:5432/app_db
SECRET_KEY=replace-with-a-long-random-string
EOF

# Apply DB migrations
uv run alembic upgrade head

# Start the FastAPI server (port 8001)
uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### 2. Frontend

```bash
cd ai-study-client

# Install dependencies
npm install

# Set the API base URL
echo 'VITE_AI_API_URL=http://localhost:8001' > .env.local

# Start the Vite dev server (port 5173)
npm run dev
```

Open <http://localhost:5173>.

## 🏭 Production Deployment

A production deploy uses the prod compose override and Let's Encrypt SSL:

```bash
# On your production server
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker exec -it ai_study_backend uv run alembic upgrade head
```

Update `nginx.conf` and `docker-compose.prod.yml` to use your real domain. See `SYSTEM_ARCHITECTURE.md` §10 (ADR 9) for the SSL / Cloudflare / Certbot setup.

## 📚 Further Reading

* **[`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md)** — Single source of truth: file index, data flows, ADRs.
* **[`CLAUDE.md`](./CLAUDE.md)** — Conventions and quality gates for AI-assisted contributions.
* **[`CHANGES.md`](./CHANGES.md)** — Recent structural changes to docs and config.
