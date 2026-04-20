# AI Study Partner - Claude Code Guide

## Build & Run Commands
- **Backend (UV):** `cd backend && uv run uvicorn main:app --reload`
- **Frontend (Vite):** `cd ai-study-client && npm run dev`
- **Docker (Full Stack):** `docker-compose up --build`
- **Database Migrations:** `cd backend && alembic upgrade head`

## Tech Stack
- **Backend:** Python 3.13, FastAPI, SQLAlchemy (PostgreSQL + pgvector), UV for package management.
- **Frontend:** React, TypeScript, Vite, TailwindCSS, Zustand (State Management).
- **Infrastructure:** Docker, Nginx (Reverse Proxy), AWS (Production).

## Coding Standards
- **Python:** Use Type Hints, Snake_case for functions/variables, PascalCase for classes.
- **TypeScript:** Functional Components (React), CamelCase for variables/functions, PascalCase for components/types.
- **Database:** All logic for branching threads resides in `models.py`. Use circular reference handling for deletions.

## Project Structure Notes
- `backend/`: Core API logic and AI processing.
- `ai-study-client/`: UI and state logic.
- `.context/`: Long-term memory and detailed architectural patterns.
- `Legacy`: LM Studio and local LLM logic in separate Git branches should be ignored.