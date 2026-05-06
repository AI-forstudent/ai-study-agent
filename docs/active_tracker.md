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
| B-005 | Multi-tenant isolation | All users could see/modify each other's threads, personas, and (via summary endpoints) documents — no auth enforcement on those routers | All four `threads.py` routes, `chat.py`, four `documents.py` summary endpoints, and all six `personas.py` mutation routes now require `get_current_user` and filter on ownership. Cross-user access returns 404 (no existence leak). See migration `i4h5g6f7e8d9`. |
| B-006 | Guest accounts shared | Every "Continue as guest" reviewer was issued a token for the same `guest@studyagent.ai` user, so all guests saw each other's data | Each `/auth/guest-login` call now mints a unique `guest-<uuid>@studyagent.ai` user with `subscription_tier='guest'`. |
| F-004 | Google Sign-In | The Google button in `AuthModal` was a `console.log` placeholder | New backend `POST /api/v1/auth/google` (verifies the ID token via `google-auth`); frontend renders the live Google Identity Services button when `VITE_GOOGLE_OAUTH_CLIENT_ID` is set. Requires `GOOGLE_OAUTH_CLIENT_ID` (backend) + `VITE_GOOGLE_OAUTH_CLIENT_ID` (frontend) — see `.env.example`. |

---

## 🚧 In Flight

> What is being actively worked on right now. One-line description + branch/file pointer.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| F-001 | Multi-provider AI (ChatGPT / Claude / Gemini) | ✅ Code complete | Needs `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` in `.env` before providers work. Gemini fallback always active. |
| F-002 | Summary tab modes (Current Page / All / Custom) | ✅ Code complete | Backend endpoints: `POST /summary/all`, `POST /summary/custom`. Awaiting user UI confirmation. |
| F-003 | Threads auto-tab-switch bug fix | ✅ Code complete | Removed `useEffect` that auto-switched to chat on activeThread change. Awaiting user UI confirmation. |
| F-005 | Token-usage billing — schema only (Phase 1) | ✅ Code complete | `users.subscription_tier`, `users.auth_provider`, `users.google_sub`, `threads.user_id`, and the new `usage_events` table land in migration `i4h5g6f7e8d9`. Tier defs and pricing live in `app/core/quota_config.py`. **No logging/enforcement/UI yet** — phases 2/3/4. |
| F-006 | Course / Session schema + backend (Phase 1) | ✅ Code complete | New `courses` + `course_memberships` tables and `folders.course_id` FK in migration `j5i6h7g8f9e0`. New routers: `/api/v1/courses` (CRUD + public list + star), `/api/v1/sessions` (list/search/delete root threads), `/api/v1/library/recent` (merged sessions+files lane). **Frontend lands in F-007 next commit.** |
| F-007 | My Library lane UI + sessions UX (Phase 2) | 🚧 In flight | Sidebar refactor (+New Session button, Communities Coming Soon), lane-based MyLibrary (Sessions&Files / Folders / My Courses), Sessions search page, standalone chat UI, course CRUD modals, public Courses tab with star toggle. |

---

## 📋 Known Tech Debt

> Deliberately deferred. **Do not "discover" these as new bugs** — they are tracked.

| ID | Area | Description | Priority |
|----|------|-------------|----------|
| T-003 | Study Commons | `POST /documents/{id}/clone` endpoint not yet implemented — `PublicGallery` clone button is wired to `console.log` only | High |
| T-004 | Study Commons | `GET /documents/public` is not paginated — will degrade at scale | Low |
| T-005 | Session Memory | `saveSessionMemory` in Zustand appends to local state only — never PUT to DB on session wrap-up | Medium |
| T-006 | Observability | Sentry SDK placeholder present in `main.py` but not wired to a real DSN | Low |
| T-007 | Multi-tenant orphans | Pre-existing personal personas with `author_id IS NULL` and standalone threads with `user_id IS NULL` (after migration `i4h5g6f7e8d9`) are invisible to all users by design. Clean up by hand if desired (`DELETE FROM personas WHERE persona_type='personal' AND author_id IS NULL;` and `DELETE FROM threads WHERE user_id IS NULL;`). | Low |
| T-008 | Billing — Phase 2 (logging) | Thread `user_id` through `call_llm` / `ask_gemini`; write a `UsageEvent` per LLM call using each provider's `usage_metadata`. | Medium |
| T-009 | Billing — Phase 3 (enforcement) | Pre-call check `SUM(credits) >= TIER_QUOTAS[user.subscription_tier]['credits_per_period']` over the last `PERIOD_SECONDS` window → 429 if over. | Medium |
| T-010 | Billing — Phase 4 (Settings UI) | `GET /api/v1/profile/usage` + `<UsageBar />` showing used / limit / reset-time. | Medium |

---

## How to use this file (for the AI)

1. **At session start:** read this file. Note what's in flight and what's already known tech debt.
2. **When fixing a bug:** if you believe it's fixed, add it to "Awaiting User Confirmation" — do NOT remove it from "In Flight" until the user confirms.
3. **When discovering a new issue:** check first whether it's already in "Known Tech Debt." If yes, do not propose to fix it without explicit user request.
4. **At session end:** update the "In Flight" section. Add anything new you discovered to the appropriate section.
5. **Never** silently delete items — the user must confirm.
