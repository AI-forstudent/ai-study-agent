# CHANGES

---

## 2026-05-15 — README refresh across the repo

**Scope:** Documentation only. No code, no migrations, no behaviour change.

### Why

The three READMEs had drifted from reality:

- Root `README.md` predated Courses, Exams, Lectures, Personal Hub, multi-provider LLM (OpenAI / Anthropic), Google Sign-In, the Drive-style library, Phase-1 multi-tenancy, and the responsive pass. It also still mentioned "Hybrid Cloud + (planned) Local AI" — a path abandoned in ADR 1.
- `ai-study-client/README.md` was the stock Vite + TS template — zero project context.
- `backend/alembic/README` was the Alembic-init one-liner.

### What changed

| File | What changed |
|---|---|
| [`README.md`](README.md) | Rewritten. Removed defunct "local AI" framing. Expanded Key Features (courses, exams, lectures, Personal Hub, multi-provider LLM, CAS, Google Sign-In, responsive). Updated Tech Stack: added `openai` + `anthropic` + `google-auth` + `pdfplumber` + `python-bidi`; clarified that LangChain usage is limited to `langchain-google-genai` + `langchain-text-splitters` (not a full LangChain pipeline). Added a Common Commands cheat-sheet. Added pointers to `docs/active_tracker.md`, `docs/vision.md`, and `docs/plans/multi_tenancy.md`. Added optional env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `ALLOWED_ORIGINS`). |
| [`ai-study-client/README.md`](ai-study-client/README.md) | Replaced Vite template with a real frontend README — stack, quick-start, env vars (`VITE_AI_API_URL`, `VITE_GOOGLE_OAUTH_CLIENT_ID`), scripts, DDD directory layout, conventions, testing, and production-build notes. Links to root README, `SYSTEM_ARCHITECTURE.md` §6, and `ai-study-client/CLAUDE.md`. |
| [`backend/alembic/README`](backend/alembic/README) | Expanded the Alembic-init one-liner with a `domain.py` pointer and the three common commands (upgrade head, autogenerate, current). |

No code touched. No CLAUDE.md changes — local directives were already current.

---

## 2026-05-06 (next day) — Granular exam metadata (T-020)

**Scope:** Backend migration + extraction prompt + form refactor. Splits the overloaded `Exam.semester` field into three independent columns per the user's original "concatenation bug" call-out.

### Why this change

The user's spec from earlier explicitly flagged:

> Current bug: the system is jamming multiple distinct pieces of information into a single field (e.g., semester + exam sitting being merged). This is wrong. Each piece of metadata must be its own structured field so it can be filtered, sorted, and queried independently.

Until this commit, both academic semester ("Fall") and exam sitting ("Moed A") were being shoved into `Exam.semester`. They're independent — Moed B in Fall is a different exam from Moed A in Fall. Filtering, sorting, and analytics need them apart.

### What changed

#### 🆕 Created

| File | Purpose |
|---|---|
| `backend/alembic/versions/o0n1m2l3k4j5_exam_granular_metadata.py` | Adds `Exam.moed` (`A`/`B`/`C`/`D`/`Special`/null) and `Exam.exam_type` (`midterm`/`final`/`quiz`/`practice`/`other`/null). Backfill regex-extracts any `"Moed X"` (English or `"מועד X"` Hebrew) string out of the existing `semester` field into the new `moed` column. |

#### ✏️ Modified

| File | What changed |
|---|---|
| `backend/app/models/domain.py` | `Exam` gains `moed` and `exam_type`. Comment notes the never-concatenate invariant. |
| `backend/app/api/routers/exams.py` | `ExamCreateRequest` + `ExamCardOut` (and via inheritance, `ExamDetailOut`) carry `moed` and `exam_type`. The `_serialize_card` and create handler thread them through. |
| `backend/app/services/exam_processor.py` | `_EXTRACTION_PROMPT` rewritten — response is now a top-level object with `metadata` (year/semester/moed/exam_type) and `questions` (the existing list). New `_coerce_year` / `_coerce_enum` helpers normalise the model output. `extract_questions` returns a `(metadata, questions)` tuple. `process_exam` applies the AI-detected metadata to the exam row only when the corresponding user field is null/blank — user input always wins. |
| `ai-study-client/src/types/course.ts` | New `ExamSemester`, `ExamMoed`, `ExamType` literal-union types; `ExamCard` carries all three fields. |
| `ai-study-client/src/services/api.ts` | `createCourseExam` payload type carries `moed` + `exam_type`. |
| `ai-study-client/src/features/courses/components/ExamCreateModal.tsx` | Replaces the single overloaded semester dropdown with four small selects: `Year` / `Semester` / `Moed` / `Type`. Each defaults to "Auto-detect" (empty string) so the AI fills it; explicit user picks override. Helper text below the row explains the auto-fill behaviour. |
| `ai-study-client/src/features/courses/components/CourseExamsTab.tsx` | Table row's "Period" column joins year / semester / moed / exam_type with ` · ` separators (visually together, but never concatenated in the data layer). |
| `ai-study-client/src/features/courses/components/ExamDetailView.tsx` | Same join in the detail-card header. |

### Auto-fill policy

User input ALWAYS wins. AI fills only the fields the user left on "Auto-detect" (i.e., null on the request). This matches the spec's "auto-filled but please verify" intent — the user can always pick before upload, and the AI never silently overwrites a chosen value.

### Hebrew handling

The extraction prompt explicitly maps Hebrew terms — `מועד א/ב/מיוחד` → `A`/`B`/`Special`, `סמסטר א` / `סתיו` → `Fall`, `סמסטר ב` / `אביב` → `Spring`, `קיץ` → `Summer`. Real-world syllabi mix these freely.

### Token cost

Same number of LLM calls as before — the extraction prompt is now a slightly larger payload (the extra metadata schema), but it runs once per exam upload like always.

### What's still ahead (per the original user spec)

T-021 / T-022: folder upload + batched review UI. T-023: topic-relevance check. T-024: OCR for image-only PDFs. T-025: content-based duplicate detection. T-026: multi-lecturer "+ add" affordance. F-011: the Take/Submit/Grade flow.

---

## 2026-05-06 (very overnight) — Two-axis tagging + real exam stats

**Scope:** Backend prompt + tagger refactor; new aggregation endpoint; frontend stats header rewire. No migrations.

### Why this change

Three connected complaints from the user:

1. **The tagger conflates topics with question types.** Names like "Multiple Choice" or "Proof" sometimes ended up in `topic_new` instead of `question_type_new`. The original prompt mentioned both but didn't enforce a clean separation.
2. **Topics only inferred from question text.** If a question asks "show this graph has a perfect matching" and the solution invokes Hall's theorem, the tag "Hall's theorem" was missed because the question text never mentioned it.
3. **The Question-Types donut on the stats header was fake data** — it reused the topics distribution because `ExamCard` didn't carry per-type counts (the T-019 placeholder in the previous commit). Plus the stats only showed top 5/6 entries, no way to view the full taxonomy.

### What changed

#### ✏️ Modified — Backend

