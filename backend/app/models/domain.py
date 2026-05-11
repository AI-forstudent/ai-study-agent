"""
app/models/domain.py
────────────────────
Content-Addressed Storage (CAS) + Multi-Tenant Workspace schema.
Single source of truth for Alembic autogenerate.

Architecture
────────────
• BaseDocument  — the canonical, deduplicated content record (keyed by SHA-256).
• UserDocument  — the per-user workspace replica that links to a BaseDocument.
• Chunks / PageSummaries / LectureVideos belong to BaseDocument (the file itself).
• Threads / StudySessions belong to UserDocument (the user's workspace).

Migration strategy (run once after checkout)
─────────────────────────────────────────────
  cd backend
  uv run alembic upgrade head
"""

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Column, Date, DateTime, Enum, Float,
    ForeignKey, Index, Integer, String, Table, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector

from app.core.database import Base


# ── Persona type values ────────────────────────────────────────────────────
# native_enum=False → VARCHAR in PostgreSQL, avoids CREATE TYPE DDL issues
# with Alembic autogenerate on existing DBs.
PERSONA_TYPE_ENUM = Enum(
    "global", "community", "personal",
    name="persona_type",
    native_enum=False,
)


# ── Multi-tenancy enums (Phase 1 — docs/plans/multi_tenancy.md) ────────────
# These ARE native PostgreSQL ENUMs (`native_enum=True`). They're new types,
# we control the migration that creates them, and we want DB-level value
# enforcement so a typo in `granted_via` fails at write time.
SCOPE_ENUM = Enum(
    "platform", "organization", "community", "course",
    name="scope_enum",
    native_enum=True,
)

ROLE_ENUM = Enum(
    "super_user", "org_admin", "community_admin", "course_admin", "member",
    name="role_enum",
    native_enum=True,
)

GRANT_SOURCE_ENUM = Enum(
    # Phase 7 will `ALTER TYPE grant_source_enum ADD VALUE 'invitation_link'`.
    "admin_ui", "system_default", "super_user_bootstrap",
    name="grant_source_enum",
    native_enum=True,
)


# ══════════════════════════════════════════════════════════════════════════════
# USERS
# ══════════════════════════════════════════════════════════════════════════════

class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    email         = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    is_active     = Column(Boolean, nullable=False, server_default="true")

    # Subscription tier — drives the per-period credit quota.
    # Values: 'guest' | 'free' | 'plus' | 'pro'.  See app.core.quota_config.
    subscription_tier = Column(String, nullable=False, server_default="free")

    # Authentication provider that created/owns this account.
    # Values: 'password' | 'google'.  Determines which login flow is valid.
    auth_provider = Column(String, nullable=False, server_default="password")

    # Stable Google subject identifier (the `sub` claim from a verified ID token).
    # Unique when present; NULL for password accounts.
    google_sub = Column(String, nullable=True, unique=True, index=True)

    # Multi-tenancy "home org" — set on first org-scoped role assignment.
    # NULL when the user has no org-scoped role (or had it revoked); the UI
    # surfaces a "pick a home org" prompt if other org roles still exist.
    home_organization_id = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    user_documents    = relationship("UserDocument", back_populates="owner")
    folders           = relationship("Folder",        back_populates="owner")
    authored_personas = relationship(
        "Persona", back_populates="author",
        foreign_keys="[Persona.author_id]",
    )
    study_sessions    = relationship("StudySession",       back_populates="user")
    academic_profile  = relationship("AcademicProfile",    back_populates="user", uselist=False)
    course_records    = relationship("StudentCourseRecord", back_populates="user")
    job_applications  = relationship("JobApplication",     back_populates="user")
    usage_events      = relationship("UsageEvent",         back_populates="user")
    owned_courses        = relationship(
        "Course",
        back_populates="owner",
        foreign_keys="[Course.owner_id]",
    )
    course_memberships   = relationship("CourseMembership", back_populates="user")
    home_organization    = relationship("Organization", foreign_keys=[home_organization_id])
    role_assignments     = relationship(
        "RoleAssignment",
        back_populates="user",
        foreign_keys="[RoleAssignment.user_id]",
        cascade="all, delete-orphan",
    )


# ══════════════════════════════════════════════════════════════════════════════
# MULTI-TENANCY  (Phase 1 — docs/plans/multi_tenancy.md)
# ══════════════════════════════════════════════════════════════════════════════

class Organization(Base):
    """
    Top-level tenant. A real institution (a university, a school) or the
    catch-all `Default` parking-lot org seeded by the Phase-1 migration to
    hold pre-tenancy users and content. Identified by a URL-safe slug.

    Inside the `Default` org, cross-user visibility is suppressed by `can()`
    (see docs/plans/multi_tenancy.md §3.2c) — `Default` is NOT a collaborative
    tenant, just a holder for legacy user role assignments.
    """
    __tablename__ = "organizations"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String,  nullable=False)
    slug       = Column(String,  nullable=False, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    communities = relationship(
        "Community",
        back_populates="organization",
        cascade="all, delete-orphan",
    )


class Community(Base):
    """
    Sub-grouping inside an Organization (faculty / department / programme /
    cohort). Flat in v1 — no nested sub-communities. A Course belongs to
    exactly one Community.

    `slug` is unique per organization but not globally; URLs follow
    `/<org-slug>/<community-slug>` so collisions across orgs are fine.
    """
    __tablename__ = "communities"

    id              = Column(Integer, primary_key=True, index=True)
    organization_id = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name            = Column(String,  nullable=False)
    slug            = Column(String,  nullable=False)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_communities_org_slug"),
    )

    organization = relationship("Organization", back_populates="communities")


