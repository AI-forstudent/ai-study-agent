# Active Tracker — AI Study Partner

> **Read at session start. Update at session end. Never leave stale.**
>
> ⚠️ **STANDING RULE:** A bug CANNOT be marked `✅ Fixed` and CANNOT be removed from this file
> until the **user explicitly confirms** it works in the real UI. LLM self-assessment does not count.
> Logic-only fixes with deterministic tests are the only exception.

---

## 🔄 Awaiting User Confirmation

> Bugs the AI thinks it fixed but the user hasn't verified in UI yet.
> Move to git history (delete from here) only after user says "confirmed."

| ID | Component | Description | Fix Applied |
|----|-----------|-------------|-------------|
| B-003 | Transcript / pdfplumber | Hebrew RTL text extracted in visual (reversed) order | `python-bidi` `get_display()` applied per-line before Gemini call |
| B-004 | Transcript upsert | Blind overwrite of `status`/`grade` could erase completed-course records | Safe-merge: skip update if existing record is already `completed` + graded; fill catalog fields only when null |

---

## 🚧 In Flight

> What is being actively worked on right now. One-line description + branch/file pointer.

_Phase transition complete. Awaiting first feature development task._

---

## 📋 Known Tech Debt

> Deliberately deferred. **Do not "discover" these as new bugs** — they are tracked.

| ID | Area | Description | Priority |
|----|------|-------------|----------|
| T-003 | Study Commons | `POST /documents/{id}/clone` endpoint not yet implemented — `PublicGallery` clone button is wired to `console.log` only | High |
| T-004 | Study Commons | `GET /documents/public` is not paginated — will degrade at scale | Low |
| T-005 | Session Memory | `saveSessionMemory` in Zustand appends to local state only — never PUT to DB on session wrap-up | Medium |
| T-006 | Observability | Sentry SDK placeholder present in `main.py` but not wired to a real DSN | Low |

---

## How to use this file (for the AI)

1. **At session start:** read this file. Note what's in flight and what's already known tech debt.
2. **When fixing a bug:** if you believe it's fixed, add it to "Awaiting User Confirmation" — do NOT remove it from "In Flight" until the user confirms.
3. **When discovering a new issue:** check first whether it's already in "Known Tech Debt." If yes, do not propose to fix it without explicit user request.
4. **At session end:** update the "In Flight" section. Add anything new you discovered to the appropriate section.
5. **Never** silently delete items — the user must confirm.