| File | What changed |
|---|---|
| `backend/app/services/exam_processor.py` | `_TAGGING_PROMPT` rewritten as a two-axis spec with explicit *Topics = subject matter* / *Question Type = response format* definitions, illustrative examples, and SIX hard rules — including "NEVER put a question-type name into `topic_new`" and "tag topics from BOTH the question and (when provided) the solution; if the solution uses a theorem the question doesn't mention, that theorem IS a topic." `tag_question_pure(question_text, snapshot, *, solution_text=None)` accepts the inline solution; the prompt's solution block is conditionally injected (rule 4 — "mentally sketch one before tagging" — covers the no-solution case). `process_exam` passes `q.get("solution_text")` through. |
| `backend/app/api/routers/exams.py` | New `GET /api/v1/courses/{id}/exam-stats` endpoint returns sorted topic and question-type histograms with both `question_count` and `exam_count` per row, plus a 5-bucket aggregate-difficulty distribution. Scoped to `processing_status='completed'` exams so in-flight or failed uploads don't pollute the visualisations. New Pydantic schemas `TopicStatOut`, `QuestionTypeStatOut`, `ExamStatsOut`. |

#### ✏️ Modified — Frontend

| File | What changed |
|---|---|
| `ai-study-client/src/types/course.ts` | New `TopicStat`, `QuestionTypeStat`, `ExamStats` interfaces. |
| `ai-study-client/src/services/api.ts` | `getCourseExamStats(courseId)` wrapper. |
| `ai-study-client/src/features/courses/components/ExamStatsHeader.tsx` | Full rewrite. Fetches `/exam-stats` (re-runs when `invalidateKey` or exam count changes). Question-types donut now uses real per-type counts. Each card has an expandable "View all (N)" button — collapsed view stays compact (top 5 in the legend, top 6 bars), expanded view scrolls through the entire course taxonomy. Difficulty histogram now also draws from server data, not a client-side recompute. |
| `ai-study-client/src/features/courses/components/CourseExamsTab.tsx` | Passes `courseId` and an `invalidateKey` (count of completed exams) into the stats header so the stats refresh on each successful upload / retry. |

### Behaviour notes

- **Server-side filtering of zero-count rows** is intentionally skipped — the backend returns the full taxonomy (`question_count` may be 0 for a topic that came in via the syllabus extraction but hasn't shown up in any exam yet). The frontend filters them out of the visualisations so empty slices don't appear, but they remain visible if/when a future "Topics & Tags admin" panel reads the same endpoint.
- **`exam-stats` only counts completed exams.** A failed exam's auto-inferred topics still live in `course_topics` (so they're available for the next retry / next exam), but they don't count toward the donut until something successfully tags them.
- **The "View all" expander caps at `max-h-44` / `max-h-56`** with internal scroll — courses with 50+ topics don't blow out the header card height.

### Token cost

Zero new LLM calls — the tagging prompt is longer (~1.5x previous size, still well under 1k tokens) but runs the same number of times. The new stats endpoint is pure SQL aggregation; no AI involved.

---

## 2026-05-06 (overnight) — Exam processing infrastructure for scale

**Scope:** Backend perf + reliability upgrades sized for 20-30 exams per course (with headroom). User confirmed the basic flow works and asked me to focus on infrastructure — this is that.

### Why this change

Three real bottlenecks at the target scale, all visible in production traces:

