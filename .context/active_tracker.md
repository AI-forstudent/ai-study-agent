# Active Tracker — AI Study Partner

> **Usage:** This is the living document for in-flight tasks and known issues.
> Update it at the start and end of every session. Never leave it stale.

---

## Critical Issues
> Blockers that prevent a feature from working end-to-end.

_None currently._

---

## Active Tasks
> What is being worked on right now.

_Phase transition complete. Awaiting first Feature Development task._

---

## Bug Registry

| ID | Component | Description | Severity | Status |
|----|-----------|-------------|----------|--------|
| B-001 | Alembic | `personas` table missing from init migration — `c7cc2d36d878` failed on fresh DB | High | ✅ Fixed |
| B-002 | Docker / Frontend | `ai_study_frontend` crash loop — production Nginx config required Let's Encrypt certs not present in dev | High | ✅ Fixed |

---

## Tech Debt

| ID | Area | Description | Priority |
|----|------|-------------|----------|
| T-001 | `state.md` | Document content is stale relative to CAS/multi-tenant migration — needs a full rewrite pass | Medium |
| T-002 | `.context/project-map.md` | File table still reflects old flat backend structure (`main.py`, `models.py`, `services.py`) — not the `app/` package layout | Medium |
| T-003 | Study Commons | `POST /documents/{id}/clone` endpoint not yet implemented — `PublicGallery` clone button is wired to `console.log` only | High |
| T-004 | Study Commons | `GET /documents/public` is not paginated — will degrade at scale | Low |
| T-005 | Session Memory | `saveSessionMemory` in Zustand appends to local state only — never PUT to DB on session wrap-up | Medium |
| T-006 | Observability | Sentry SDK placeholder present in `main.py` but not wired to a real DSN | Low |
