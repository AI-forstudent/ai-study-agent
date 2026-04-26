# Active Tracker — AI Study Partner

> **Usage:** This is the living document for in-flight tasks and known issues.
> Update it at the start and end of every session. Never leave it stale.

---

> ⚠️ **STANDING RULE (enforced from this session forward):**
> A bug CANNOT be marked as `✅ Fixed` or removed from this list until the **USER explicitly
> confirms the fix worked in the real UI**. LLM self-assessment does not count as confirmation.

---

## Critical Issues
> Blockers that prevent a feature from working end-to-end.

| ID | Component | Description | Status |
|----|-----------|-------------|--------|
| B-003 | Transcript / pdfplumber | Hebrew text extracted in visual (reversed) order — previous LLM-based fix failed. Proper fix: `python-bidi` `get_display()` applied in Python before Gemini call. | 🔄 Awaiting User Confirmation |
| B-004 | Transcript upsert | Blind overwrite of `status` + `grade` on every re-upload could downgrade completed courses. Fixed with safe-merge logic: skip status/grade update if record is already `completed` + graded. | 🔄 Awaiting User Confirmation |

---

## Active Tasks
> What is being worked on right now.

_Phase transition complete. Awaiting first Feature Development task._

---

## Bug Registry

| ID | Component | Description | Severity | Status |
|----|-----------|-------------|----------|--------|
| B-001 | Alembic | `personas` table missing from init migration — `c7cc2d36d878` failed on fresh DB | High | ✅ Fixed (user confirmed) |
| B-002 | Docker / Frontend | `ai_study_frontend` crash loop — production Nginx config required Let's Encrypt certs not present in dev | High | ✅ Fixed (user confirmed) |
| B-003 | Transcript / pdfplumber | Hebrew RTL text extracted in visual (reversed) character order by pdfplumber. **Failed attempt:** Gemini prompt instruction to flip text. **Fix:** `python-bidi` `get_display()` applied per-line in Python before Gemini call. | High | 🔄 Awaiting User Confirmation |
| B-004 | Transcript upsert | Blind overwrite of `status`/`grade` on every re-upload could erase completed-course records. **Fix:** safe-merge logic — skip update if existing record is already `completed` + graded; fill catalog fields only when null. | High | 🔄 Awaiting User Confirmation |
| B-005 | GPA calculation | `_calculate_gpa` used a truthy check `and r.course.credits` which passes for negative credits. **Fix:** explicit `r.course.credits is not None and r.course.credits > 0`. | Low | ✅ Fixed (no UI confirmation required — logic-only) |

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
