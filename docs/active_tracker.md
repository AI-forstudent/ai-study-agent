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
| F-007 | My Library lane UI + sessions UX (Phase 2) | ✅ Code complete | Sidebar refactor (+ New Session at top, Communities "Soon" placeholder, "Active Session" removed, "Community" → "Courses" rename), lane-based MyLibrary (Sessions & Files mixed by recency / Folders / My Courses), course CRUD modal, public Courses tab with star toggle, +New dropdown (Session/Folder/Course). Sessions search dedicated page deferred — search affordance in the lane is hidden for now (would require expanding the useAuth view enum). Standalone chat UI reuses `MainWorkspace` standalone branch. |
| F-008 | Course Syllabus + course-scoped chat | ✅ Code complete | New migration `k6j7i8h9g0f1`: `courses.syllabus_user_document_id` (ON DELETE SET NULL), `courses.syllabus_extracted` JSONB, `course_topics`, `course_lecturers`, `threads.course_id`. New service `syllabus_extractor.py` runs ONE Gemini pass to extract structured fields; prompt_builder grew a `course_id` argument that appends a compact "## COURSE CONTEXT" block from the cached extraction. Frontend: course detail page now has Folders/Syllabus tabs, syllabus upload + extraction display, and a "Chat about this course" button that opens a standalone session pinned to the course (its syllabus enters every turn). Anthropic prompt-caching deferred — see T-011. Standalone-chat fetch in useChat now sends the Bearer token (was missing since auth was added to /chat). Circular-import fix in `3fde828` — `syllabus_extractor` lazy-imports `ask_gemini`. |
| F-009 | Exams — schema + processing pipeline (Phase A) | ✅ Code complete | Migration `l7k8j9i0h1g2` (fixed in `a1bd907` after a duplicate-index error): `exams`, `exam_questions` (with `Vector(768)` embeddings), `exam_question_topics` (M2M), `exam_lecturers` (M2M, Q1=b), `course_question_types`. New service `exam_processor.py` does the three-pass pipeline (extract → embed+tag → no-LLM difficulty calibration) — ~12-15k tokens for a typical 25-question exam. New router `exams.py` (mounted at /api/v1; routes use full paths to live under both /courses/{id}/exams and /exams/{id}). Companion blank/solved PDF intentionally generated lazily by the Take flow (Phase C) rather than eagerly at upload. |
| F-010 | Exams UI (Phase B) | ✅ Code complete | New "Exams" tab inside the course drilldown. Stats header with three inline-SVG visualisations (no chart-lib dep): a question-types donut, a top-topics horizontal bar list, and a difficulty histogram. Table view with title / period / lecturers / question count / difficulty badges. Click a row → ExamDetailView with the per-question breakdown (number, type chip, topic chips, difficulty badge, page number, markdown question text, collapsible reference solution). Upload modal handles the two-step flow: POST /documents/ → POST /courses/{id}/exams; tags lecturers from the syllabus extraction. Take/Submit/Grade flow is F-011. |
| F-012 | Async exam processing + retry | ✅ Code complete | Migration `m8l9k0j1i2h3` adds `exams.processing_status` ('pending'/'processing'/'completed'/'failed') + `processing_error`. POST /exams now returns 202 immediately with the row in 'pending' state; a FastAPI BackgroundTask runs the AI pipeline outside the request lifecycle (own DB session). New `/exams/{id}/retry` endpoint requeues failed exams. Failed exams are NEVER deleted — they stay visible with a red "Failed" badge + the friendly error message + a Retry button. Frontend `CourseExamsTab` polls the list every 5s while any exam is in 'pending'/'processing'; rows render as non-clickable while in flight. Solves the "upload got stuck" / "can't re-upload after refresh" / "where do I see the questions" trifecta caused by nginx 60s timeout cutting off synchronous 60-150s processing. |
| F-013 | Exam infrastructure for 20-30 exams/course | ✅ Code complete | Three perf + reliability upgrades sized for the user's expected scale. (1) Migration `n9m0l1k2j3i4` adds `Exam.question_count` denormalized cache so the polling list endpoint stops loading every exam's questions just to call `len(...)`. (2) `process_exam` now runs per-question tagging in a `ThreadPoolExecutor` (5 workers); a new `tag_question_pure` thread-safe helper takes a `CourseSnapshot` and returns raw decisions, the main thread does all DB upserts after — collapses 25-question exams from ~50s to ~10s while keeping the SQLAlchemy session single-threaded. (3) `selectinload` on `list_course_exams` and `get_exam` drops queries-per-request from N+1 (~30 queries × N exams) to a fixed ~4 regardless of course size. (4) Lifespan stuck-processing sweeper marks any exam stuck in `pending`/`processing` for >15 min as `failed` with a recovery hint — covers BackgroundTasks lost to deploys / OOM / crashes. |

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
| T-011 | Anthropic prompt caching for syllabus block | Q3=(c) was chosen but full `cache_control` plumbing requires `prompt_builder` to return structured blocks (persona/memory/course separately) instead of one string, plus a special path in `_call_anthropic` to mark the course block as `ephemeral`. Currently the syllabus is part of the inline string — cheap on every turn (~500 tokens) but not cached. | Low |
| T-012 | Doc-anchored threads ignore course context | `chat.py` (standalone) uses prompt_builder's new `course_id` arg, but `document_service.get_chat_response_for_thread` (doc-anchored) builds its own prompt and doesn't yet read `Thread.course_id`. Add when a real user opens a doc inside a course context. | Medium |
| T-013 | Folder→course move from FolderModal | Backend supports `PUT /folders/{id}` with `course_id`, but the FolderModal UI doesn't expose the picker. Trivial follow-up. | Low |
| T-014 | Set existing library doc as syllabus | The Syllabus tab uploads a fresh file. If the user already has the file in their library, they get a 409 with a "use 'Set as syllabus' menu option (TODO)" message — that menu option doesn't exist yet. | Low |
| T-015 | Exam duplicate detection | Phase A doesn't check whether an uploaded exam is the same paper as an existing one. Plan: SHA-256 (already covered by CAS dedup of the underlying file), then content match — compare extracted question-text embeddings against existing exams in the course; warn if a high % overlap. Add when the user starts seeing duplicates in their library. | Medium |
| ~~T-016~~ | ~~Exam UI (Phase B of F-009)~~ | ✅ Shipped as F-010. | — |
| T-019 | Real per-question-type aggregation | The Phase B donut currently approximates "question types" by reusing the topics distribution because ExamCard doesn't carry per-type counts. Either add a `/courses/{id}/question-types` endpoint or include per-type counts on the card response. | Low |
| T-020 | Granular exam metadata (split semester/moed, add exam_type) | Currently `Exam.semester` is jamming `Fall`/`Spring` AND `Moed A`/`Moed B` into one field. Per spec, these are different concepts and must be queryable independently. Plan: migration to add `Exam.moed` (`A`/`B`/`C`/`D`/`Special`/null) and `Exam.exam_type` (`midterm`/`final`/`quiz`/`practice`/null); update extraction prompt to fill all four (year, semester, moed, exam_type) separately; update card + detail UI to render them; never concatenate. | High |
| T-021 | Folder / multi-file exam upload | Drop a folder containing many past papers; the system filters out non-exam files, groups answer keys with their corresponding exam, and processes them in batch. | High |
| T-022 | Batched review UI for AI uncertainty | At end of batch processing, show a single review screen for fields the AI flagged "low confidence" or "couldn't determine" — with the relevant doc snippet for context. Confidence levels: `high` (auto-fill quietly) / `verify` (auto-fill but ask) / `unknown` (ask). | High |
| T-023 | Topic-relevance check on exam upload | Cross-reference extracted question topics against the course's `course_topics` taxonomy; warn the user if an exam doesn't seem to match the course. Don't auto-reject — let them override. | Medium |
| T-024 | OCR for image-only exam PDFs | Some past papers are scanned images; pdfplumber returns empty text for those. Detect `len(pages) == 0 or all empty text` and run OCR (Tesseract) before the LLM extractor. | Medium |
| T-025 | Exam content-based duplicate detection | Phase A only does SHA-256 (CAS) dedup. Per user spec: also detect "this is the same exam, just a different scan" via question-text embeddings; warn before adding. Same approach as T-015. | Medium |
| T-026 | Multi-lecturer support is already there but UI doesn't expose | `exam_lecturers` is M2M and the upload modal already handles lists, but the lecturer roster comes only from the syllabus extraction — needs a "+ add lecturer" affordance for cases where the syllabus doesn't carry the full list. | Low |
| T-017 | Exam Take/Submit/Grade (Phase C of F-009) | "Take this exam" button → companion blank-PDF generation (lazy) + download; upload-answer form; AI grading using the cached `reference_solution` per question. New `exam_attempts` table. | High |
| T-018 | Recompute difficulty asynchronously | `compute_difficulty_scores` runs synchronously on every new exam upload — that's fine for ~10s of exams but will block the request as the course grows. Move to a background task or a periodic recompute job once a course has >50 exams. | Low |

---

## How to use this file (for the AI)

1. **At session start:** read this file. Note what's in flight and what's already known tech debt.
2. **When fixing a bug:** if you believe it's fixed, add it to "Awaiting User Confirmation" — do NOT remove it from "In Flight" until the user confirms.
3. **When discovering a new issue:** check first whether it's already in "Known Tech Debt." If yes, do not propose to fix it without explicit user request.
4. **At session end:** update the "In Flight" section. Add anything new you discovered to the appropriate section.
5. **Never** silently delete items — the user must confirm.
