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
    Boolean, Column, DateTime, Enum, ForeignKey,
    Integer, String, Text,
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

    user_documents    = relationship("UserDocument", back_populates="owner")
    folders           = relationship("Folder",        back_populates="owner")
    authored_personas = relationship(
        "Persona", back_populates="author",
        foreign_keys="[Persona.author_id]",
    )
    study_sessions    = relationship("StudySession", back_populates="user")


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
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    shared_at        = Column(DateTime(timezone=True), nullable=True)

    owner         = relationship("User",         back_populates="user_documents")
    folder        = relationship("Folder",       back_populates="documents")
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
    """
    __tablename__ = "folders"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"),    nullable=False)
    name       = Column(String,  nullable=False)
    color      = Column(String,  nullable=True)
    is_starred = Column(Boolean, nullable=False, server_default="false")
    persona_id = Column(String,  ForeignKey("personas.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner     = relationship("User",         back_populates="folders")
    persona   = relationship("Persona",      back_populates="folders")
    documents = relationship("UserDocument", back_populates="folder")


# ══════════════════════════════════════════════════════════════════════════════
# THREADS & MESSAGES  (workspace-level — belong to UserDocument)
# ══════════════════════════════════════════════════════════════════════════════

class Thread(Base):
    __tablename__ = "threads"

    id                     = Column(Integer, primary_key=True, index=True)
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
    persona_id    = Column(String,  ForeignKey("personas.id"), nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    user_document = relationship("UserDocument", back_populates="threads")
    persona       = relationship("Persona",      back_populates="threads")
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