class RoleAssignment(Base):
    """
    Authoritative source of truth for permissions. Each row =
    "user U holds role R at scope (scope_type, scope_id)".

    Higher roles inherit lower-tier capabilities at every nested scope (see
    docs/plans/multi_tenancy.md §3.2). No explicit `member` row is written
    when the user already holds a higher role at or above the course — `can()`
    walks the scope hierarchy at check time.

    A DB CHECK enforces the platform-scope NULL sentinel: `scope_id IS NULL`
    iff `scope_type = 'platform'`.

    `granted_via` records HOW this assignment was created — useful both for
    audit and for telling Phase-1 backfill ('system_default') apart from
    later admin-UI grants ('admin_ui') and from the founding super-user
    bootstrap ('super_user_bootstrap'). Phase 7 adds 'invitation_link' via
    `ALTER TYPE`.
    """
    __tablename__ = "role_assignments"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role        = Column(ROLE_ENUM,         nullable=False)
    scope_type  = Column(SCOPE_ENUM,        nullable=False)
    scope_id    = Column(Integer,           nullable=True)   # NULL only when scope_type='platform'
    granted_by  = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    granted_via = Column(GRANT_SOURCE_ENUM, nullable=False)
    granted_at  = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "user_id", "role", "scope_type", "scope_id",
            name="uq_role_assignments_user_role_scope",
        ),
        CheckConstraint(
            "(scope_type = 'platform' AND scope_id IS NULL) "
            "OR (scope_type <> 'platform' AND scope_id IS NOT NULL)",
            name="ck_role_assignments_platform_null_sentinel",
        ),
        Index("ix_role_assignments_scope", "scope_type", "scope_id"),
    )

    user    = relationship(
        "User",
        back_populates="role_assignments",
        foreign_keys=[user_id],
    )
    granter = relationship("User", foreign_keys=[granted_by])


# ══════════════════════════════════════════════════════════════════════════════
# CONTENT-ADDRESSED STORAGE (CAS)
# ══════════════════════════════════════════════════════════════════════════════

class BaseDocument(Base):
    """
    Canonical, deduplicated content record.
    Primary key is the SHA-256 hash of the raw file bytes.
    If two users upload the same file, only one BaseDocument row is created.

    source_type values : UPLOAD | DRIVE | MOODLE
    doc_type    values : GENERAL | SYLLABUS | EXAM_RAW | EXAM_PROCESSED | LECTURE_TRANSCRIPT
    parent_hash         : links a processed exam back to its raw scan, or a
                          transcript to its source video.
    """
    __tablename__ = "basedocuments"

    hash_id           = Column(String(64), primary_key=True, index=True)
    original_filename = Column(String,     nullable=False)
    file_path         = Column(String,     nullable=True)   # null for Drive/Moodle links
    source_type       = Column(String,     nullable=False, server_default="UPLOAD")
    source_url        = Column(String,     nullable=True)   # external video or Drive file
    doc_type          = Column(String,     nullable=False, server_default="GENERAL")
    parent_hash       = Column(
        String(64), ForeignKey("basedocuments.hash_id"), nullable=True
    )
    global_summary    = Column(Text,  nullable=True)
    # Named "metadata" in DB; doc_metadata as Python attr avoids shadowing Base.metadata
    doc_metadata      = Column("metadata", JSONB, nullable=False, server_default="{}")
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    parent         = relationship(
        "BaseDocument", remote_side="BaseDocument.hash_id",
        foreign_keys=[parent_hash],
    )
    user_documents = relationship("UserDocument", back_populates="base_document")
    chunks         = relationship("Chunk",         back_populates="base_document")
    page_summaries = relationship("PageSummary",   back_populates="base_document")
    lecture_videos = relationship("LectureVideo",  back_populates="base_document")
    sync_indices   = relationship("VideoSyncIndex", back_populates="base_document")


class UserDocument(Base):
    """
    Per-user workspace replica of a BaseDocument.
    Many users can hold a UserDocument pointing to the same BaseDocument;
    deduplication is transparent — content is stored once.

    custom_title     : the name the user gives this file in their library.
    folder_id        : reserved for a future Drive-like folder UI.
    personal_summary : user's own notes or a private AI summary.
    ai_feedback      : structured rating/feedback to improve future AI generation.
    """
    __tablename__ = "userdocuments"

    id               = Column(Integer,    primary_key=True, index=True)
    user_id          = Column(Integer,    ForeignKey("users.id"),              nullable=False)
    base_hash        = Column(String(64), ForeignKey("basedocuments.hash_id"), nullable=False)
    custom_title     = Column(String,     nullable=False)
    folder_id        = Column(Integer,    ForeignKey("folders.id"),            nullable=True)
    is_starred       = Column(Boolean,    nullable=False, server_default="false")
    personal_summary = Column(Text,       nullable=True)
    is_public        = Column(Boolean,    nullable=False, server_default="false")
    ai_feedback      = Column(JSONB,      nullable=True)
    # Denormalized scope (Phase 1). NULL = unfiled/personal document
    # (per A.3). Inherited from the folder when the doc lives in one.
    organization_id  = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    shared_at        = Column(DateTime(timezone=True), nullable=True)
    # Recency-of-use for the My Library Files lane sort. Bumped by the
    # `PATCH /api/v1/documents/{id}/touch` endpoint on every open. NULL
    # until the doc is first opened post-restructure; readers should
    # treat NULL as `created_at` for sorting purposes.
    last_opened_at   = Column(DateTime(timezone=True), nullable=True, index=True)

    owner         = relationship("User",         back_populates="user_documents")
    folder        = relationship("Folder",       back_populates="documents")
    organization  = relationship("Organization", foreign_keys=[organization_id])
    base_document = relationship("BaseDocument", back_populates="user_documents")
    threads       = relationship("Thread",       back_populates="user_document")
    study_sessions = relationship("StudySession", back_populates="user_document")


# ══════════════════════════════════════════════════════════════════════════════
# PERSONAS
# ══════════════════════════════════════════════════════════════════════════════

