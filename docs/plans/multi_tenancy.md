# Multi-Tenancy & Permissions — Plan-First Deliverable (F-017)

> **Status:** ✅ **Decisions locked 2026-05-06.** This document is now the contract for the Phase-1 implementation PR.
> **Drafted:** 2026-05-06.
> **Decisions reviewed:** 2026-05-06 — all 13 Open Questions answered (see §6 Decisions Log at the bottom).

This is the deliverable the user requested in §5 of the 2026-05-06 roadmap dump:
> *"Before writing migration code, please produce: 1) proposed data model, 2) capability matrix, 3) migration plan for existing data, 4) phased rollout plan."*

All four are locked below. Each section's former "Open Questions" block has been replaced with **Decisions (locked)** reflecting the user's final answers. §6 at the bottom is the canonical Decisions Log.

---

## 1. Goals & non-goals

### Goals
- Model real university structure: **Organization → Community → Course → Member**.
- A user holds **many scoped role-assignments** simultaneously (Student in one course, TA in another, Department admin elsewhere).
- All data access is **scoped by org/community/course** at the query layer, not just the UI.
- A **single capability function** (`can(user, action, scope)`) replaces scattered role-string checks.
- Permission checks are **forwards-compatible** — adding "Course Co-Owner" later doesn't require touching every route.

### Non-goals (explicit deferrals to keep v1 shippable)
- **Nested communities** — flat for v1 (a community has zero sub-communities). Add nesting later if a real customer asks.
- **Course offerings / instances per semester** — v1 has one Course row per course; "Spring 2026" lives as plain metadata on the Course or its Folders/Exams. Re-architect once a course is taught by different lecturers in different semesters and we need to keep their materials separate.
- **Cross-listed courses** — a Course belongs to exactly one Community in v1.
- **Org-wide identity SSO / SAML** — out of scope; the existing email/Google login is the only auth.
- **Org-billed plans** — quota/billing stays per-user (existing `users.subscription_tier` pre-work in F-005).

---

## 2. Proposed Data Model

### 2.1 New tables

```
organizations
  id           BIGINT PRIMARY KEY
  name         TEXT NOT NULL
  slug         TEXT UNIQUE NOT NULL                       -- "bgu", "tau", "personal-default"
  created_at   TIMESTAMPTZ DEFAULT now()
  -- INDEX(slug)

communities
  id              BIGINT PRIMARY KEY
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT
  name            TEXT NOT NULL
  slug            TEXT NOT NULL                           -- unique per org
  created_at      TIMESTAMPTZ DEFAULT now()
  UNIQUE(organization_id, slug)
  -- INDEX(organization_id)

role_assignments
  id              BIGINT PRIMARY KEY
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  role            ROLE_ENUM NOT NULL                      -- super_user / org_admin /
                                                          --   community_admin / course_admin / member
  scope_type      SCOPE_ENUM NOT NULL                     -- platform / organization / community / course
  scope_id        BIGINT                                  -- NULL iff scope_type='platform' (CHECK enforced)
  granted_by      BIGINT REFERENCES users(id) ON DELETE SET NULL
  granted_via     GRANT_SOURCE_ENUM NOT NULL              -- admin_ui / system_default / super_user_bootstrap
                                                          --   ('invitation_link' added in Phase 7)
  granted_at      TIMESTAMPTZ DEFAULT now()
  UNIQUE(user_id, role, scope_type, scope_id)
  -- INDEX(user_id, scope_type, scope_id)
  -- INDEX(scope_type, scope_id)                          -- "all admins of community 42"
  -- CHECK ((scope_type = 'platform' AND scope_id IS NULL)
  --     OR (scope_type <> 'platform' AND scope_id IS NOT NULL))   -- A.1 NULL sentinel
```

> **Note — invitations table deferred to Phase 7.** v1 ships with **no email or link invitations**; admins assign roles directly via the admin UI (D.1). The `granted_via` enum on `role_assignments` is forward-shaped so adding `'invitation_link'` later is a non-breaking ALTER. The `invitations` table itself, plus a join `invitation_uses` table for multi-use links, gets added in Phase 7 (§5).

### 2.1b `users` table additions