1. **Polling latency** — the table polls `GET /courses/{id}/exams` every 5 seconds while anything is in flight. The previous serializer lazy-loaded `exam.questions`, then per-question lazy-loaded `q.topics`, then per-exam lazy-loaded `exam.lecturers`. At 30 exams × 25 questions, that's ~30 + 30×(25 + 1) = ~810 SQL round-trips per poll. With selectinload, it's a fixed 4 round-trips no matter the size.
2. **Upload duration** — 25 sequential per-question tagging calls × ~2s each = ~50 seconds of LLM time. Sequential because the original tagger touched the DB session (which isn't thread-safe).
3. **Stuck `processing`** — BackgroundTasks die with the worker; a deploy mid-upload leaves an exam in `processing` forever. No recovery short of editing the row by hand.

### What changed

#### 🆕 Created

| File | Purpose |
|---|---|
| `backend/alembic/versions/n9m0l1k2j3i4_exam_question_count.py` | Adds `Exam.question_count` (Integer, NOT NULL, default 0) and backfills from `COUNT(*) FROM exam_questions`. The list serializer now reads this column instead of forcing a question load to call `len(...)`. |

#### ✏️ Modified

| File | What changed |
|---|---|
| `backend/app/models/domain.py` | `Exam.question_count` column. |
| `backend/app/services/exam_processor.py` | New `CourseSnapshot` dataclass (frozen) and `tag_question_pure(question_text, snapshot)` — a thread-safe pure function that performs ONE Gemini call and returns raw decisions (`topic_ids_existing`, `topic_names_new`, `type_id_existing`, `type_name_new`, `reference_solution`) without touching the DB. `process_exam` now snapshots the course, runs `executor.map(tag_question_pure, …)` over a 5-worker `ThreadPoolExecutor`, then on the main thread aggregates results, upserts new topics / question-types into the course taxonomy (with a running name→id map so two workers proposing the same name share one upserted row), and persists ExamQuestion records. Sets `exam.question_count` at the end. |
| `backend/app/api/routers/exams.py` | `selectinload(Exam.lecturers)` + `selectinload(Exam.questions).selectinload(ExamQuestion.topics)` on `list_course_exams`. `get_exam` adds the same plus `selectinload(ExamQuestion.question_type)`. `_serialize_card` uses `exam.question_count` instead of `len(exam.questions)`. `retry_exam_processing` resets `question_count` to 0 along with the other fields. |
| `backend/app/main.py` | Lifespan stuck-processing sweeper. On boot, any `Exam` in `pending`/`processing` older than 15 min is flipped to `failed` with the message *"Processing was interrupted (likely a server restart). Click Retry to run the AI extraction again."* — gives users a clear path forward when a deploy lands mid-upload. |

### Numbers

| Operation | Before | After | Notes |
|---|---|---|---|
| GET /courses/{id}/exams (30 exams) | ~810 SQL queries | ~4 SQL queries | `selectinload` collapses the lazy-load N+1 cascade. |
| Tag 25 questions during upload | ~50s sequential | ~10s parallel | 5-worker `ThreadPoolExecutor`, snapshot-based, no DB in workers. |
| List endpoint, count column | full questions load | denormalized read | Removes one of the most expensive lazy-loads from the hot path. |
| Stuck-processing recovery | manual SQL by hand | automatic at boot | Bounded by 15 min sweep window. |

### Concurrency notes

- **SQLAlchemy session stays single-threaded** by design — the workers operate on a frozen `CourseSnapshot` and return plain Python objects. The main thread holds the session and does all upserts sequentially after the futures resolve.
- **Topic / question-type race** within a single exam is handled by a running `topic_id_by_name` / `type_id_by_name` map: two workers proposing the same new name converge on one upserted row.
- **Cross-exam concurrency** (two simultaneous uploads on the same course) is still subject to the existing `UNIQUE (course_id, name)` constraint — the loser of a topic-insert race fails the INSERT, the catch-and-fall-through pattern in the upsert handles it gracefully.
- **`_TAG_PARALLELISM = 5`** is a deliberate trade-off: enough to make a 25-question exam feel snappy, low enough to leave Gemini quota for other concurrent users.

### What's still ahead (T-018, T-020..T-026)

T-018 — incremental difficulty recompute (only re-cluster types touched by the new exam) — not needed below ~50 exams; queued for when the course library grows past that. The other deferred items (granular metadata split, folder upload, batched review UI, topic-relevance check, OCR, content-based dedup) are unchanged.

---

## 2026-05-06 (very late) — Async exam processing + Retry

**Scope:** Backend + frontend. Replaces the synchronous exam upload flow with a queued BackgroundTask pattern.

### Why this change

User reported: "upload gets stuck", "after refresh can't re-upload the same exam", "where do I see the question table". All three are the same root cause: a 25-question exam takes 60-150 seconds to process (extract + 25 × tag + difficulty), but nginx's `proxy_read_timeout` defaults to 60s. The connection drops; the user sees a hung modal; my own rollback path then deleted the Exam row, leaving the file alone in CAS so a retry hit 409.

### What changed

#### 🆕 Created

| File | Purpose |
|---|---|
| `backend/alembic/versions/m8l9k0j1i2h3_exam_processing_status.py` | Adds `exams.processing_status` (`'pending'`/`'processing'`/`'completed'`/`'failed'`, default `'pending'`) and `exams.processing_error` (TEXT, nullable). Backfills existing rows: `'completed'` if `processed_at` is set, otherwise `'failed'`. |

#### ✏️ Modified

| File | What changed |
|---|---|
| `backend/app/models/domain.py` | `Exam` gains `processing_status` + `processing_error`. |
| `backend/app/api/routers/exams.py` | `_run_exam_pipeline(exam_id, full_text)` is the new BackgroundTask worker — it owns its own DB session (the request session is closed by then), runs `process_exam`, and updates the row's status to `'completed'` / `'failed'` with a friendly error message via `services.llm_json.user_message_for`. The exam row is NEVER deleted on failure — the user can read the error and click Retry. POST returns 202 the moment the row is committed (typically <2s). New `POST /exams/{id}/retry` clears questions, resets status to `'pending'`, and queues a fresh task. ExamCardOut now carries `processing_status` + `processing_error`. |
| `ai-study-client/src/types/course.ts` | `ExamProcessingStatus` union + new fields on `ExamCard`. |
| `ai-study-client/src/services/api.ts` | `retryExamProcessing(examId)` wrapper. |
| `ai-study-client/src/features/courses/components/CourseExamsTab.tsx` | Polls the list every 5s while any exam is `'pending'` or `'processing'`. Rows in those states are non-clickable and show a "queued" / "AI extracting…" indicator + an indigo "Processing" badge. Failed rows show the error message inline and a "Retry" button (owner only) that calls the new retry endpoint and optimistically flips status to `'pending'`. |
| `ai-study-client/src/features/courses/components/ExamCreateModal.tsx` | Drops the `'processing'` phase — backend returns 202 fast, modal closes immediately, and the new exam appears in the table with `'pending'` state. The 60-150s wait is now non-blocking. |

### Behaviour notes

- **No more 60-second nginx timeout.** Backend response is now sub-2-seconds (just an INSERT + queue), regardless of exam length.
- **Failure is observable.** Previously a failed extraction silently rolled back the row. Now it persists with a clear error message and a Retry button — the user controls when to re-run, and they don't have to delete the file from My Library to do it.
- **Polling auto-stops.** The polling effect's dependency is the boolean "any exam in flight". When everything settles, the interval is cleared. No background polling on idle screens.
- **Retry is idempotent.** Mash the button — each call clears prior questions and queues a fresh BackgroundTask. The DB transaction ordering means an in-flight prior run will be overwritten by the new one's terminal commit.

### Acceptance criteria from the user spec

- ✅ Uploading a single exam no longer "gets stuck" — modal closes immediately, processing happens in the background.
- ✅ User can re-upload after a failure without 409 (the file is still in CAS, but the failed Exam row is reusable via Retry).
- ✅ User can see the question table — once processing completes, the row becomes clickable and routes to `ExamDetailView`.

### Still deferred (the rest of the user's bigger spec — T-020 to T-026)

Granular metadata (split semester/moed/exam_type), folder upload, batched review UI, topic-relevance check, OCR for image-only PDFs, content-based duplicate detection. Those remain follow-up commits.

---

## 2026-05-06 (late evening) — Robust LLM-JSON parsing

**Scope:** Backend bug-fix. Frontend gets a small retry-clarity tweak.

### Why this change

Exam upload was crashing with:

> `Question extraction returned unparseable JSON: Expecting value: line 1 column 0 (char 0)`

Two bugs collided:

1. **`ask_gemini` swallowed every exception and returned a Hebrew apology string.** When safety filters blanked Gemini's response (the empty `char 0` case), or a timeout/quota error fired, JSON callers got plain Hebrew text and tried to parse it as JSON — failed every time.
2. **Every JSON caller had its own ad-hoc `cleaned.strip().lstrip('```json').rstrip('```')` then `json.loads(...)`.** No retries, no logging of the actual model output, no schema validation, no centralised handling.

### What changed

#### 🆕 Created

| File | Purpose |
|---|---|
| `backend/app/services/llm_json.py` | Single source of truth for "LLM-must-return-JSON" calls. `safe_json_parse(raw)` — defensive strip of fences and prose preambles, then `json.loads`. `call_llm_for_json(...)` — N-attempt retry loop with progressively stricter "JSON only, no markdown" reminders, type validation, structured logging. `LLMJsonError` — single exception type carrying `reason`, `raw`, `attempts`. `user_message_for(error)` — translates technical reasons (`empty`, `parse_error`, `wrong_type`, `call_error`) into a user-friendly UI string. **Code-review rule: no raw `json.loads` on model output anywhere else.** |

#### ✏️ Modified

| File | What changed |
|---|---|
| `backend/app/services/document_service.py` | New `ask_gemini_json(prompt, use_smart_model=False)` — uses the genai SDK's `response_mime_type="application/json"` to force structured output at the API level, not just by prompt instruction. Exceptions propagate (no Hebrew apology fallback) so the retry loop can react. |
| `backend/app/services/syllabus_extractor.py` | Routes through `call_llm_for_json` instead of bespoke `json.loads`. |
| `backend/app/services/exam_processor.py` | Both `extract_questions` (3 retries, `expected_type=list`) and `tag_question` (2 retries, tolerates failure by returning empty tags) now go through `call_llm_for_json`. |
| `backend/app/api/routers/personal_hub.py` | The transcript parser uses `call_llm_for_json` and returns `user_message_for(...)` on failure. |
| `backend/app/api/routers/courses.py` | `attach_course_syllabus` catches `LLMJsonError` and returns a 502 with the user-friendly message. |
| `backend/app/api/routers/exams.py` | `create_course_exam` rolls back the empty exam shell and returns the friendly message on `LLMJsonError`; same on the broader `Exception` catch. |
| `ai-study-client/src/features/courses/components/ExamCreateModal.tsx` | Caches the `userDocumentId` after a successful upload so retrying just re-runs the AI extraction (skipping the second upload that would otherwise hit CAS 409). The error banner now hints "Your file is already uploaded — clicking will retry just the AI extraction." when in that state. |

### Behaviour notes

- **Native JSON mode is the primary defense.** With `response_mime_type="application/json"` set, Gemini refuses to emit prose or markdown fences in the first place, so the safe-parse + retry path mostly catches edge cases (safety filters blanking output, transient SDK errors).
- **Tagging tolerates failure per question.** A single failed tag returns empty tags rather than aborting the whole 25-question exam — the question is still saved, just without metadata; the user can re-tag manually once that UI lands.
- **Logs are now actionable.** `[llm_json:exam_extract_questions] parse failed attempt 1/3: reason=empty, raw_first_200='…'` — grep-friendly per caller, with the first 200 chars of raw output for debugging.

### What's still ahead (deferred from the user's larger spec)

The user's spec covered much more than the bug fix — granular metadata (split semester/moed/exam_type), folder upload, batched review UI, topic-relevance check, OCR for scanned PDFs, content-based duplicate detection, multi-lecturer pickers. All tracked in `docs/active_tracker.md` as T-020 through T-026. They're separate commits because each is its own scope; the JSON-parse blocker had to land first or none of the rest could be tested.

---

## 2026-05-06 (later evening) — Exams Phase B: course-detail UI

**Scope:** Frontend only. Adds the Exams tab inside the course drilldown, the upload-and-process flow, and the per-exam detail view.

### Why this change

Phase A landed the data model and processing pipeline; Phase B is the user-facing surface that reads from it. The user explicitly asked for: a stats header (pie of question types, bar of topics, difficulty histogram), a table of past papers with lecturers + relative difficulty + topics, and an exam-detail page that shows the questions broken out with their tags. This commit ships exactly that and nothing else — Take/Submit/Grade is Phase C.

### What changed

#### 🆕 Created

| File | Purpose |
|---|---|
| `ai-study-client/src/features/courses/components/ExamStatsHeader.tsx` | Three small visualisations rendered with inline SVG + CSS (no chart-lib dep): question-types donut, top-topics horizontal bar list, difficulty histogram with sequential color ramp. |
| `ai-study-client/src/features/courses/components/ExamCreateModal.tsx` | Upload modal — file picker + title/year/semester form, has-solutions checkbox, lecturer-tag chips. Two-step submit (POST /documents/ → POST /courses/{id}/exams) with a "uploading…" / "AI extracting…" progress state. |
| `ai-study-client/src/features/courses/components/ExamDetailView.tsx` | Per-exam detail. Header card with year/semester/lecturers/topics/difficulty/has-solutions badge. Question cards with question_number chip, type pill, topic pills, difficulty badge, page number, markdown-rendered question text, and a collapsible reference-solution panel. |
| `ai-study-client/src/features/courses/components/CourseExamsTab.tsx` | Orchestrator. Fetches the exam list and the syllabus's lecturer roster in parallel; renders either the list view or the detail view based on `activeExamId`. |

#### ✏️ Modified

| File | What changed |
|---|---|
| `ai-study-client/src/types/course.ts` | Adds `QuestionType`, `ExamLecturer`, `ExamTopic`, `ExamQuestion`, `ExamCard`, `ExamDetail` interfaces matching the Phase A response shapes. |
| `ai-study-client/src/services/api.ts` | New `listCourseExams`, `createCourseExam`, `getExam`, `deleteExam` wrappers. |
| `ai-study-client/src/components/layout/MyLibrary.tsx` | The course drilldown now has THREE tabs (Folders / Syllabus / Exams) instead of two. `CourseTab` type extended; new tab button uses the GraduationCap icon. |

### Visualisation choices

- **No chart library.** Three small visualisations rendered as inline SVG (`PieDonut`) and CSS divs (`HBarList`, `Histogram`). Keeps the bundle slim and avoids dragging in a 60-100kb dep for one tab.
- **Stand-in for question-type aggregation.** The donut groups by `topic` rather than `question_type` because the card-shape API doesn't carry per-type counts yet. Tracked as T-019; trivial to swap once the backend exposes them.

### UX notes

- **Upload progress is two-phase.** The button surfaces both the file upload and the (5–15 second) AI processing pass with distinct labels and icons so the user understands what's happening.
- **Same-file re-upload returns 409.** The modal explains the user has the file already and asks them to delete it from My Library first or pick a different version. (Better recovery is T-014's territory and applies here too.)
- **Detail view is rendered inside the tab**, not on a separate route — clicking a row replaces the tab body; "All exams" link returns to the list. No URL change. Will hold up fine until proper routing is needed.

### Token cost

Zero LLM calls in the frontend. All Phase B work reads cached fields the Phase A pipeline already populated.

---

## 2026-05-06 (evening) — Exams Phase A: schema + processing pipeline

**Scope:** Backend only. Adds the data model and the token-efficient processing pipeline for past-paper exams. Phase B (UI) and Phase C (Take/Grade) are separate commits.

### Why this change

The user's product spec for Course exams: upload past papers, AI breaks them into questions, each question is tagged with topic and question type from the course's taxonomy, every question gets a relative difficulty score, and the exam aggregates a difficulty number for the table view. Without batching the work into discrete passes, classification would re-read every exam on every interaction — burning tokens for no extra signal. The pipeline below caches each pass's output so the work is paid for once.

### What changed

#### 🆕 Created

| File | Purpose |
|---|---|
| `backend/alembic/versions/l7k8j9i0h1g2_exams_and_questions.py` | Adds `course_question_types`, `exams`, `exam_questions` (with `Vector(768)`), `exam_question_topics` (M2M), `exam_lecturers` (M2M). |
| `backend/app/services/exam_processor.py` | Three-pass pipeline: `extract_questions` (one Gemini call per exam), `tag_question` (one small Gemini call per question — chooses ids from existing course taxonomy or upserts new entries), `compute_difficulty_scores` (no-LLM, embedding-cluster-based calibration). `process_exam` glues them together for the router. |
| `backend/app/api/routers/exams.py` | `GET /courses/{id}/exams`, `POST /courses/{id}/exams` (full pipeline), `GET /exams/{id}` (detail), `DELETE /exams/{id}`. Mounted at `/api/v1` because routes span both `/courses/{id}/exams` and `/exams/{id}`. |

#### ✏️ Modified

| File | What changed |
|---|---|
| `backend/app/models/domain.py` | New `Exam`, `ExamQuestion`, `CourseQuestionType` classes; new `exam_lecturers` and `exam_question_topics` Tables. `Course` gets `exams` and `question_types` relationships. |
| `backend/app/main.py` | Mounts the exams router at `/api/v1`. |
| `SYSTEM_ARCHITECTURE.md` | New router/service entries in §5; four constraints in §12 documenting the lazy-companion-PDF and global-difficulty-calibration design. |

### Token cost summary

| Action | Cost |
|---|---|
| Upload one 25-question exam | ~3-6k tokens (extraction) + ~25 × 500 tokens (per-question tagging) ≈ 15k tokens |
| Difficulty recalibration | 0 LLM tokens (pure embedding math) |
| List/read existing exams | 0 LLM tokens (everything is cached on the row) |

### Behaviour and safety notes

- **One PDF per exam.** The companion (blank if user uploaded solved, solved if user uploaded blank) is generated lazily by the Take/Grade flow rather than eagerly at upload — saves tokens for exams nobody ever takes.
- **Tagging upserts the taxonomy.** When the AI picks a topic or question-type that doesn't exist yet (`topic_new` / `question_type_new` in the model output), the new entry is created with `source='exam_inferred'` and joined to the question. The next exam to be tagged sees the expanded list.
- **Difficulty is global within a course.** Centroid is computed across ALL questions of the same type in the course, not just within one exam — so question 3 of exam A is calibrated against question 5 of exam B if they share a question type.
- **Owner-only mutations** (POST/DELETE). Any course reader (owner / member / public-course visitor) can list and read exams.
- **Roll-back on zero questions.** If extraction returns nothing, the exam row is deleted and a 422 is returned — no zombie cards.
- **Duplicate detection deferred** (T-015). Re-uploading the same exam currently produces two rows.

### Phase B / Phase C (next commits)

- **Phase B — UI**: Exams tab on the course page; pie/bar charts for question types and topics; difficulty histogram; table of exams; per-exam detail page.
- **Phase C — Take/Submit/Grade**: `exam_attempts` table; lazy companion-PDF generation; upload-answer form; AI grading using cached `reference_solution`.

---

## 2026-05-06 (later still) — Course Syllabus + course-scoped chat

**Scope:** Backend + frontend. Adds the Syllabus feature to Courses: upload a syllabus, AI extracts structured fields, the course gets a normalized topic taxonomy + lecturer list, and chats opened with course context get the syllabus injected into the system prompt.

### Why this change

The user's design has Courses as the parent of everything else (folders → docs → sessions). For the AI Teacher to answer well *within a course*, it needs to know what's in that course — topics, books, prerequisites, who teaches it, what the grading policy is. Re-discovering that on every turn would be wasteful; one-time extraction + cache is the right shape.

The extracted topic list also seeds the per-course taxonomy that the upcoming Exams feature will use to tag questions, so syllabus has to land first.

### What changed

#### 🆕 Created

| File | Purpose |
|---|---|
| `backend/alembic/versions/k6j7i8h9g0f1_course_syllabus_topics_lecturers.py` | Adds `courses.syllabus_user_document_id` (ON DELETE SET NULL), `courses.syllabus_extracted` JSONB, `course_topics` and `course_lecturers` tables, plus `threads.course_id`. |
| `backend/app/services/syllabus_extractor.py` | `extract_syllabus(text)` runs one Gemini call and returns the canonical structured dict. `build_syllabus_system_block(extracted, title)` formats it into a 300-800-token system-prompt block. |
| `ai-study-client/src/features/courses/components/CourseSyllabusTab.tsx` | Course detail "Syllabus" tab — upload, replace, detach, plus a read-only render of every extracted field (topics, books, lecturers, prerequisites, weekly schedule, grading policy). |

#### ✏️ Modified

| File | What changed |
|---|---|
| `backend/app/models/domain.py` | `Course` gains `syllabus_user_document_id`, `syllabus_extracted`, plus relationships to `topics`, `lecturers`, `syllabus_doc`. New `CourseTopic` and `CourseLecturer` models. `Thread` gains `course_id`. |
| `backend/app/api/routers/courses.py` | New `GET/POST/DELETE /{id}/syllabus` endpoints. `POST` runs the extractor and idempotently upserts topics/lecturers (preserves manually-edited rows and `exam_inferred` entries on re-extraction). |
| `backend/app/services/prompt_builder.py` | `resolve_system_prompt` now takes `course_id`; appends a `## COURSE CONTEXT` block from the cached syllabus extraction whenever course context is set. |
| `backend/app/api/routers/chat.py` | `ChatRequest.course_id` accepted; new threads stamped with it; effective `course_id = thread.course_id ?? payload.course_id` flows into `resolve_system_prompt`. |
| `backend/app/api/routers/threads.py` | `ThreadCreate.course_id` honored on creation. |
| `backend/app/schemas/schemas.py` | `ThreadCreate` and `ThreadResponse` carry `course_id`. |
| `ai-study-client/src/components/layout/MyLibrary.tsx` | Course drilldown becomes a tabbed view (Folders / Syllabus). New "Chat about this course" button. |
| `ai-study-client/src/App.tsx` | New `activeCourseId` state, `handleStartCourseChat(id)` opens a standalone session pinned to that course. `useChat` accepts `activeCourseId` and forwards it on the first standalone-chat call. |
| `ai-study-client/src/hooks/useChat.ts` | Standalone-chat fetch now sends the Bearer token (was silently 401-ing since auth was added to `/chat`) and passes `course_id` for new threads. |
| `ai-study-client/src/services/api.ts` | New `getCourseSyllabus`, `attachCourseSyllabus`, `detachCourseSyllabus` wrappers. |
| `ai-study-client/src/types/course.ts` | New `CourseTopic`, `CourseLecturer`, `SyllabusExtraction`, `CourseSyllabus` interfaces. |

### Token-efficiency design

- **Extraction**: one Gemini call per attach (~3-8k tokens depending on syllabus length). Result cached as JSONB; never re-extracted unless the user explicitly re-attaches.
- **Per-turn cost**: ~300-800 tokens of system-prompt overhead from the formatted block. No further LLM calls for syllabus reading.
- **Anthropic prompt caching deferred** (T-011): the system prompt is currently a single string, so we'd have to refactor `prompt_builder` to return structured blocks before adding `cache_control`. Cheap enough to skip for now.

### Behaviour and safety notes

- `courses.syllabus_user_document_id` uses `ON DELETE SET NULL` — deleting the syllabus document from My Library auto-clears the pointer; the extraction stays cached so the user can re-attach a different file later.
- Topics/lecturers are upserted (UNIQUE on `(course_id, name)`); the Exams feature will rely on this normalization to tag questions.
- Detaching a syllabus clears the cached extraction but never auto-deletes topics/lecturers (they may already be in use).

---

## 2026-05-06 (later) — Course / Session Architecture (Phase 1: schema + backend)

**Scope:** Backend-only. New top-level Course entity, membership/visibility model, and a read-only Sessions API exposing root threads as first-class objects. The frontend lane-based My Library + new sidebar lands in the next commit.

### Why this change

The existing data model collapsed two distinct concepts: "the document I'm studying" and "the chat I'm having about it." We now model them separately so the user can:

- Open a chat without a document (a Session).
- See past sessions as a browsable list with previews (My Library lane + Sessions search).
- Group folders under a Course (Linear Algebra, Operating Systems, …).
- Make a Course public; other users discover and star it from a Courses catalog tab.
- Be assigned to a Course by an admin (e.g. lecturer) without that course being public.

### What changed

#### 🆕 Created

| File | Purpose |
|---|---|
| `backend/alembic/versions/j5i6h7g8f9e0_courses_and_memberships.py` | Migration: `courses`, `course_memberships` (UNIQUE on user+course), `folders.course_id` FK (nullable). |
| `backend/app/api/routers/courses.py` | CRUD + visibility-aware list endpoints + star toggle. |
| `backend/app/api/routers/sessions.py` | List/search/delete root threads as first-class objects with previews. |
| `backend/app/api/routers/library.py` | Tagged-union feed (`kind: 'session' \| 'file'`) for the My Library lane. |

#### ✏️ Modified

| File | What changed |
|---|---|
| `backend/app/models/domain.py` | New `Course` and `CourseMembership` models. `Folder` gains `course_id` (nullable). `User` gains `owned_courses` and `course_memberships` relationships. |
| `backend/app/api/routers/folders.py` | `POST /` and `PUT /{id}` now accept `course_id`; ownership of the target course is enforced. `GET /` accepts `?course_id=N` and `?top_level_only=true` filters. |
| `backend/app/main.py` | Mounts the three new routers under `/api/v1/courses`, `/api/v1/sessions`, `/api/v1/library`. |
| `SYSTEM_ARCHITECTURE.md` | New router/model entries, plus four constraints in §12 documenting the hierarchy and Session = root Thread invariant. |

### Visibility model

`Course.visibility` ∈ {`private`, `admin_assigned`, `public`}. A user sees a course in My Library iff:

- `Course.owner_id == user.id`, OR
- A `CourseMembership` row exists with role `owner` / `admin_assigned` / `starred`.

The public catalog (`GET /courses/public`) lists every public course and computes `is_starred` against the caller's memberships server-side so the frontend can render the toggle without a second round-trip.

### Cross-user safety (consistent with the previous isolation pass)

- All routes 404 (not 403) on cross-user access — no existence leak.
- `DELETE /courses/{id}` detaches contained folders by nulling `course_id`; never cascade-deletes documents or threads.
- `POST /courses/{id}/star` refuses to remove `admin_assigned` memberships — those are out-of-band and can only be revoked by an admin (future work).

### Phase 2 (next commit)

Frontend rebuild:
- Sidebar: `+ New Session` button at top, `Communities (Coming Soon)` placeholder, "Active Session" item removed, "Community" → "Courses" rename.
- My Library: lane-based dashboard (Sessions & Files / Folders / My Courses).
- Sessions search page.
- Standalone chat UI (no PDF panel) for sessions without `document_id`.
- Course create/edit modals + public Courses tab with star toggle.

---

## 2026-05-06 — Multi-Tenant Isolation Hardening + Google Sign-In + Billing Schema

**Scope:** Backend ownership enforcement (3 routers), unique guest accounts, real Google OAuth, frontend GIS integration, and the schema groundwork for token-based credit billing.

### Why this change

Three structural problems blocked the product moving past "demo" status:

1. **Data was leaking between users.** `threads.py` had no auth dependency at all — any logged-in user could enumerate any other user's threads/messages by ID. `personas.py` returned every personal persona to every user. Several `documents.py` summary endpoints accepted requests against any document. `chat.py` could read any thread.
2. **All guests shared one account.** `guest-login` always returned a token for `guest@studyagent.ai`, so every "Continue as guest" reviewer saw every other guest's data.
3. **The Google button was a `console.log`.** No backend route, no client-side OAuth flow.

In addition, the user wants per-account token-usage billing in the medium term. Adding the schema (subscription_tier on users, usage_events table) in the *same* migration as the isolation fix avoids a follow-up migration and means later phases (logging, quota enforcement, Settings UI) are pure-feature additions.

### What changed

#### 🆕 Created

| File | Purpose |
|---|---|
| `backend/app/core/quota_config.py` | Single place to tune subscription tiers, period length (default daily), and credit pricing. Phase 1 ships only the schema; this module is wired in by phase 2. |
| `backend/alembic/versions/i4h5g6f7e8d9_multi_tenant_isolation_and_billing.py` | One migration: adds `users.subscription_tier`, `users.auth_provider`, `users.google_sub`, `threads.user_id`, and the `usage_events` table. Backfills `threads.user_id` from `userdocuments.user_id` so existing chats remain attributable. |
| `backend/tests/test_quota_config.py` | Unit tests for the quota config module (default-tier fallback, tier ladder monotonicity, period sanity). |
| `backend/tests/test_isolation_integration.py` | `@pytest.mark.integration` regression tests proving User A cannot read/edit/delete User B's threads or personas, and that two `/guest-login` calls produce distinct accounts. Run with `--run-integration`. |

#### ✏️ Modified — Backend

| File | What changed |
|---|---|
| `backend/app/models/domain.py` | `User`: new fields `subscription_tier` / `auth_provider` / `google_sub` + `usage_events` relationship. `Thread`: new `user_id` column (direct ownership for both doc-anchored and standalone threads). New `UsageEvent` model — one row per LLM call, indexed on `(user_id, created_at)`. `cost_usd_micros` is BIGINT (aggregating micros across many events overflows INT32 quickly). |
| `backend/app/api/routers/auth.py` | `guest_login` now mints a fresh User per call (UUID-based email, tier=`guest`). New `POST /api/v1/auth/google` verifies a Google ID token via `google-auth`, requires `email_verified`, and either logs in / links / creates the account. `register` records `auth_provider='password'` explicitly. |
| `backend/app/api/routers/threads.py` | All four routes now require `current_user`. New `_get_owned_thread_or_404` and `_assert_owns_userdoc` helpers; cross-user access returns 404 (no existence leak). Thread creation always sets `user_id`. |
| `backend/app/api/routers/chat.py` | Adds `current_user` dep. Thread lookup is filtered by ownership; new threads are stamped with `user_id`. |
| `backend/app/api/routers/documents.py` | The four summary endpoints (`pages/{n}/summary`, `summaries`, `summary/all`, `summary/custom`) now filter `UserDocument` by `(id, user_id)` before doing any work. |
| `backend/app/api/routers/personas.py` | `GET /` returns global + community + the caller's own personal personas. `POST /` rejects non-personal types and stamps `author_id`. `PUT/DELETE` require ownership via `_get_owned_personal_persona`. `clone` of a personal persona is rejected unless the caller already owns it; clones are stamped with the caller's `author_id`. |
| `backend/app/core/config.py` | Adds `GOOGLE_OAUTH_CLIENT_ID` (empty string disables the `/auth/google` endpoint with 503). |
| `backend/app/schemas/schemas.py` | `ThreadCreate.document_id` and `ThreadCreate.page_number` are now `Optional` to match standalone-thread reality. `ThreadResponse.page_number` made `Optional` to match. |
| `backend/pyproject.toml` | Adds `google-auth>=2.35.0` for ID-token verification. |

#### ✏️ Modified — Frontend

| File | What changed |
|---|---|
| `ai-study-client/index.html` | Loads the Google Identity Services SDK (`accounts.google.com/gsi/client`) async. |
| `ai-study-client/src/components/ui/AuthModal.tsx` | Replaces the `console.log` Google placeholder with a real GIS rendered button. Uses a polling effect to wait for the GIS script. On success, exchanges the ID token via `api.googleLogin` and stores the JWT. |
| `ai-study-client/src/services/api.ts` | New `googleLogin(idToken)` method. Adds `updatePersona` / `deletePersona` / `clonePersona` wrappers (the store now uses these instead of raw fetch). |
| `ai-study-client/src/store/useAppStore.ts` | All persona traffic moved from raw `fetch()` (which dropped the auth header) to the Axios `api` client (auth interceptor). Without this change, every persona call would 401 against the now-authenticated backend. |
| `.env.example` | Documents `GOOGLE_OAUTH_CLIENT_ID` (backend) and `VITE_GOOGLE_OAUTH_CLIENT_ID` (frontend) with a setup walkthrough. |

### Behaviour changes

- **The shared `guest@studyagent.ai` user is reclassified to `subscription_tier='guest'`** but is no longer issued tokens — every new guest gets a unique `guest-<uuid>@studyagent.ai` row. Existing tokens for the legacy account remain valid (no forced sign-out).
- **Pre-existing personal personas with `author_id IS NULL`** become invisible to all users. They remain in the DB; clean up by hand if desired (`DELETE FROM personas WHERE persona_type='personal' AND author_id IS NULL`).
- **Pre-existing standalone threads with `document_id IS NULL`** end up with `user_id IS NULL` (no way to derive ownership) and become invisible to all users. Same caveat as above.
- **Cross-user reads return 404, not 403.** Intentional: it does not leak the existence of another user's data to ID-enumeration probes.

### Phase 2 (later) — what this commit set up

This commit ships the schema and isolation. The phases below are pure additions on top:

1. **Logging** — thread `user_id` through `call_llm` / `ask_gemini` and write a `UsageEvent` per LLM call (read tokens from `usage_metadata` on each provider's response).
2. **Quota enforcement** — pre-call check `SUM(credits) WHERE user_id=X AND created_at > NOW() - PERIOD_SECONDS >= tier limit` → 429 if over.
3. **Settings UI** — `GET /api/v1/profile/usage` returning `{tier, used, limit, period_resets_at, by_provider}` + a `<UsageBar />` component.

---

## 2026-05-04 (later) — Vibe-Coding Setup: MCP, Multi-Tool Context, Doc Restructure

**Scope:** Documentation, configuration, and tooling. **Zero application code changes.** No source files in `backend/`, `ai-study-client/`, `alembic/`, `tests/`, `docker-compose.*.yml`, `Dockerfile.*`, `pyproject.toml`, `package.json`, or any application module were modified.

### Why this change

The project is being actively developed with both **Claude Code** and **Gemini CLI**. Three structural problems blocked effective vibe-coding:

1. **No MCP servers configured.** Both AI tools were running blind — no live access to the Postgres schema, no live library docs, no PR/issue context, no browser automation for verifying UI changes.
2. **Contradictory context state.** The previous cleanup (`CHANGES.md` entry below) declared `.context/` defunct, but the directory still existed in the repo with 9 files inside — including `GEMINI_MEGA_CONTEXT.md`, which Gemini CLI was loading as fallback context. Result: Claude and Gemini were reading different stories about the project.
3. **No `GEMINI.md`.** Gemini CLI looks for `GEMINI.md` first; without one, it defaults to whatever it can find. This caused inconsistent behaviour between sessions.

### What changed

#### 🆕 Created

| File | Purpose |
|---|---|
| `.mcp.json` | Project-scoped MCP servers for Claude Code (Postgres, GitHub, Context7, Playwright). Committed to git; secrets via env vars only. |
| `.gemini/settings.json` | Mirror of `.mcp.json` for Gemini CLI. Same 4 servers, Gemini CLI format. |
| `.geminiignore` | Mirror of `.claudeignore` for Gemini CLI. |
| `GEMINI.md` | Symlink to `CLAUDE.md`. One source of truth — no drift between tools. |
| `docs/vision.md` | Long-term product vision (Tracks A–D, marketplace, Personal Meta-Data Namespace, scalability roadmap). Promoted from the deleted `.context/vision.md` and slightly polished. |
| `docs/active_tracker.md` | Slimmed bug/task tracker. Three sections: Awaiting User Confirmation / In Flight / Known Tech Debt. Drops the "✅ Fixed (user confirmed)" history that was bloating context every session — that data lives in git history and the entry below. |
| `backend/CLAUDE.md` | Backend-specific rules (auto-loaded by Claude Code when working in `backend/`). Stack quick-reference, mandatory paths, conventions, common gotchas. |
| `ai-study-client/CLAUDE.md` | Frontend-specific rules. Same structure, frontend stack. |
| `setup-vibe-coding.sh` | Idempotent migration script. Creates `GEMINI.md` symlink, backs up old `.context/`, verifies setup. |

#### ✏️ Modified

| File | What changed |
|---|---|
| `CLAUDE.md` | Full rewrite. Now serves both Claude Code and Gemini CLI (Gemini reads via the symlink). Adds: Session Protocol (start/end of session), MCP Tool Usage section, sub-folder context pointer. The Standing Rule on bug confirmation moved here from `active_tracker.md` so both tools see it on every session. |
| `.claudeignore` | Expanded — added uploads/, log files, build artifacts, IDE dirs, lock files (huge token bloat), `.env.*` patterns, test artifacts. |
| `.gitignore` | Added: `.context.bak/` (created by migration script), `.claude.json` (Claude Code session state), `.gemini/.cache/`. |

#### 🗑️ Deleted

| File | Reason |
|---|---|
| `.context/` (entire directory, 9 files) | Useful content (`vision.md`, `active_tracker.md`) promoted to `docs/`. The rest (`GEMINI_MEGA_CONTEXT.md`, `state.md`, `project-map.md`, `tech_context.md`, `architecture_patterns.md`, `design_system.md`, `naming_conventions.md`) was either stale, duplicated by `SYSTEM_ARCHITECTURE.md`, or contained personal context that doesn't belong in shared repo state. The migration script backs up the old directory to `.context.bak/` (gitignored) before deletion so recovery is trivial. Git history has the originals regardless. |

#### ✅ Untouched (verified identical)

Every file in `backend/`, `ai-study-client/`, `tests/`, `alembic/`, plus all `docker-compose.*.yml`, `Dockerfile.*`, `pyproject.toml`, `package.json`, `package-lock.json`, `uv.lock`, `nginx.conf`, `eslint.config.js`, `tailwind.config.js`, `vite.config.ts`, `tsconfig*.json`, `postcss.config.js`, `run_tests.sh`, `alembic.ini`, and `SYSTEM_ARCHITECTURE.md`. **No application code, build config, or architecture documentation was modified.**

### MCP server choices — why these four

| Server | Package | Why |
|---|---|---|
| **Postgres** | `crystaldba/postgres-mcp` (Docker) | The project has a real schema with pgvector, multi-tenant CAS, alembic migrations. Live schema access kills "the AI invented a column" bugs. **Note:** the original `@modelcontextprotocol/server-postgres` was deprecated July 2025 due to a SQL-injection CVE — Crystal DBA's fork is the actively-maintained replacement and adds index tuning + EXPLAIN plans on top. |
| **GitHub** | `@modelcontextprotocol/server-github` | The project has a `.github/workflows/deploy.yml` and active issues/PRs. Letting the AI see PR context without copy-paste is a major DX win. |
| **Context7** | `@upstash/context7-mcp` | The project uses fast-moving libraries (React 19, FastAPI 0.128+, LangChain, pdfplumber, react-pdf) — training-data API references go stale fast. Context7 pulls live, version-correct docs. |
| **Playwright** | `@playwright/mcp` | The project already has `tests/e2e/auth.spec.ts`. Letting the AI actually drive a browser to verify UI changes closes the "I think it works" → "user confirms it works" loop faster. |

Servers deliberately NOT added: Filesystem (built into Claude Code natively), Sentry/LangSmith (deferred per `docs/vision.md` §8), Linear/Notion/Figma (not used in this project yet). Adding MCPs you can't yet use just bloats the tool router.

### Required environment variables (set in your shell)

```bash
export POSTGRES_MCP_URI='postgresql://user:password@localhost:5433/app_db'
export GITHUB_TOKEN='ghp_your_fine_grained_PAT_here'
```

Both `.mcp.json` and `.gemini/settings.json` reference these by name — no secrets are committed.

### Going forward (updated rules)

- **`SYSTEM_ARCHITECTURE.md`** remains the single source of truth for *what exists today*.
- **`docs/vision.md`** holds *long-term product intent and deferred tech*.
- **`docs/active_tracker.md`** is the *living session-to-session state* — read at start, updated at end. Standing rule: nothing marked `✅ Fixed` without explicit user UI confirmation.
- **`CLAUDE.md` / `GEMINI.md`** hold *cross-cutting rules and conventions*. Sub-folder `CLAUDE.md` files hold *stack-specific rules*.
- **MCP configs**: when adding a new server, update BOTH `.mcp.json` AND `.gemini/settings.json` — keep them in sync.
- **`.claudeignore` / `.geminiignore`**: keep identical content.

---

## 2026-05-04 — Documentation & Repo Hygiene Cleanup

---

### Why This Cleanup Was Done

Before cleanup, the documentation had three structural problems that made it untrustworthy:

1. **Two parallel "main" architecture documents** (`SYSTEM_ARCHITECTURE.md` and `ARCHITECTURE_SUMMARY.md`) with overlapping but not identical content. No clear rule for which one is authoritative, so both drifted and neither was fully accurate.
2. **Dead references in `CLAUDE.md`** pointing to a `.context/` directory and seven files inside it (`design_system.md`, `architecture_patterns.md`, `vision.md`, `state.md`, `tech_context.md`, `project-map.md`, `GEMINI_MEGA_CONTEXT.md`) — none of which exist in the repository.
3. **Outdated and broken `README.md`** — claimed `pip install -r requirements.txt` (the project uses `uv sync` against `pyproject.toml`), referenced `main:app` instead of `app.main:app`, was truncated mid-instruction with no closing code-fence, and had no frontend or Docker section at all.

Two further accuracy issues were also found and fixed:

4. **`SYSTEM_ARCHITECTURE.md` listed only 5 routers** (`auth`, `documents`, `threads`, `personas`, `chat`) when `backend/app/main.py` actually mounts **7** — `folders.py` and `personal_hub.py` had been added to the code without ever being documented.
5. **No record of when or why structural changes happened.** No `CHANGES.md` or equivalent existed.

---

### File-by-File Summary

#### 🗑️ Deleted

| File | Reason |
|---|---|
| `ARCHITECTURE_SUMMARY.md` | Merged into `SYSTEM_ARCHITECTURE.md`. Every unique section preserved verbatim or condensed; nothing lost. See "Where each section ended up" below. |

#### ✏️ Rewritten

| File | What changed |
|---|---|
| `SYSTEM_ARCHITECTURE.md` | Full rewrite. Now the **single source of truth**. New sections folded in from `ARCHITECTURE_SUMMARY.md`: §7 CAS Architecture, §8 Folder Architecture, §10 ADRs (12 entries), §11 Future Roadmap. `folders.py` and `personal_hub.py` newly documented in the Backend File Index. Frontend File Index updated to reflect the actual feature-based DDD layout under `src/features/`. New Table of Contents. |
| `CLAUDE.md` | Removed all references to the non-existent `.context/` directory. Replaced with concrete pointers into `SYSTEM_ARCHITECTURE.md` sections. Added a "Style & Conventions" section. Removed the "MEGA-CONTEXT MAINTENANCE" rule (`GEMINI_MEGA_CONTEXT.md` does not exist). |
| `README.md` | Full rewrite. Fixed the broken `uv pip install -r requirements.txt` instruction (correct command is `uv sync`). Fixed the wrong `uvicorn main:app` (should be `app.main:app`). Added the missing frontend setup section. Added a Docker quick-start (now the recommended path). Added a production-deploy section pointer. Closed all open code-fences. |

#### 🆕 Created

| File | Purpose |
|---|---|
| `CHANGES.md` | This file. Audit trail of the cleanup. |

#### ✅ Untouched (Verified Identical)

Every file in `backend/`, `ai-study-client/`, `tests/`, `alembic/`, plus all `docker-compose.*.yml`, `Dockerfile.*`, `pyproject.toml`, `package.json`, `package-lock.json`, `uv.lock`, `nginx.conf`, `eslint.config.js`, `tailwind.config.js`, `vite.config.ts`, `tsconfig*.json`, `postcss.config.js`, `run_tests.sh`, and `alembic.ini`. **No code, configuration, or build files were modified.**

---

### Where Each Section of the Old `ARCHITECTURE_SUMMARY.md` Ended Up

| Old section | New location in `SYSTEM_ARCHITECTURE.md` |
|---|---|
| §1 Project Vision & Core Mechanics | §1 Project Overview (merged with the existing intro) |
| §2 High-Level Architecture (Monorepo) | §2 Tech Stack & Environment + §4 Directory Tree |
| §3 Infrastructure & Containerization (Docker Compose 3-file) | §2 Tech Stack & Environment (table) |
| §4 Database Design & ORM | §5 Backend File Index (Models subsection) |
| §5 Migrations & Schema Evolution (Alembic) | §5 Backend File Index (alembic/) |
| §6b CAS Pipeline + Table Ownership Model + Future-Proofing Fields | §7 Multi-Tenant CAS Architecture (verbatim) |
| §6c Folder / Course Architecture | §8 Folder / Course Architecture (verbatim) |
| §7 ADRs 1–4 (Local AI, Embeddings, Vector Search, Cloud Provider) | §10 ADRs 1–4 (condensed bullet form, all decisions preserved) |
| §6 Frontend Architecture (DDD) | §6 Frontend File Index (Directory Structure subsection) |
| §7 Extended ADRs 5–9 | §10 ADRs 5–9 |
| §8 Future Roadmap (Phase 2 Marketplace) | §11 Future Roadmap |
| ADRs 10, 10b–10e, 11, 12 | §10 ADRs 10–12 (all sub-ADRs preserved) |

---

### Routers Documented for the First Time

The Backend File Index in `SYSTEM_ARCHITECTURE.md` §5 now correctly lists all 7 mounted routers. Prior to this cleanup, these two were code-only:

**`backend/app/api/routers/folders.py`** → `/api/v1/folders`
- `GET /` — list caller's folders (starred first, then alphabetical)
- `POST /` — create a folder
- `PUT /{id}` — update name / color / `is_starred` / `persona_id`
- `DELETE /{id}` — delete folder; nulls `folder_id` on all its documents (they become "unfiled" rather than orphaned)

**`backend/app/api/routers/personal_hub.py`** → `/api/v1/profile`
- `GET/PUT /profile` — fetch (auto-create on first read) / update user profile
- `GET/POST /profile/courses` — list / add course records
- `PUT/DELETE /profile/courses/{record_id}` — update / delete a single course record
- `DELETE /profile/courses` — wipe all course records (reset)
- `GET/POST /profile/jobs` — list / add job applications
- `PUT /profile/jobs/{job_id}` — update a job application
- `POST /profile/transcript` — parse uploaded BGU-style PDF transcript via `pdfplumber` + `python-bidi` and upsert course records

The corresponding schema file `backend/app/schemas/personal_hub.py` was also added to the Schemas subsection.

---

### What This Cleanup Does NOT Do

To stay strictly inside scope, the following were **not** touched even though they could be improved later:

- The `saveSessionMemory` is local-only constraint (still flagged in §12 of the architecture doc as future work) — the code still does not persist to DB on wrap-up. Fixing that requires a code change.
- Sentry and LangSmith integrations remain stubs in `config.py` and `main.py`. Not activated.
- `docker-compose.prod.yml` still references `ai-study-agent.com` as the hard-coded production domain. The README and architecture doc now use `<your-domain>` placeholders, but the YAML itself was deliberately left alone — that's a config change a deployer must make consciously, not a doc cleanup.
- `nginx.conf` still references `ai-study-agent.com` for the same reason.
- No tests were added or removed.

---

### How to Verify

```bash
# Confirm only doc files changed
diff -rq /path/to/old/repo /path/to/new/repo \
  | grep -v -E '\.md$|^Only in.*: CHANGES\.md$'
# Expected output: empty (no non-doc differences)
```

Or, more simply:

```bash
# Compare line counts of source files before and after
find backend ai-study-client tests alembic -type f \
  \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.yml' -o -name '*.json' \) \
  -exec md5sum {} \; | sort
```

Run on both the original and the cleaned tree — every checksum must be identical.

---

### Going Forward

- **`SYSTEM_ARCHITECTURE.md` is now authoritative.** Update it whenever you add a router, model, hook, component, or change a data flow. The maintenance rule at the top of that file restates this.
- **Add to `CHANGES.md` whenever you do a structural cleanup** (deleting files, renaming things, merging docs). Not needed for normal feature work — that goes in commit messages.
- **Update `CLAUDE.md`** only when project-wide conventions or quality gates change.