class Persona(Base):
    __tablename__ = "personas"

    id                     = Column(String,  primary_key=True, index=True)
    display_name           = Column(String,  nullable=False)
    manual_prompt_override = Column(Text,    nullable=True)   # legacy field
    traits                 = Column(JSONB,   nullable=True)
    created_at             = Column(DateTime(timezone=True), server_default=func.now())
    author_id              = Column(Integer, ForeignKey("users.id"),      nullable=True)
    description            = Column(Text,    nullable=True)
    persona_type           = Column(PERSONA_TYPE_ENUM, nullable=False, server_default="global")
    system_prompt          = Column(Text,    nullable=True)
    word_count             = Column(Integer, nullable=False, server_default="0")
    original_persona_id    = Column(String,  ForeignKey("personas.id"),   nullable=True)

    author   = relationship("User",    back_populates="authored_personas",
                            foreign_keys=[author_id])
    original = relationship("Persona", remote_side="Persona.id",
                            foreign_keys=[original_persona_id])
    threads          = relationship("Thread",        back_populates="persona")
    study_sessions   = relationship("StudySession",  back_populates="persona")
    session_memories = relationship("SessionMemory", back_populates="persona")
    folders          = relationship("Folder",        back_populates="persona")


# ══════════════════════════════════════════════════════════════════════════════
# FOLDERS  (course/subject containers — own UserDocuments)
# ══════════════════════════════════════════════════════════════════════════════

