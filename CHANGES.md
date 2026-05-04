# CHANGES

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