```
users
  + home_organization_id  BIGINT NULL REFERENCES organizations(id) ON DELETE SET NULL
```

Set on the user's first org-scoped role assignment. Editable in user settings if the user holds roles in multiple orgs. **If the user's last role in their `home_organization_id` is revoked but they still hold roles in other orgs**, the system clears `home_organization_id` to NULL and the next request surfaces a "pick your home org" prompt in the UI. (A.2)

### 2.2 Existing tables — required scope columns

Every "user-owned" table gets denormalized scope ids so queries can be range-scanned by scope without joining all the way up. Denormalization is the right call here because the org/community of a course never changes (we'd revisit if it ever did).

```
courses
  + community_id  BIGINT NOT NULL REFERENCES communities(id) ON DELETE RESTRICT
  -- INDEX(community_id)

folders
  + course_id     -- already exists; nullable
  + organization_id BIGINT NOT NULL                       -- denormalized for fast org-wide queries

userdocuments
  + organization_id BIGINT NOT NULL                       -- denormalized
  -- (folder_id already gets us a course; org is the cheap denormalized lookup)

threads
  + organization_id BIGINT                                -- nullable for the "personal scratchpad" case
  + community_id    BIGINT
  + course_id       BIGINT                                -- already exists

exams                  → community_id, organization_id (denormalized)
personas (community type) → community_id (only for persona_type='community')
folders, courses, exams, threads → all gain an `organization_id` for fast scoping
```

The denormalized `organization_id`/`community_id` columns are **populated by triggers or service-layer writes**, never by the application code directly — that prevents drift.

### 2.3 Enums

```sql
-- PostgreSQL enums (named so future ALTERs are straightforward)
CREATE TYPE scope_enum         AS ENUM ('platform', 'organization', 'community', 'course');
CREATE TYPE role_enum          AS ENUM ('super_user', 'org_admin', 'community_admin', 'course_admin', 'member');
CREATE TYPE grant_source_enum  AS ENUM ('admin_ui', 'system_default', 'super_user_bootstrap');
-- Phase 7: ALTER TYPE grant_source_enum ADD VALUE 'invitation_link';
```

### 2.4 Why denormalize `organization_id` everywhere

Without it:
```sql
-- "all docs in this org" requires a 4-table join every time
SELECT ud.* FROM userdocuments ud
  JOIN folders f ON ud.folder_id = f.id
  JOIN courses c ON f.course_id  = c.id
  JOIN communities cm ON c.community_id = cm.id
  WHERE cm.organization_id = $1
```

With it:
```sql
SELECT * FROM userdocuments WHERE organization_id = $1
-- index range scan, no joins
```

Same logic for community_id on tables that span multiple courses inside one community.

### Decisions (locked) — Section 2

- **A.1 — Platform scope is the NULL sentinel.** `scope_id IS NULL` iff `scope_type = 'platform'`, enforced at the DB level by the CHECK constraint shown above. The pattern is documented inline in the table definition so future readers don't have to grep history.
- **A.2 — `users.home_organization_id` exists, nullable.** Set on first org-scoped role assignment. User-editable in settings if they hold roles in multiple orgs. Cleared to NULL when the user's last role in their home org is revoked → UI surfaces a "pick a new home org" prompt.
- **A.3 — Personal scratchpad scope is always NULL.** Personal data (threads with no course, personal personas) is never tied to an org. Implications baked into the rest of this plan:
  - Personal data **persists** when a user leaves an org.
  - Personal usage is **not billable** to any org.
  - Per-user list/discovery queries must `UNION` org-scoped rows with `WHERE organization_id IS NULL AND user_id = $caller`. This is documented in §3's capability function and tested in Phase 3.

---

## 3. Capability/Permission Matrix

### 3.1 The capability function

All authorization checks go through one function:

```python
# app/services/permissions.py
def can(user: User, action: str, scope: Scope, db: Session) -> bool:
    """Return True iff `user` may perform `action` on the entity in `scope`."""
```

`Scope` is a tagged union: `("platform",) | ("org", id) | ("community", id) | ("course", id)`.

`action` is a verb-noun string from a fixed registry: `"create_course"`, `"delete_course"`, `"upload_exam"`, `"view_course_materials"`, etc. Adding a new action means adding one row to the registry and one row to the matrix below. Routes call `can(user, "delete_course", ("course", course_id), db)` and **never** read `user.role` directly.

### 3.2 Inheritance model

A role assignment at scope X also grants the **lower-tier role** at every nested scope:

| Holds | Implicitly also holds |
|------|----------------------|
| `super_user @ platform` | `org_admin` of every org, `community_admin` of every community, `course_admin` of every course |
| `org_admin @ org=42` | `community_admin` of every community where `community.organization_id = 42`, `course_admin` of every course inside those communities |
| `community_admin @ community=7` | `course_admin` of every course where `course.community_id = 7` |
| `course_admin @ course=N` | `member @ course=N` |
| `member @ course=N` | (no further inheritance) |

`can()` walks the scope hierarchy at check time (course → community → organization → platform) — no explicit `member` rows are written for users who already hold a higher role at or above the course. Per-request memoization keeps repeat checks cheap. **List/discovery queries (e.g. "courses I have access to") must walk the same hierarchy** so a community admin sees every course in their community even without explicit course-level rows. (B.1)

### 3.2b `Course.owner_id` rule (transitional)

Until Phase 6 drops it, `Course.owner_id` is a **denormalized cache of the primary `course_admin` assignment**. The role-assignments table is the **authoritative source of truth**. Whenever the primary course_admin assignment changes, the service layer updates `owner_id` to match. **Never** read `owner_id` to make a permission decision — always go through `can()`. (B.2)

### 3.2c Default-org cross-user isolation (CRITICAL)

The `Default` org (created in §4 migration) is a **parking lot, not a collaborative tenant**. Inside `Default`, role inheritance does NOT confer cross-user visibility:

- An `org_admin @ Default` does NOT see another user's personal threads, personal personas, or unfiled documents.
- The capability function returns `false` for any cross-user read inside `Default`, regardless of role.
- A real org (e.g. `bgu` once it's created in admin UI) gets the full inheritance model.

This rule is encoded in `can()` itself — not just at the route layer — so any future code path automatically inherits the protection. (C.2)

### 3.3 Capability matrix

Rows = actions, columns = roles. **✓** = allowed at the role's own scope. **(scoped)** annotations show whether the role's scope must match the entity's scope.

| Action | super_user | org_admin | community_admin | course_admin | member |
|--------|:-:|:-:|:-:|:-:|:-:|
| create_organization | ✓ | — | — | — | — |
| update_organization | ✓ | ✓ (own) | — | — | — |
| delete_organization | ✓ | — | — | — | — |
| invite_org_admin | ✓ | ✓ (own) | — | — | — |
| create_community | ✓ | ✓ (own org) | — | — | — |
| update_community | ✓ | ✓ (own org) | ✓ (own) | — | — |
| delete_community | ✓ | ✓ (own org) | — | — | — |
| invite_community_admin | ✓ | ✓ (own org) | ✓ (own) | — | — |
| create_course | ✓ | ✓ (own org) | ✓ (own community) | — | — |
| update_course | ✓ | ✓ | ✓ | ✓ (own course) | — |
| delete_course | ✓ | ✓ | ✓ | ✓ (own course) | — |
| invite_course_admin | ✓ | ✓ | ✓ | ✓ (own course) | — |
| invite_student | ✓ | ✓ | ✓ | ✓ (own course) | — |
| upload_course_material | ✓ | ✓ | ✓ | ✓ | — |
| upload_exam | ✓ | ✓ | ✓ | ✓ | — |
| view_course_materials | ✓ | ✓ | ✓ | ✓ | ✓ (member of) |
| start_chat_in_course | ✓ | ✓ | ✓ | ✓ | ✓ (member of) |
| view_own_personas | ✓ | ✓ | ✓ | ✓ | ✓ |
| publish_course_to_org | ✓ | ✓ | ✓ | ✓ (own course) | — |
| publish_course_globally | ✓ | — | — | — | — |
| view_audit_log | ✓ | ✓ (own org) | — | — | — |

### 3.4 Public-content scope

Today `Course.visibility ∈ {private, admin_assigned, public}` is global. New model:

```
course_visibility ∈ {private, community, organization, public}
```

| Visibility | Who can `view_course_materials` |
|-----------|--------------------------------|
| `private` | Owner + explicit memberships only |
| `community` | Anyone with any role-assignment in the same community |
| `organization` | Anyone with any role-assignment in the same organization |
| `public` | Any logged-in user (existing behaviour) |

The existing `course_memberships` table keeps the per-user starring state but is no longer the only access path.

### Decisions (locked) — Section 3

- **B.1 — Implicit member.** Higher roles automatically include lower-role permissions within the same scope. `can()` and list-queries walk the scope hierarchy; no explicit `member` rows are written when the user holds a higher role at/above the course (see §3.2).
- **B.2 — `Course.owner_id` is a denormalized cache.** Role-assignments is the authoritative source of truth; `owner_id` updates whenever the primary `course_admin` assignment changes. Permission decisions never read `owner_id`. Drop the column in Phase 6 (see §3.2b).
- **B.3 — Strict capability enums, organized by domain.** Format `verb_noun_target`. Each domain gets its own enum:
  - `class CourseCapabilities(StrEnum): create_course = "create_course" …`
  - `class ExamCapabilities(StrEnum): upload_exam = "upload_exam" …`
  - `class UserCapabilities(StrEnum): assign_role = "assign_role" …`
  - Every enum member carries a docstring documenting exactly what it gates and which scope it applies to. Typos fail at import time, not at runtime.

---

## 4. Migration Plan (existing data)

### 4.1 What exists today (relevant)

- `users` — every existing user is currently isolated. No org concept.
- `courses` — owned by a user via `Course.owner_id`. Visibility is `private`/`admin_assigned`/`public`.
- `course_memberships` — per-user role on a course: `owner`/`admin_assigned`/`starred`.
- `folders`, `userdocuments`, `threads`, `exams` — all carry `user_id`. None carry org/community.
- `personas` — `persona_type ∈ {global, community, personal}`. The "community" type is unused operationally (no real community_id linkage today).

### 4.2 Migration strategy — "default tenant" backfill

We can't deploy multi-tenancy without picking a home for every existing row. Plan:

**Step 1 — seed only the `Default` org (one Alembic migration).**
```
INSERT INTO organizations (id=1, name='Default', slug='default');
INSERT INTO communities  (id=1, organization_id=1, name='General', slug='general');
```
**No `bgu` (or any other real org) is pre-created.** Real orgs get created later by a Super User via the admin UI when an actual customer signs up. No content-detection heuristics are run. (C.1)

**Step 2 — add scope columns nullable, backfill, then make NOT NULL (a separate Alembic migration each phase to keep rollback safe).**

For each existing course, fold:
```sql
UPDATE courses SET community_id = 1 WHERE community_id IS NULL;
```

For folders, userdocuments, threads, exams: cascade the org/community ids from their course (or fall back to `(1, 1)` for orphans). For personal/standalone threads with `course_id IS NULL`, set `organization_id = NULL` (A.3 personal-scratchpad rule).

**Step 3 — bootstrap the founding Super User.** This step happens **before** any per-user member assignments so the Super User exists by the time we touch the rest of the data:
```sql
-- The single Super User for v1. Hard-coded by email so the migration is
-- deterministic and rerunnable. If the email isn't in `users`, the migration
-- aborts loudly — the user account must exist before this migration runs.
INSERT INTO role_assignments (user_id, role, scope_type, scope_id, granted_via, granted_by)
SELECT u.id, 'super_user'::role_enum, 'platform'::scope_enum, NULL,
       'super_user_bootstrap'::grant_source_enum, NULL
  FROM users u
 WHERE u.email = 'lior.livovsky213@gmail.com';

-- Sanity check — abort the migration if zero rows were inserted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM role_assignments
     WHERE role = 'super_user' AND scope_type = 'platform'
  ) THEN
    RAISE EXCEPTION
      'Super-user bootstrap failed — no row in users with email lior.livovsky213@gmail.com. '
      'Create the account first, then re-run the migration.';
  END IF;
END$$;
```

This is **not** something to do via the admin UI later — there is no admin UI yet, and even when there is, only a Super User can use it to grant Super User. The bootstrap breaks that chicken-and-egg via a one-time hard-coded migration step. The co-founder (and any future Super Users) will be granted via the admin UI by Lior, post-launch.

**Step 4 — every other existing user becomes a regular `member` in `Default`.** No special permissions, no specific community/course assignments:
```sql
INSERT INTO role_assignments (user_id, role, scope_type, scope_id, granted_via)
SELECT u.id, 'member'::role_enum, 'organization'::scope_enum, 1,
       'system_default'::grant_source_enum
  FROM users u
 WHERE u.email <> 'lior.livovsky213@gmail.com'
   AND NOT EXISTS (
     SELECT 1 FROM role_assignments r
      WHERE r.user_id = u.id
   );

-- Set home_organization_id for everyone who got migrated.
UPDATE users SET home_organization_id = 1
 WHERE home_organization_id IS NULL
   AND email <> 'lior.livovsky213@gmail.com';
```

The `Default` org is enforced as a **parking lot, not a collaborative tenant** — see §3.2c. Cross-user visibility within `Default` is suppressed at the `can()` layer, so existing users won't suddenly see each other's data even though they're all in the same org row.

**Step 5 — convert existing course_memberships to role_assignments.** Course owners and admin-assigned users become `course_admin`s; starrers become `member`s (course-scoped). Note: this preserves the *existing* per-course relationships that pre-date multi-tenancy — these courses just live in `Default/General` until a Super User decides to move them under a real community/org via the admin UI:
```sql
-- Each Course.owner_id becomes a course_admin assignment
INSERT INTO role_assignments (user_id, role, scope_type, scope_id, granted_via, granted_at)
SELECT owner_id, 'course_admin'::role_enum, 'course'::scope_enum, id,
       'system_default'::grant_source_enum, created_at
  FROM courses;

-- admin_assigned memberships become course_admin assignments too
INSERT INTO role_assignments (user_id, role, scope_type, scope_id, granted_via)
SELECT user_id, 'course_admin'::role_enum, 'course'::scope_enum, course_id,
       'system_default'::grant_source_enum
  FROM course_memberships
 WHERE role = 'admin_assigned';

-- starred memberships become member assignments (low-tier, used for "my courses" lane)
INSERT INTO role_assignments (user_id, role, scope_type, scope_id, granted_via)
SELECT user_id, 'member'::role_enum, 'course'::scope_enum, course_id,
       'system_default'::grant_source_enum
  FROM course_memberships
 WHERE role = 'starred';
```

**Step 6 — keep `course_memberships` around as a view** for backward compat during the deprecation window, then drop it (along with `Course.owner_id`) once frontend code stops reading them. Both go in Phase 6.

### 4.3 Rollback safety

- Each phase is its own Alembic revision. Revert by `alembic downgrade <prev>`.
- New columns are added nullable first, populated by data migration, then constrained NOT NULL — three revisions per column. This is slow but always reversible without data loss.
- `role_assignments` is additive only — existing `course_memberships` rows aren't deleted until the deprecation window closes.

### Decisions (locked) — Section 4

- **C.1 — Single `Default` org seeded; no pre-created `bgu`.** Real orgs are created via the admin UI by a Super User when a real customer signs up. No content-detection heuristics run during migration.
- **C.2 — Single shared `Default` org.** Inside `Default`, **users do NOT have visibility into each other's data** — `can()` explicitly suppresses cross-user reads/writes when the org is `Default`. `Default` is a parking lot for existing data, not a collaborative tenant.
- **C.3 — `Course.owner_id` kept short-term as denormalized cache.** Drop in Phase 6 (covered by B.2).
- **Special bootstrap:** the user with email `lior.livovsky213@gmail.com` gets the only `super_user @ platform` assignment via the migration itself (Step 3 above) — not via the admin UI. The migration aborts loudly if that account doesn't exist. Co-founder and any future Super Users are added later via the admin UI by Lior.

---

## 5. Phased Rollout Plan

Permissions changes are the highest-risk migration in the codebase — every authenticated route is affected. Plan accordingly: small, individually-shippable, individually-revertable phases, each with its own active_tracker entry.

### Phase 0 — Plan approval (this document)
- Output: user signs off on Sections 2/3/4 and the open questions.
- Gate to Phase 1: explicit "go" from the user.

### Phase 1 — Data model + backfill (no behaviour change)
- Tables: `organizations`, `communities`, `role_assignments`, `invitations`. Enums.
- Backfill: default org/community, port existing `course_memberships` and `Course.owner_id` to `role_assignments`.
- Add nullable scope columns to `courses/folders/userdocuments/threads/exams`, populate, make NOT NULL.
- **Existing routes are unchanged.** They keep reading `Course.owner_id` and `course_memberships`. The new tables are populated but unused.
- Test plan: run integration suite end-to-end against a copy of prod data, diff results.
- Risk: low. Data-only migration, no logic change.

### Phase 2 — Permission service (`can()`) — write-side enforcement only
- Implement `app/services/permissions.py::can(user, action, scope, db)` reading `role_assignments`. Walks the scope hierarchy (course → community → organization → platform) and applies the **Default-org cross-user-isolation rule** from §3.2c.
- Migrate every **write** route (POST/PUT/PATCH/DELETE) to call `can()`. Reads still use existing checks for now.
- Add capability tests — one happy-path **and** one negative-case test per row of the matrix in §3.3 (D.3).
- **Feature flag:** `PERMISSIONS_ENFORCE_WRITES` is read **dynamically at call time**, not at app startup, so flipping it does not require a redeploy. For the **first hour after a flip**, every gated decision is logged (allow + deny) so we can spot mistakes immediately. After the hour, only denies are logged. (D.2)
- Risk: medium. A bug here = unauthorized writes. Mitigated by the dynamic flag + dense logging window.

### Phase 3 — Read-side enforcement
- Add scope-aware filters to every list/get endpoint: `WHERE organization_id = $1`, etc. Personal-scratchpad reads `UNION` rows where `organization_id IS NULL AND user_id = $caller` (per A.3).
- Inside `Default`, list endpoints additionally filter to `user_id = $caller` regardless of role (per C.2 / §3.2c).
- Keep returning 404 (not 403) for cross-scope reads to avoid existence leaks (matches existing convention).
- **Feature flag:** `PERMISSIONS_ENFORCE_READS`, same dynamic-read + first-hour-dense-log pattern as Phase 2.
- One-week shadow mode: the new filter runs alongside the old one; results are compared and logged but the old result is what's served. After a clean week, flip the flag for real.
- Risk: medium-high. A bug here = data leak across orgs. Mitigated by shadow mode + dynamic flag.

### Phase 4 — UI for owners/users (course/community/org views)
- "Org settings" page (org_admin+): basic org info, list of communities, list of members + their roles.
- "Community settings" page (community_admin+): basic info, list of courses, list of members + their roles.
- "Course settings" page (course_admin+): replaces the existing `is_owner` boolean check in MyLibrary's course drilldown.
- Public Courses tab: visibility filter dropdown (private / community / organization / public).
- **No banner explaining the change** — there are no existing collaborative users to confuse; the new model is what everyone sees from day one. (D.4)
- Risk: low. Pure additive UI; depends on Phase 2/3 backend.

### Phase 5 — Centralized Admin Management UI (NO email/link invitations)
- A single admin section, scoped by what the caller can manage:
  - **Super User:** create/delete users, create/delete orgs and communities, assign/revoke any role at any scope, move users between orgs/communities/courses.
  - **Org Admin:** within their org only — create/delete communities, assign/revoke `community_admin` and lower roles. Cannot touch other orgs.
  - **Community Admin:** within their community only — assign/revoke `course_admin` and lower roles. Cannot touch other communities.
  - **Course Admin:** within their course only — add/remove `member`s.
- The pattern: **each admin can only manage scopes they have admin rights over. Never wider.** Enforced in `can()` itself, not just the UI.
- Endpoints: `POST /api/v1/admin/role-assignments`, `DELETE /api/v1/admin/role-assignments/{id}`, plus user/org/community/course CRUD restricted by scope.
- All assignments created here use `granted_via = 'admin_ui'`.
- **No email infrastructure required for v1.** No `invitations` table is created in this phase.
- Risk: medium. Mostly UI work + careful capability checks on the new admin endpoints. (D.1)

### Phase 6 — Cleanup & deprecation
- Drop `Course.owner_id` (now that the UI no longer reads it).
- Drop `course_memberships` (replaced by `role_assignments`).
- Remove the `PERMISSIONS_ENFORCE_*` feature flags (they've been on for weeks at this point).
- Update `SYSTEM_ARCHITECTURE.md` with the final model.

### Phase 7 — Shareable invitation links (post-launch enhancement)
- Adds the `invitations` and `invitation_uses` tables (forward-shape already noted in §2.1):
  ```
  invitations
    id              BIGINT PK
    token           TEXT UNIQUE NOT NULL                   -- random URL-safe
    role            ROLE_ENUM NOT NULL
    scope_type      SCOPE_ENUM NOT NULL
    scope_id        BIGINT
    inviter_id      BIGINT NOT NULL REFERENCES users(id)
    expires_at      TIMESTAMPTZ NOT NULL
    max_uses        INTEGER                                -- NULL = unlimited; 1 = single-use
    use_count       INTEGER NOT NULL DEFAULT 0
    revoked_at      TIMESTAMPTZ
    created_at      TIMESTAMPTZ DEFAULT now()

  invitation_uses
    id              BIGINT PK
    invitation_id   BIGINT NOT NULL REFERENCES invitations(id) ON DELETE CASCADE
    user_id         BIGINT NOT NULL REFERENCES users(id)
    used_at         TIMESTAMPTZ DEFAULT now()
    UNIQUE(invitation_id, user_id)                          -- one user can't double-redeem
  ```
- A Super User or any-level Admin generates a link bound to a specific scope/role; clicking it auto-assigns the joiner to that scope/role.
- `ALTER TYPE grant_source_enum ADD VALUE 'invitation_link';` — assignments created via this flow get `granted_via = 'invitation_link'` and a forward-added `invitation_id` FK on `role_assignments`. Both are non-breaking schema changes thanks to the forward-shape in §2.1.
- Replaces the manual-management ceiling once it bites.
- Still no email infrastructure required (links are shared via whatever channel the admin chooses).

### Estimated effort (rough — for sequencing, not for commitment)

| Phase | Backend | Frontend | Notes |
|------:|--------:|---------:|-------|
| 1 | 1.5d | — | Pure data migration + Lior super_user bootstrap. |
| 2 | 2d | — | Enforce writes; ~30 routes touched. |
| 3 | 2d | 0.5d | Scope filters + Default isolation; some UI revisions for empty states. |
| 4 | 0.5d | 3d | Three settings pages. |
| 5 | 2d | 3d | Admin management UI (no email infra). |
| 6 | 1d | 0.5d | Cleanup. |
| 7 | 1.5d | 2d | Shareable invitation links — post-launch, only when manual management ceiling bites. |

**Total through Phase 6: ~9 dev-days backend, ~7 dev-days frontend.** Phase 7 is deferred and only built when needed.

### Phase 2 readiness gate (locked)

Before flipping `PERMISSIONS_ENFORCE_WRITES` on in production:

- ✅ **100% capability-matrix test coverage** — one happy-path **and** one negative-case test per row in §3.3.
- ✅ **Written manual verification checklist run end-to-end:**
  - Super User uses the admin UI to create / modify / delete users, orgs, communities, and role assignments.
  - Org Admin can manage within their org but **not** other orgs (negative test verified).
  - Community Admin can manage within their community but **not** other communities (negative test verified).
  - Course Admin can manage within their course but **not** other courses (negative test verified).
  - Regular member can do member things but **not** admin things (negative test verified).
  - Inside `Default`, an Org Admin cannot read another user's threads/personas/documents (negative test verified — this is the §3.2c rule).
- ✅ **Zero new errors in production logs for 24h** after the enforcement code is merged with the flag still off (i.e. shadow-mode is clean).
- ✅ **Documented one-step rollback:** flip `PERMISSIONS_ENFORCE_WRITES` back to `false`. No deploy required (D.2).

The same gate template is reused for Phase 3 (`PERMISSIONS_ENFORCE_READS`).

### Decisions (locked) — Section 5

- **D.1 — No email/link invitations in v1.** Phase 5 is the centralized admin management UI; Phase 7 (post-launch) adds shareable invitation links. No email provider is needed for v1.
- **D.2 — Plain env-var feature flags, read dynamically at call time.** Flipping a flag never requires a redeploy. The first hour after each flip logs every gated decision (allow + deny); after the hour, only denies are logged.
- **D.3 — Phase 2 readiness gate** locked above (100% matrix coverage + manual checklist + 24h clean logs + one-step rollback).
- **D.4 — No day-1 banner.** There are no collaborative users to confuse; the new model is what everyone sees from day one.

---

## 6. Decisions Log (canonical)

All 13 Open Questions answered 2026-05-06. This list supersedes any "Recommendation" text earlier in the doc; if there's a conflict, this section wins.

| # | Topic | Decision |
|---|-------|----------|
| **A.1** | Platform scope shape | NULL sentinel (`scope_id IS NULL` iff `scope_type='platform'`), enforced by DB CHECK constraint. |
| **A.2** | `users.home_organization_id` | Add nullable column. Set on first org-scoped role assignment. User-editable in settings. Cleared to NULL when last role in home org is revoked → UI prompts user to pick a new home org. |
| **A.3** | Personal scratchpad scope | Always `organization_id IS NULL`. Personal data persists across org changes, isn't billable to an org, and per-user list queries `UNION` org-scoped + NULL-scoped rows. |
| **B.1** | Implicit member | Higher roles automatically include lower-role permissions in the same scope. `can()` and list-queries walk the scope hierarchy course → community → org → platform. |
| **B.2** | `Course.owner_id` | Denormalized cache of the primary `course_admin` assignment. Role-assignments is authoritative. Permission decisions never read `owner_id`. Drop in Phase 6. |
| **B.3** | Capability enums | Strict, format `verb_noun_target`, organized by domain (`CourseCapabilities`, `ExamCapabilities`, `UserCapabilities`, …). Every member carries a docstring describing exactly what it gates. |
| **C.1** | Migration org seeding | Single `Default` org only. No `bgu` (or any other real org) pre-created. Real orgs are created later via the admin UI by a Super User. |
| **C.2** | Per-user vs. shared `Default` | Single shared `Default`. **Critical:** inside `Default`, cross-user visibility is suppressed by `can()` itself — `Default` is a parking lot, not a collaborative tenant. |
| **C.3** | Drop `Course.owner_id` immediately? | No — keep short-term as a denormalized cache; drop in Phase 6. |
| **C★** | Super-user bootstrap | `lior.livovsky213@gmail.com` is granted `super_user @ platform` as part of the Phase-1 migration itself (§4 Step 3). The migration aborts loudly if that account doesn't exist. Co-founder + future Super Users are added later via the admin UI. |
| **D.1** | Invitations | **No email/link invitations in v1.** Phase 5 ships a centralized admin management UI where each admin can manage only the scopes they have admin rights over (never wider). Phase 7 adds shareable invitation links post-launch when manual management bites; the data model is forward-shaped (`granted_via` enum) so Phase 7 needs no breaking schema changes. |
| **D.2** | Feature flags | Plain env vars (`PERMISSIONS_ENFORCE_WRITES`, `PERMISSIONS_ENFORCE_READS`), read **dynamically at call time** so flipping doesn't require a redeploy. First hour after each flip logs every gated decision; after the hour, only denies are logged. |
| **D.3** | Phase 2 readiness gate | 100% capability-matrix test coverage (happy + negative per row) · written manual verification checklist (Super/Org/Community/Course Admin/Member positives + negatives, plus Default-isolation) · 24h zero new errors with the flag still off · documented one-step rollback (flip the env var back). Same template applies to Phase 3. |
| **D.4** | Day-1 banner | No banner. There are no collaborative users to confuse; the new model is what everyone sees from day one. |

Once you've read this log and the doc above, the next move is approving the Phase-1 implementation PR.