class Folder(Base):
    """
    A named container grouping UserDocuments into a course or subject.

    color      : hex or Tailwind color token for UI theming (e.g. "#6366F1").
    is_starred : user can pin important folders to the top.
    persona_id : default AI persona applied when studying from this folder.
    course_id  : optional parent Course. NULL = top-level folder; set =
                 folder lives inside a course in the Library hierarchy.
    """
    __tablename__ = "folders"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"),    nullable=False)
    name       = Column(String,  nullable=False)
    color      = Column(String,  nullable=True)
    is_starred = Column(Boolean, nullable=False, server_default="false")
    persona_id = Column(String,  ForeignKey("personas.id"), nullable=True)
    course_id  = Column(Integer, ForeignKey("courses.id"),  nullable=True, index=True)
    # Denormalized scope (Phase 1). NULL = personal/top-level folder
    # (per A.3 — personal scratchpad scope is always NULL). Populated
    # automatically when a folder is attached to a course.
    community_id    = Column(
        Integer,
        ForeignKey("communities.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    organization_id = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner     = relationship("User",         back_populates="folders")
    persona   = relationship("Persona",      back_populates="folders")
    course    = relationship("Course",       back_populates="folders")
    community = relationship("Community", foreign_keys=[community_id])
    organization = relationship("Organization", foreign_keys=[organization_id])
    documents = relationship("UserDocument", back_populates="folder")


# ══════════════════════════════════════════════════════════════════════════════
# COURSES  (top-level container; can hold many Folders)
# ══════════════════════════════════════════════════════════════════════════════

class Course(Base):
    """
    A Course groups Folders (and through them, documents and study material)
    into a coherent academic unit — e.g. "Linear Algebra 1", "Operating Systems".

    Visibility model
    ────────────────
    • 'private'        : only the owner sees it.
    • 'admin_assigned' : visible to users granted membership by an admin
                         (e.g. a lecturer attaching a class roster).
    • 'public'         : listed in the global Courses tab; any logged-in user
                         can star it to add it to their My Library.

    course_metadata is a JSONB grab-bag for forward-compat (semester, code,
    institution, etc.) so we don't need migrations for cosmetic fields.

    Syllabus
    ────────
    A course can have one syllabus document (a UserDocument) plus a cached
    structured extraction of its contents. The extraction is computed once
    by `services.syllabus_extractor.extract_syllabus()` and reused for every
    course-scoped chat (no further LLM calls).
    """
    __tablename__ = "courses"

    id                          = Column(Integer, primary_key=True, index=True)
    # owner_id stays as a denormalized cache of the primary `course_admin`
    # role assignment. Authoritative source of truth is `role_assignments`;
    # `owner_id` is dropped in Phase 6.
    owner_id                    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Scope columns (Phase 1). Every Course belongs to exactly one Community
    # in v1. organization_id is denormalized from community for fast scoping
    # queries — kept in sync by service-layer writes (never read by app code
    # to make permission decisions, which always go through `can()`).
    community_id                = Column(
        Integer,
        ForeignKey("communities.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    organization_id             = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    title                       = Column(String,  nullable=False)
    description                 = Column(Text,    nullable=True)
    visibility                  = Column(String,  nullable=False, server_default="private")
    color                       = Column(String,  nullable=True)
    icon                        = Column(String,  nullable=True)
    course_metadata             = Column("course_metadata", JSONB, nullable=False, server_default="{}")
    syllabus_user_document_id   = Column(
        Integer,
        ForeignKey("userdocuments.id", ondelete="SET NULL"),
        nullable=True,
    )
    syllabus_extracted          = Column(JSONB, nullable=True)
    created_at                  = Column(DateTime(timezone=True), server_default=func.now())

    owner       = relationship("User", back_populates="owned_courses", foreign_keys=[owner_id])
    community   = relationship("Community", foreign_keys=[community_id])
    organization = relationship("Organization", foreign_keys=[organization_id])
    folders     = relationship("Folder", back_populates="course")
    memberships = relationship("CourseMembership", back_populates="course")
    topics      = relationship("CourseTopic",    back_populates="course",
                               cascade="all, delete-orphan")
    lecturers   = relationship("CourseLecturer", back_populates="course",
                               cascade="all, delete-orphan")
    syllabus_doc = relationship("UserDocument", foreign_keys=[syllabus_user_document_id])
    exams          = relationship("Exam",
                                  back_populates="course",
                                  cascade="all, delete-orphan")
    lectures       = relationship("Lecture",
                                  back_populates="course",
                                  cascade="all, delete-orphan")
    question_types = relationship("CourseQuestionType",
                                  back_populates="course",
                                  cascade="all, delete-orphan")


class CourseTopic(Base):
    """
    Normalized topic taxonomy per course. Seeded from the syllabus extraction
    (source='syllabus'); the Exams feature later inserts new ones with
    source='exam_inferred' when a question doesn't fit any existing topic.

    Topic name is unique within a course (uq_course_topics_course_name).
    """
    __tablename__ = "course_topics"

    id         = Column(Integer, primary_key=True, index=True)
    course_id  = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    name       = Column(String,  nullable=False)
    source     = Column(String,  nullable=False, server_default="syllabus")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    course = relationship("Course", back_populates="topics")


class CourseLecturer(Base):
    """
    Normalized lecturer/TA list per course. Lets analytics later compare
    exam difficulty across lecturers without text-matching unstable strings.
    """
    __tablename__ = "course_lecturers"

    id         = Column(Integer, primary_key=True, index=True)
    course_id  = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    name       = Column(String,  nullable=False)
    email      = Column(String,  nullable=True)
    role       = Column(String,  nullable=False, server_default="lecturer")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    course = relationship("Course", back_populates="lecturers")


class CourseQuestionType(Base):
    """
    Per-course question-type taxonomy (mirrors course_topics in shape).

    Source distinguishes manually-curated entries (typically empty in V1)
    from `inferred` types the AI tagger introduces while processing exams.
    """
    __tablename__ = "course_question_types"

    id         = Column(Integer, primary_key=True, index=True)
    course_id  = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    name       = Column(String,  nullable=False)
    source     = Column(String,  nullable=False, server_default="inferred")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    course = relationship("Course", back_populates="question_types")


# ── Exam M2M association tables ────────────────────────────────────────────
# Created as plain Tables (no extra columns) so SQLAlchemy can treat them
# as pure join tables without a mapped class.

exam_question_topics = Table(
    "exam_question_topics",
    Base.metadata,
    Column("question_id", Integer,
           ForeignKey("exam_questions.id", ondelete="CASCADE"), primary_key=True),
    Column("topic_id", Integer,
           ForeignKey("course_topics.id", ondelete="CASCADE"), primary_key=True),
)

exam_lecturers = Table(
    "exam_lecturers",
    Base.metadata,
    Column("exam_id", Integer,
           ForeignKey("exams.id", ondelete="CASCADE"), primary_key=True),
    Column("lecturer_id", Integer,
           ForeignKey("course_lecturers.id", ondelete="CASCADE"), primary_key=True),
)


class Lecture(Base):
    """
    A learning unit inside a Course (F-031 Phase 1 + F-033 + F-034 multi).

    A Lecture owns four LISTS of sub-resources (F-034) plus a single cached
    unified summary:

    • lecturer_summaries  — many; each owned by a CourseLecturer (nullable).
                            The unified-summary skill consumes ONE of these
                            per generation (chosen by the caller).
    • student_summaries   — many; user-titled summaries from peers / self.
                            The skill IGNORES these.
    • recordings          — many; UserDocument FKs, audio files.
    • notes               — many; UserDocument FKs, PDFs or images.

    The single columns that used to hold these (lecturer_summary,
    student_summaries, recording_user_document_id, notes_user_document_id)
    were dropped in migration v7u8t9s0r1q2 after backfilling existing rows
    into the new tables.
    """
    __tablename__ = "lectures"

    id                          = Column(Integer, primary_key=True, index=True)
    course_id                   = Column(
        Integer,
        ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Denormalized Phase-1 multi-tenant scope. Both NOT NULL — copied from
    # the parent course at insert. Matches the Exam / Folder pattern so
    # `can(user, action, scope)` can walk the same chain in Phase 2.
    community_id                = Column(
        Integer,
        ForeignKey("communities.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    organization_id             = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    title                       = Column(String,  nullable=False)
    lecture_date                = Column(Date,    nullable=True)
    # ── Unified summary cache (F-033) ─────────────────────────────────────
    # `unified_summary` holds the markdown the skill returned. The processing
    # flag toggles while a BackgroundTask is in flight. On failure the error
    # column carries the user-facing message and `unified_summary` is left
    # untouched (we never lose a previously-good summary because the next
    # regeneration crashed).
    unified_summary             = Column(Text,    nullable=True)
    unified_summary_processing  = Column(Boolean, nullable=False, server_default="false")
    unified_summary_error       = Column(Text,    nullable=True)
    unified_summary_generated_at = Column(DateTime(timezone=True), nullable=True)
    created_at                  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at                  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    course                = relationship("Course", back_populates="lectures")
    # F-034 collections — eager-loaded by serializers so a single GET returns
    # the full nested shape the frontend's accordion sidebar needs.
    lecturer_summaries    = relationship(
        "LectureLecturerSummary", back_populates="lecture",
        cascade="all, delete-orphan",
        order_by="LectureLecturerSummary.created_at",
    )
    student_summaries     = relationship(
        "LectureStudentSummary", back_populates="lecture",
        cascade="all, delete-orphan",
        order_by="LectureStudentSummary.created_at",
    )
    recordings            = relationship(
        "LectureRecording", back_populates="lecture",
        cascade="all, delete-orphan",
        order_by="LectureRecording.created_at",
    )
    notes                 = relationship(
        "LectureNote", back_populates="lecture",
        cascade="all, delete-orphan",
        order_by="LectureNote.created_at",
    )


# ── F-034 sub-resources ────────────────────────────────────────────────────

class LectureLecturerSummary(Base):
    """One lecturer-authored summary inside a Lecture (F-034 → F-035).

    F-035: summaries are now PDF uploads. `user_document_id` points at a
    CAS-deduped UserDocument; the summary's content is the PDF itself,
    rendered in the session viewer. The text used by the unified-summary
    skill is extracted from the PDF's chunks (the existing CAS pipeline
    already chunked & embedded the PDF on upload).

    `lecturer_id` points at the course's roster of lecturers (built by the
    syllabus extractor) and may be NULL when the course has none yet."""
    __tablename__ = "lecture_lecturer_summaries"

    id               = Column(Integer, primary_key=True, index=True)
    lecture_id       = Column(
        Integer,
        ForeignKey("lectures.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    lecturer_id      = Column(
        Integer,
        ForeignKey("course_lecturers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    user_document_id = Column(
        Integer,
        ForeignKey("userdocuments.id", ondelete="SET NULL"),
        nullable=True,
    )
    title            = Column(String, nullable=False, server_default="סיכום מרצה")
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    lecture  = relationship("Lecture",        back_populates="lecturer_summaries")
    lecturer = relationship("CourseLecturer")
    user_doc = relationship("UserDocument",   foreign_keys=[user_document_id])


class LectureStudentSummary(Base):
    """A student-/peer-authored summary inside a Lecture (F-034 → F-035).

    Same PDF-backed shape as LectureLecturerSummary. The unified-summary
    skill IGNORES these — they're for the student's own reference only."""
    __tablename__ = "lecture_student_summaries"

    id               = Column(Integer, primary_key=True, index=True)
    lecture_id       = Column(
        Integer,
        ForeignKey("lectures.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_document_id = Column(
        Integer,
        ForeignKey("userdocuments.id", ondelete="SET NULL"),
        nullable=True,
    )
    title            = Column(String, nullable=False, server_default="סיכום תלמיד")
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    lecture  = relationship("Lecture",      back_populates="student_summaries")
    user_doc = relationship("UserDocument", foreign_keys=[user_document_id])


class LectureRecording(Base):
    """An audio recording attached to a Lecture (F-034). The file lives in
    `userdocuments` (CAS-deduped); this row is the per-lecture join row
    plus a display title. ON DELETE SET NULL on the FK so cleaning up the
    library doesn't delete the recording row's metadata."""
    __tablename__ = "lecture_recordings"

    id               = Column(Integer, primary_key=True, index=True)
    lecture_id       = Column(
        Integer,
        ForeignKey("lectures.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_document_id = Column(
        Integer,
        ForeignKey("userdocuments.id", ondelete="SET NULL"),
        nullable=True,
    )
    title            = Column(String, nullable=False, server_default="הקלטה")
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    lecture  = relationship("Lecture",      back_populates="recordings")
    user_doc = relationship("UserDocument", foreign_keys=[user_document_id])


class LectureNote(Base):
    """A notes attachment on a Lecture (F-034). PDF or image. Same shape as
    LectureRecording — only the accept-list at upload time differs."""
    __tablename__ = "lecture_notes"

    id               = Column(Integer, primary_key=True, index=True)
    lecture_id       = Column(
        Integer,
        ForeignKey("lectures.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_document_id = Column(
        Integer,
        ForeignKey("userdocuments.id", ondelete="SET NULL"),
        nullable=True,
    )
    title            = Column(String, nullable=False, server_default="הערות")
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    lecture  = relationship("Lecture",      back_populates="notes")
    user_doc = relationship("UserDocument", foreign_keys=[user_document_id])


class Exam(Base):
    """
    A past-paper uploaded against a course.

    A single user-uploaded PDF backs the exam; the companion (blank-if-uploaded
    -was-solved or solved-if-uploaded-was-blank) is generated lazily by the
    Take/Grade flow and cached on a follow-up column once that work lands.

    `aggregate_difficulty` is a 0..1 mean of the contained question difficulty
    scores; recomputed whenever questions are tagged or new exams arrive in
    the same course.

    `reference_solutions` is a JSON map `{question_number: solution_text}` —
    populated by the AI when the source PDF didn't include solutions.
    """
    __tablename__ = "exams"

    id                       = Column(Integer, primary_key=True, index=True)
    course_id                = Column(
        Integer,
        ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Denormalized scope (Phase 1). Always NOT NULL because every Exam
    # belongs to a Course, and every Course belongs to a Community.
    community_id             = Column(
        Integer,
        ForeignKey("communities.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    organization_id          = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    title                    = Column(String,  nullable=False)
    year                     = Column(Integer, nullable=True)
    # Three independent metadata axes per the user spec (T-020). NEVER
    # concatenate them — `semester` is the academic period, `moed` is the
    # exam sitting, `exam_type` is the kind of test. All optional.
    semester                 = Column(String,  nullable=True)   # 'Fall' | 'Spring' | 'Summer' | 'Other'
    moed                     = Column(String,  nullable=True)   # 'A' | 'B' | 'C' | 'D' | 'Special'
    exam_type                = Column(String,  nullable=True)   # 'midterm' | 'final' | 'quiz' | 'practice' | 'other'
    user_document_id         = Column(
        Integer,
        ForeignKey("userdocuments.id", ondelete="SET NULL"),
        nullable=True,
    )
    has_solutions            = Column(Boolean, nullable=False, server_default="false")
    aggregate_difficulty     = Column(Float,   nullable=True)
    reference_solutions      = Column(JSONB,   nullable=True)
    # Denormalized cache so the polling list endpoint can sort/display
    # without lazy-loading every exam's questions. Updated at the end of
    # `process_exam` and reset by the retry endpoint; cascades take care
    # of the delete path.
    question_count           = Column(Integer, nullable=False, server_default="0")
    # Async-processing state machine. POST /exams creates rows with
    # status='pending', a FastAPI BackgroundTask flips to 'processing' and
    # then to 'completed' or 'failed'. The frontend polls while any exam in
    # the user's list is in 'pending' or 'processing'.
    processing_status        = Column(String,  nullable=False, server_default="pending")
    processing_error         = Column(Text,    nullable=True)
    processed_at             = Column(DateTime(timezone=True), nullable=True)
    created_at               = Column(DateTime(timezone=True), server_default=func.now())

    course      = relationship("Course",       back_populates="exams")
    user_doc    = relationship("UserDocument", foreign_keys=[user_document_id])
    questions   = relationship("ExamQuestion",
                               back_populates="exam",
                               cascade="all, delete-orphan")
    lecturers   = relationship("CourseLecturer", secondary=exam_lecturers)


class ExamQuestion(Base):
    """
    One extracted question from an Exam.

    The `embedding` column powers difficulty calibration — distance from the
    cluster center of same-typed questions in the same course translates to
    a 0..1 difficulty_score. Embeddings are computed at extraction time using
    the Gemini text-embedding-004 model (same one that powers RAG).

    `reference_solution` is the AI's best guess at the correct answer; used
    by the Take/Grade flow to grade student submissions in Phase 3.
    """
    __tablename__ = "exam_questions"

    id                  = Column(Integer, primary_key=True, index=True)
    exam_id             = Column(
        Integer,
        ForeignKey("exams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    question_number     = Column(String,    nullable=False)
    question_text       = Column(Text,      nullable=False)
    page_number         = Column(Integer,   nullable=True)
    question_type_id    = Column(
        Integer,
        ForeignKey("course_question_types.id", ondelete="SET NULL"),
        nullable=True,
    )
    difficulty_score    = Column(Float,     nullable=True)
    embedding           = Column(Vector(768), nullable=True)
    reference_solution  = Column(Text,      nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())

    exam          = relationship("Exam",               back_populates="questions")
    question_type = relationship("CourseQuestionType")
    topics        = relationship("CourseTopic",
                                 secondary=exam_question_topics)


class CourseMembership(Base):
    """
    Edge table mapping a user to a course they can see in My Library.

    role values
    ───────────
    • 'owner'          : creator of the course (also has a row in Course.owner_id —
                         this row is bookkeeping for "appears in My Library").
    • 'admin_assigned' : added by an admin (lecturer / institution operator).
    • 'starred'        : the user starred a public course themselves.

    A user has at most one membership row per course (composite UNIQUE on
    (user_id, course_id)).
    """
    __tablename__ = "course_memberships"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"),    nullable=False, index=True)
    course_id  = Column(Integer, ForeignKey("courses.id"),  nullable=False, index=True)
    role       = Column(String,  nullable=False, server_default="starred")
    # Lets the user hide a course from the default "My Courses" view
    # without unstarring it. Drives the Visible / Hidden collapsibles
    # in the new Courses tabbed page. Indexed on (user_id, is_hidden)
    # for fast partition queries.
    is_hidden  = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user   = relationship("User",   back_populates="course_memberships")
    course = relationship("Course", back_populates="memberships")


# ══════════════════════════════════════════════════════════════════════════════
# THREADS & MESSAGES  (workspace-level — belong to UserDocument)
# ══════════════════════════════════════════════════════════════════════════════

class Thread(Base):
    __tablename__ = "threads"

    id                     = Column(Integer, primary_key=True, index=True)
    # Direct ownership: every Thread is owned by exactly one User. This is
    # the authoritative attribution for both document-anchored and
    # standalone (chat.py) threads. Existing rows are backfilled in
    # migration i4h5g6f7e8d9; orphans remain NULL and are filtered out
    # of every listing/read endpoint (effectively invisible).
    user_id                = Column(Integer, ForeignKey("users.id"),         nullable=True, index=True)
    # document_id → userdocuments.id  (chats belong to the user's workspace)
    document_id            = Column(Integer, ForeignKey("userdocuments.id"), nullable=True)
    parent_thread_id       = Column(Integer, ForeignKey("threads.id"),       nullable=True)
    forked_from_message_id = Column(
        Integer,
        ForeignKey("messages.id", use_alter=True, name="fk_thread_forked_from_message"),
        nullable=True,
    )
    page_number   = Column(Integer, nullable=True)
    coordinates   = Column(JSONB,   nullable=True)
    selected_text = Column(Text,    nullable=True)
    emoji         = Column(String,  nullable=True, default="💬")
    title         = Column(String,  nullable=True)
    # AI-generated collective title for the whole conversation tree
    # (per the locked decision in docs/plans/multi_tenancy.md and the
    # 2026-05-08 library restructure brief — generated once after the
    # first user+assistant exchange, never refreshed). Distinct from
    # `title` which is the per-thread short label (used by the
    # breadcrumb / Miller column tree). Only meaningful on root
    # threads; sub-threads inherit from their root via session_id walk.
    session_title = Column(Text,    nullable=True)
    persona_id    = Column(String,  ForeignKey("personas.id"), nullable=True)
    # Optional course context — when set, the prompt builder injects the
    # course's syllabus summary into the system prompt so the AI Teacher
    # answers within the course's framing.
    course_id     = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    # Optional lecture context (F-033). When set, the prompt builder also
    # injects a "## LECTURE CONTEXT" block from the lecture's cached
    # unified_summary (falling back to lecturer_summary). ON DELETE SET NULL
    # so deleting a lecture preserves the chat history.
    lecture_id    = Column(
        Integer,
        ForeignKey("lectures.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Denormalized scope (Phase 1). NULL when course_id is NULL, i.e. for
    # personal scratchpad threads (per A.3). Populated from course on writes.
    community_id    = Column(
        Integer,
        ForeignKey("communities.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    organization_id = Column(
        Integer,
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    user          = relationship("User")
    user_document = relationship("UserDocument", back_populates="threads")
    persona       = relationship("Persona",      back_populates="threads")
    course        = relationship("Course")
    lecture       = relationship("Lecture")
    community     = relationship("Community",    foreign_keys=[community_id])
    organization  = relationship("Organization", foreign_keys=[organization_id])
    messages      = relationship("Message",      back_populates="thread",
                                 foreign_keys="[Message.thread_id]")
    study_sessions_active = relationship(
        "StudySession", back_populates="active_thread",
        foreign_keys="[StudySession.active_thread_id]",
    )


class Message(Base):
    __tablename__ = "messages"

    id          = Column(Integer, primary_key=True, index=True)
    thread_id   = Column(Integer, ForeignKey("threads.id"), nullable=False)
    role        = Column(String,  nullable=False)   # "user" | "assistant"
    content     = Column(Text,    nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    model_alias = Column(String(16), nullable=True)   # "VOLT" | "SPARK" | …

    thread = relationship("Thread", back_populates="messages",
                          foreign_keys=[thread_id])


# ══════════════════════════════════════════════════════════════════════════════
# CONTENT TABLES  (belong to BaseDocument — the original file)
# ══════════════════════════════════════════════════════════════════════════════

class Chunk(Base):
    __tablename__ = "chunks"

    id          = Column(Integer,    primary_key=True, index=True)
    # base_hash replaces the old integer document_id
    base_hash   = Column(String(64), ForeignKey("basedocuments.hash_id"), nullable=False)
    text        = Column(Text,       nullable=False)
    chunk_index = Column(Integer,    nullable=False)
    page_number = Column(Integer,    nullable=True)
    embedding   = Column(Vector(768))

    base_document = relationship("BaseDocument", back_populates="chunks")


class PageSummary(Base):
    __tablename__ = "page_summaries"

    id          = Column(Integer,    primary_key=True, index=True)
    base_hash   = Column(String(64), ForeignKey("basedocuments.hash_id"), nullable=False)
    page_number = Column(Integer,    nullable=False)
    summary     = Column(Text,       nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    base_document = relationship("BaseDocument", back_populates="page_summaries")


class LectureVideo(Base):
    """A video lecture that accompanies a BaseDocument."""
    __tablename__ = "lecture_videos"

    id              = Column(Integer,    primary_key=True, index=True)
    base_hash       = Column(String(64), ForeignKey("basedocuments.hash_id"), nullable=False)
    video_reference = Column(String(1024), nullable=False)   # URL or platform video ID
    total_duration  = Column(Integer,    nullable=True)       # seconds
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    base_document = relationship("BaseDocument",  back_populates="lecture_videos")
    sync_indices  = relationship("VideoSyncIndex", back_populates="lecture_video")


class VideoSyncIndex(Base):
    """
    Maps a specific PDF page/slide to a time window inside a lecture video.
    Example: page 7 → 14:03–15:20, topics: "Gradient descent, learning rate"
    """
    __tablename__ = "video_sync_index"

    id                = Column(Integer,    primary_key=True, index=True)
    base_hash         = Column(String(64), ForeignKey("basedocuments.hash_id"), nullable=False)
    lecture_video_id  = Column(Integer,    ForeignKey("lecture_videos.id"),     nullable=False)
    page_or_slide_num = Column(Integer,    nullable=False)
    start_time_sec    = Column(Integer,    nullable=False)
    end_time_sec      = Column(Integer,    nullable=False)
    topics_covered    = Column(Text,       nullable=True)

    base_document = relationship("BaseDocument", back_populates="sync_indices")
    lecture_video = relationship("LectureVideo", back_populates="sync_indices")


# ══════════════════════════════════════════════════════════════════════════════
# SESSIONS  (belong to UserDocument workspace)
# ══════════════════════════════════════════════════════════════════════════════

class StudySession(Base):
    """
    One study session: user + optional UserDocument + persona.
    document_id is nullable to support standalone (chat-only) sessions.
    active_thread_id tracks the thread where the user left off.
    """
    __tablename__ = "study_sessions"

    id               = Column(Integer, primary_key=True, index=True)
    user_id          = Column(Integer, ForeignKey("users.id"),          nullable=False)
    document_id      = Column(Integer, ForeignKey("userdocuments.id"),  nullable=True)
    persona_id       = Column(String,  ForeignKey("personas.id"),       nullable=True)
    active_thread_id = Column(Integer, ForeignKey("threads.id"),        nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    last_accessed_at = Column(DateTime(timezone=True),
                              server_default=func.now(), onupdate=func.now())

    user          = relationship("User",         back_populates="study_sessions")
    user_document = relationship("UserDocument", back_populates="study_sessions")
    persona       = relationship("Persona",      back_populates="study_sessions")
    active_thread = relationship("Thread",       back_populates="study_sessions_active",
                                 foreign_keys=[active_thread_id])
    memories      = relationship("SessionMemory", back_populates="session")


class SessionMemory(Base):
    """
    Persisted memory entry written at session wrap-up.
    compression_level: 1 = Deep, 2 = Thematic, 3 = Minimal
    injected_memory_text is prepended to the persona's system_prompt on next load.
    """
    __tablename__ = "session_memories"

    id                   = Column(Integer, primary_key=True, index=True)
    session_id           = Column(Integer, ForeignKey("study_sessions.id"), nullable=False)
    persona_id           = Column(String,  ForeignKey("personas.id"),       nullable=False)
    compression_level    = Column(Integer, nullable=False)   # 1 | 2 | 3
    injected_memory_text = Column(Text,    nullable=False)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("StudySession", back_populates="memories")
    persona = relationship("Persona",      back_populates="session_memories")


# ══════════════════════════════════════════════════════════════════════════════
# PERSONAL HUB  (Track D — student profile, course roadmap, career tracking)
# ══════════════════════════════════════════════════════════════════════════════

# Association table for the self-referential M2M on CourseCatalog.
# Stored as a plain Table (not a mapped class) because it carries no extra columns.
course_prerequisites = Table(
    "course_prerequisites",
    Base.metadata,
    Column("course_id",       Integer, ForeignKey("course_catalog.id"), primary_key=True),
    Column("prerequisite_id", Integer, ForeignKey("course_catalog.id"), primary_key=True),
)


class AcademicProfile(Base):
    """
    One-to-one extension of User for academic identity.
    extra_credits captures out-of-curriculum points (reserve duty, volunteering, etc.).
    social_links is a free-form JSONB dict: {"linkedin": "...", "github": "...", ...}.
    """
    __tablename__ = "academic_profiles"

    id             = Column(Integer, primary_key=True, index=True)
    user_id        = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    university     = Column(String,  nullable=True)
    degree         = Column(String,  nullable=True)
    current_year   = Column(Integer, nullable=True)
    target_gpa     = Column(Float,   nullable=True)   # aspirational goal GPA
    manual_gpa     = Column(Float,   nullable=True)   # user-supplied override of the calculated GPA
    extra_credits  = Column(Float,   nullable=True)
    social_links   = Column(JSONB,   nullable=True)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="academic_profile")


class CourseCatalog(Base):
    """
    Global single source of truth for courses.
    Powers the visual prerequisite skill-tree in the UI.
    icon_name maps to a lucide-react icon string (e.g. "Code", "Database").
    difficulty_rating is a 0–5 float averaged from student submissions (future feature).
    prerequisite_course_numbers stores raw course-number strings parsed from syllabi (e.g. ["104031", "104166"]).
    """
    __tablename__ = "course_catalog"

    id                          = Column(Integer, primary_key=True, index=True)
    name                        = Column(String,  nullable=False)
    department                  = Column(String,  nullable=True)
    credits                     = Column(Float,   nullable=True)
    is_yearly                   = Column(Boolean, nullable=False, server_default="false")
    difficulty_rating           = Column(Float,   nullable=False, server_default="0")
    icon_name                   = Column(String,  nullable=True)
    prerequisite_course_numbers = Column(JSONB,   nullable=True)

    # Self-referential M2M: a course can have many prerequisites, and can itself
    # be a prerequisite for many other courses.
    prerequisites = relationship(
        "CourseCatalog",
        secondary=course_prerequisites,
        primaryjoin="CourseCatalog.id == course_prerequisites.c.course_id",
        secondaryjoin="CourseCatalog.id == course_prerequisites.c.prerequisite_id",
        backref="required_by",
    )

    student_records = relationship("StudentCourseRecord", back_populates="course")


class StudentCourseRecord(Base):
    """
    Links a User to a CourseCatalog entry with their personal progress data.
    status values: 'active' | 'completed' | 'failed'
    exam_date_a / exam_date_b are the scheduled exam sittings (moed A / moed B).
    semester_taken stores the academic semester label parsed from a transcript (e.g. "Spring 2024").
    """
    __tablename__ = "student_course_records"

    id                      = Column(Integer, primary_key=True, index=True)
    user_id                 = Column(Integer, ForeignKey("users.id"),         nullable=False)
    course_id               = Column(Integer, ForeignKey("course_catalog.id"), nullable=False)
    status                  = Column(String,  nullable=False, server_default="active")
    grade                   = Column(Integer, nullable=True)
    semester_taken          = Column(String,  nullable=True)
    exam_date_a             = Column(DateTime(timezone=True), nullable=True)
    exam_date_b             = Column(DateTime(timezone=True), nullable=True)
    is_attendance_mandatory = Column(Boolean, nullable=False, server_default="false")
    created_at              = Column(DateTime(timezone=True), server_default=func.now())

    user   = relationship("User",          back_populates="course_records")
    course = relationship("CourseCatalog", back_populates="student_records")


class JobApplication(Base):
    """
    Tracks a student's job-application pipeline.
    status values: 'applied' | 'interview' | 'offer' | 'rejected' | 'withdrawn'
    debrief_notes stores free-text interview retrospectives.
    is_debrief_public allows sharing the debrief to the Study Commons in future.
    """
    __tablename__ = "job_applications"

    id                = Column(Integer, primary_key=True, index=True)
    user_id           = Column(Integer, ForeignKey("users.id"), nullable=False)
    company           = Column(String,  nullable=False)
    role              = Column(String,  nullable=False)
    status            = Column(String,  nullable=False, server_default="applied")
    application_date  = Column(DateTime(timezone=True), nullable=True)
    debrief_notes     = Column(Text,    nullable=True)
    is_debrief_public = Column(Boolean, nullable=False, server_default="false")
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="job_applications")


# ══════════════════════════════════════════════════════════════════════════════
# USAGE / BILLING  (one row per LLM call — drives quota enforcement and metering)
# ══════════════════════════════════════════════════════════════════════════════

class UsageEvent(Base):
    """
    A single LLM invocation made on behalf of a user.

    Schema notes
    ────────────
    • One row per call. Periodic aggregation is computed by SUM over a time window
      — there is no per-user counter cache. Index on (user_id, created_at) keeps
      the rolling-window query fast.
    • `credits` is the billable unit shown in the UI. The mapping
      (input_tokens, output_tokens, model) → credits is computed at write time
      using app.core.quota_config so price changes never rewrite history.
    • `cost_usd_micros` stores the provider's actual USD cost in millionths
      ($0.000001 units). Integer math avoids float drift in summed reports.
    • `endpoint` distinguishes which feature triggered the call so the UI
      can break down usage by feature ('chat' / 'summary_full' / 'transcript' / …).
    """
    __tablename__ = "usage_events"

    id              = Column(Integer, primary_key=True, index=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    provider        = Column(String, nullable=False)            # 'gemini' | 'openai' | 'anthropic'
    model_alias     = Column(String(16), nullable=True)         # 'VOLT' | 'SPARK' | …
    model_name      = Column(String, nullable=True)             # raw provider model id
    endpoint        = Column(String, nullable=False)            # 'chat' | 'summary_full' | …
    input_tokens    = Column(Integer,    nullable=False, server_default="0")
    output_tokens   = Column(Integer,    nullable=False, server_default="0")
    credits         = Column(Integer,    nullable=False, server_default="0")
    # BIGINT — aggregating micros across many events can exceed INT32 quickly.
    cost_usd_micros = Column(BigInteger, nullable=False, server_default="0")

    user = relationship("User", back_populates="usage_events")
