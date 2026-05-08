"""
app/api/routers/documents.py
─────────────────────────────
Document upload, listing, deletion, visibility, and page summaries.

CAS (Content-Addressed Storage) architecture:
  • BaseDocument  — one row per unique file, keyed by SHA-256 hash.
  • UserDocument  — one row per (user, file) pair; the workspace replica.

Upload deduplication flow:
  1. Hash the file bytes (SHA-256).
  2. If BaseDocument(hash_id) exists AND user already has a UserDocument for
     that hash → 409 DOCUMENT_ALREADY_EXISTS_FOR_USER.
  3. If BaseDocument exists but user does NOT have it → create UserDocument
     only (skip re-processing and re-embedding).
  4. If BaseDocument does NOT exist → full pipeline (save file, extract,
     embed, create BaseDocument + UserDocument + Chunks).

Delete cascade:
  Delete UserDocument → delete its Threads/Messages.
  Only delete BaseDocument + Chunks + PageSummaries + file when no other
  UserDocument references the same base_hash.

NOTE: GET /public must be registered before GET /{document_id} so FastAPI
matches the literal path first.

Mounted at /api/v1/documents in app/main.py.
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import (
    BaseDocument, Chunk, Course, Exam, Folder, Message, PageSummary,
    Persona, Thread, User, UserDocument,
)
from app.schemas.schemas import (
    CustomSummaryRequest,
    DocumentResponse,
    FullSummaryResponse,
    PageSummaryResponse,
    PublicDocumentResponse,
    VisibilityUpdate,
)
from app.services.permissions import (
    DEFAULT_ORG_ID, DocumentCapabilities, Scope, gate_or_403,
)
from app.services.document_service import (
    CODE_EXTENSIONS,
    convert_to_pdf,
    extract_text,
    extract_text_from_pdf,
    extract_text_from_word,
    generate_code_review,
    generate_code_summary,
    generate_custom_summary,
    generate_document_summary,
    generate_full_document_summary,
    generate_specific_page_summary,
    get_embedding_model,
    split_text_into_chunks,
)

router = APIRouter(tags=["documents"])

UPLOADS_DIR = "uploads"


def _build_doc_response(ud: UserDocument) -> DocumentResponse:
    """Construct the composite DocumentResponse from a loaded UserDocument."""
    bd = ud.base_document
    return DocumentResponse(
        id=ud.id,
        user_id=ud.user_id,
        title=ud.custom_title,
        is_public=ud.is_public,
        is_starred=ud.is_starred,
        folder_id=ud.folder_id,
        shared_at=ud.shared_at,
        created_at=ud.created_at,
        last_opened_at=ud.last_opened_at,
        file_path=bd.file_path if bd else None,
        base_hash=bd.hash_id if bd else "",
        doc_type=bd.doc_type if bd else "GENERAL",
        global_summary=bd.global_summary if bd else None,
    )


# ── List ────────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[DocumentResponse])
def get_user_documents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the caller's UserDocuments for the My Library Files lane.

    Excludes UserDocuments that are course-attached source files — i.e. the
    underlying file rows for an Exam (`Exam.user_document_id`) or a Course
    syllabus (`Course.syllabus_user_document_id`). Those documents already
    surface inside the course's Exams / Syllabus tabs; double-showing them
    in My Library → Files is just noise (B-014).

    The exam-upload pipeline currently writes its source file with
    `BaseDocument.doc_type = 'GENERAL'`, so a filter on `doc_type` alone
    isn't enough — we have to consult the `exams` and `courses` tables.
    """
    exam_doc_ids = (
        db.query(Exam.user_document_id)
        .filter(Exam.user_document_id.isnot(None))
        .subquery()
    )
    syllabus_doc_ids = (
        db.query(Course.syllabus_user_document_id)
        .filter(Course.syllabus_user_document_id.isnot(None))
        .subquery()
    )

    user_docs = (
        db.query(UserDocument)
        .filter(
            UserDocument.user_id == current_user.id,
            ~UserDocument.id.in_(db.query(exam_doc_ids)),
            ~UserDocument.id.in_(db.query(syllabus_doc_ids)),
        )
        .order_by(UserDocument.created_at.desc())
        .all()
    )
    return [_build_doc_response(ud) for ud in user_docs]


# ── Upload (CAS deduplication) ───────────────────────────────────────────────

@router.post("/", response_model=DocumentResponse)
def upload_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    generate_summary: bool = Form(False),
    persona_id: str = Form(None),
    folder_id: Optional[int] = Form(None),
    is_starred: bool = Form(False),
    db: Session = Depends(get_db),
):
    # Phase 2 gate. Uploaded docs are owned by the uploader; in v1 they
    # land under the user's home org (Default). Once Phase 5 lets users
    # belong to real orgs the scope here will derive from `folder_id`'s
    # course chain when a folder is supplied.
    gate_or_403(
        current_user, DocumentCapabilities.upload_document,
        Scope.organization(DEFAULT_ORG_ID), db,
        owner_id=current_user.id,
    )

    if persona_id and not db.query(Persona).filter(Persona.id == persona_id).first():
        raise HTTPException(status_code=404, detail="PERSONA_NOT_FOUND")

    # ── 0. Validate file extension ───────────────────────────────────────────
    # AUDIO + IMAGE were added for the Lecture feature (F-031). They share
    # the same CAS storage path as text docs but skip the extract → chunk →
    # embed pipeline below (no readable text). Phase 2 will run AUDIO files
    # through Gemini's audio API for transcription.
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".flac"}
    IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
    if ext in (".pdf", ".docx", ".pptx"):
        doc_type = "GENERAL"
    elif ext in CODE_EXTENSIONS:
        doc_type = "SOURCE_CODE"
    elif ext in AUDIO_EXTENSIONS:
        doc_type = "AUDIO"
    elif ext in IMAGE_EXTENSIONS:
        doc_type = "IMAGE"
    else:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{ext}'. Upload a PDF, Word/PowerPoint, source code, audio recording, or image.",
        )

    # ── 1. Hash ─────────────────────────────────────────────────────────────
    file_bytes = file.file.read()
    hash_id = hashlib.sha256(file_bytes).hexdigest()

    # ── 2. Check BaseDocument ────────────────────────────────────────────────
    base_doc = db.query(BaseDocument).filter(BaseDocument.hash_id == hash_id).first()

    if base_doc:
        # Content already indexed — check user ownership
        existing_ud = (
            db.query(UserDocument)
            .filter(
                UserDocument.user_id == current_user.id,
                UserDocument.base_hash == hash_id,
            )
            .first()
        )
        if existing_ud:
            # Structured detail so the chat-attach orchestrator (F-020) can
            # attach the existing doc transparently instead of bailing with
            # a generic error. The My Library upload handler still gets a
            # 409 status to show its "already in library" toast — it never
            # parsed the detail string.
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "DOCUMENT_ALREADY_EXISTS_FOR_USER",
                    "existing_user_document_id": existing_ud.id,
                },
            )

        # New user for an already-processed file — workspace replica only
        user_doc = UserDocument(
            user_id=current_user.id,
            base_hash=hash_id,
            custom_title=filename,
            folder_id=folder_id,
            is_starred=is_starred,
        )
        db.add(user_doc)
        db.commit()
        db.refresh(user_doc)
        return _build_doc_response(user_doc)

    # ── 3. Full pipeline for a brand-new file ────────────────────────────────
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    # Prefix with first 16 hex chars to prevent filename collisions
    safe_filename = f"{hash_id[:16]}_{filename}"
    file_location = f"{UPLOADS_DIR}/{safe_filename}"
    with open(file_location, "wb") as buffer:
        buffer.write(file_bytes)

    # Office formats: extract raw text first, then convert to PDF for display.
    # PPTX has no dedicated text extractor — convert first, then read the PDF.
    # AUDIO / IMAGE: store the file as-is, skip text extraction. Phase 2 of
    # F-031 will run AUDIO through Gemini transcription before chunking; for
    # now these uploads carry zero chunks and that's fine — the chat-search
    # path filters them out via doc_type.
    if doc_type in ("AUDIO", "IMAGE"):
        pages_data: list[dict] = []
        display_path = file_location
    elif ext == ".docx":
        pages_data = extract_text_from_word(file_location)
        try:
            display_path = convert_to_pdf(file_location, UPLOADS_DIR)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"PDF conversion failed: {e}")
    elif ext == ".pptx":
        try:
            display_path = convert_to_pdf(file_location, UPLOADS_DIR)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"PDF conversion failed: {e}")
        pages_data = extract_text_from_pdf(display_path)
    else:
        pages_data = extract_text(file_location)
        display_path = file_location

    full_text = "\n".join(p["text"] for p in pages_data)

    root_summary = None
    if generate_summary:
        summarise_fn = generate_code_summary if doc_type == "SOURCE_CODE" else generate_document_summary
        raw = summarise_fn(full_text)
        if isinstance(raw, list):
            root_summary = "\n\n".join(
                item.get("text", "") for item in raw
                if isinstance(item, dict) and item.get("type") == "text"
            )
        else:
            root_summary = str(raw) if not isinstance(raw, str) else raw

    # ── 4. Persist BaseDocument ──────────────────────────────────────────────
    base_doc = BaseDocument(
        hash_id=hash_id,
        original_filename=filename,
        file_path=display_path,  # PDF path for docx/pptx; original path for others
        source_type="UPLOAD",
        doc_type=doc_type,
        global_summary=root_summary,
    )
    db.add(base_doc)
    db.flush()  # register hash_id before Chunk FKs reference it

    # ── 5. Persist UserDocument ──────────────────────────────────────────────
    user_doc = UserDocument(
        user_id=current_user.id,
        base_hash=hash_id,
        custom_title=filename,
        folder_id=folder_id,
        is_starred=is_starred,
    )
    db.add(user_doc)
    db.commit()
    db.refresh(user_doc)

    # ── 6. Embed chunks keyed to BaseDocument ────────────────────────────────
    embedding_model = get_embedding_model()
    chunk_counter = 0
    for page in pages_data:
        page_chunks_text = split_text_into_chunks(page["text"])
        if not page_chunks_text:
            continue
        vectors = embedding_model.embed_documents(page_chunks_text)
        for i, chunk_text in enumerate(page_chunks_text):
            vector_data = vectors[i].tolist() if hasattr(vectors[i], "tolist") else vectors[i]
            db.add(Chunk(
                base_hash=hash_id,
                text=chunk_text,
                chunk_index=chunk_counter,
                page_number=page["page_number"],
                embedding=vector_data,
            ))
            chunk_counter += 1
    db.commit()

    return _build_doc_response(user_doc)


# ── Public gallery (must precede /{document_id}) ─────────────────────────────

@router.get("/public", response_model=List[PublicDocumentResponse])
def get_public_documents(db: Session = Depends(get_db)):
    user_docs = (
        db.query(UserDocument)
        .filter(UserDocument.is_public == True)
        .order_by(UserDocument.shared_at.desc())
        .all()
    )
    return [
        PublicDocumentResponse(
            id=ud.id,
            title=ud.custom_title,
            summary=ud.base_document.global_summary if ud.base_document else None,
            is_public=ud.is_public,
            shared_at=ud.shared_at,
            owner_email=ud.owner.email,
        )
        for ud in user_docs
    ]


# ── Per-document operations ──────────────────────────────────────────────────

@router.delete("/{document_id}")
def delete_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_doc = (
        db.query(UserDocument)
        .filter(
            UserDocument.id == document_id,
            UserDocument.user_id == current_user.id,
        )
        .first()
    )
    if not user_doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Phase 2 gate.
    gate_or_403(
        current_user, DocumentCapabilities.delete_document,
        Scope.organization(user_doc.organization_id or DEFAULT_ORG_ID), db,
        owner_id=user_doc.user_id,
    )

    base_hash = user_doc.base_hash

    # Null circular FK cycles before deleting threads
    db.query(Thread).filter(Thread.document_id == document_id).update(
        {"forked_from_message_id": None, "parent_thread_id": None},
        synchronize_session=False,
    )
    db.flush()

    thread_ids = db.query(Thread.id).filter(Thread.document_id == document_id)
    db.query(Message).filter(Message.thread_id.in_(thread_ids)).delete(synchronize_session=False)
    db.query(Thread).filter(Thread.document_id == document_id).delete(synchronize_session=False)

    db.delete(user_doc)
    db.flush()

    # Delete BaseDocument + content only when no other user holds a reference
    remaining = (
        db.query(UserDocument)
        .filter(UserDocument.base_hash == base_hash)
        .count()
    )
    file_path: str | None = None
    if remaining == 0:
        base_doc = db.query(BaseDocument).filter(BaseDocument.hash_id == base_hash).first()
        if base_doc:
            file_path = base_doc.file_path
            db.query(Chunk).filter(Chunk.base_hash == base_hash).delete(synchronize_session=False)
            db.query(PageSummary).filter(PageSummary.base_hash == base_hash).delete(synchronize_session=False)
            db.delete(base_doc)

    db.commit()

    if file_path:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception as e:
            print(f"[WARNING] Could not delete file {file_path}: {e}")

    return {"message": "Document deleted successfully"}


@router.patch("/{document_id}/visibility", response_model=DocumentResponse)
def update_document_visibility(
    document_id: int,
    payload: VisibilityUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_doc = db.query(UserDocument).filter(UserDocument.id == document_id).first()
    if not user_doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if user_doc.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to modify this document")

    user_doc.is_public = payload.is_public
    user_doc.shared_at = datetime.now(timezone.utc) if payload.is_public else None
    db.commit()
    db.refresh(user_doc)
    return _build_doc_response(user_doc)


# ── Move to folder ────────────────────────────────────────────────────────────

class MoveToFolderRequest(BaseModel):
    folder_id: Optional[int] = None   # null = remove from folder


@router.patch("/{document_id}/folder", response_model=DocumentResponse)
def move_document_to_folder(
    document_id: int,
    payload: MoveToFolderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == document_id, UserDocument.user_id == current_user.id)
        .first()
    )
    if not user_doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if payload.folder_id is not None:
        folder = db.query(Folder).filter(
            Folder.id == payload.folder_id, Folder.user_id == current_user.id
        ).first()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")

    user_doc.folder_id = payload.folder_id
    db.commit()
    db.refresh(user_doc)
    return _build_doc_response(user_doc)


# ── Star toggle ───────────────────────────────────────────────────────────────

class StarDocumentRequest(BaseModel):
    is_starred: bool


@router.patch("/{document_id}/star", response_model=DocumentResponse)
def star_document(
    document_id: int,
    payload: StarDocumentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == document_id, UserDocument.user_id == current_user.id)
        .first()
    )
    if not user_doc:
        raise HTTPException(status_code=404, detail="Document not found")
    user_doc.is_starred = payload.is_starred
    db.commit()
    db.refresh(user_doc)
    return _build_doc_response(user_doc)


@router.patch("/{document_id}/touch", status_code=204)
def touch_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Bump `last_opened_at` to now() for the calling user's UserDocument.

    Drives recency-of-use sorting in the My Library Files lane (per the
    2026-05-08 library restructure brief). Cheap idempotent write — the
    frontend fires this every time a doc is opened. Cross-user touches
    return 404 (no existence leak).
    """
    rows = (
        db.query(UserDocument)
        .filter(
            UserDocument.id == document_id,
            UserDocument.user_id == current_user.id,
        )
        .update(
            {"last_opened_at": datetime.now(timezone.utc)},
            synchronize_session=False,
        )
    )
    if rows == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    db.commit()


# ── Code Review (Unified Annotation Engine — Phase 1) ────────────────────────

@router.post("/{document_id}/review")
def review_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """
    Generate a structured AI code review for a SOURCE_CODE document.

    Returns:
        {
          "annotations": [
            {"type": "...", "quote": "...", "feedback": "..."},
            ...
          ]
        }

    Raises 403 if the document does not belong to the calling user.
    Raises 422 if the document is not a SOURCE_CODE file.
    Raises 500 if Gemini fails or returns malformed JSON.
    """
    # Authorization: ensure the document belongs to this user
    user_doc = (
        db.query(UserDocument)
        .filter(
            UserDocument.id == document_id,
            UserDocument.user_id == current_user.id,
        )
        .first()
    )
    if not user_doc:
        raise HTTPException(status_code=404, detail="Document not found")

    base_doc = user_doc.base_document
    if not base_doc or base_doc.doc_type != "SOURCE_CODE":
        raise HTTPException(
            status_code=422,
            detail="Code review is only available for SOURCE_CODE documents.",
        )

    try:
        return generate_code_review(document_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── Page summaries ────────────────────────────────────────────────────────────

@router.post(
    "/{document_id}/pages/{page_number}/summary",
    response_model=PageSummaryResponse,
)
def create_page_summary(
    document_id: int,
    page_number: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # document_id is UserDocument.id; summaries are stored against BaseDocument.
    # The summary itself is shared across users (CAS), but only the document's
    # owner can request its generation.
    user_doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == document_id, UserDocument.user_id == current_user.id)
        .first()
    )
    if not user_doc:
        raise HTTPException(status_code=404, detail="Document not found")
    base_hash = user_doc.base_hash

    existing = (
        db.query(PageSummary)
        .filter(PageSummary.base_hash == base_hash, PageSummary.page_number == page_number)
        .first()
    )
    if existing:
        return existing

    page_chunks = (
        db.query(Chunk)
        .filter(Chunk.base_hash == base_hash, Chunk.page_number == page_number)
        .all()
    )
    if not page_chunks:
        raise HTTPException(status_code=404, detail="Page not found")

    page_text = "\n".join(c.text for c in page_chunks)
    summary_text = generate_specific_page_summary(page_text)

    new_summary = PageSummary(
        base_hash=base_hash,
        page_number=page_number,
        summary=summary_text,
    )
    db.add(new_summary)
    db.commit()
    db.refresh(new_summary)
    return new_summary


@router.get("/{document_id}/summaries", response_model=List[PageSummaryResponse])
def get_document_summaries(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == document_id, UserDocument.user_id == current_user.id)
        .first()
    )
    if not user_doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return (
        db.query(PageSummary)
        .filter(PageSummary.base_hash == user_doc.base_hash)
        .all()
    )


@router.post("/{document_id}/summary/all", response_model=FullSummaryResponse)
def create_full_document_summary(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate (or return cached) a comprehensive summary of the entire document."""
    user_doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == document_id, UserDocument.user_id == current_user.id)
        .first()
    )
    if not user_doc:
        raise HTTPException(status_code=404, detail="Document not found")

    base_doc = db.query(BaseDocument).filter(BaseDocument.hash_id == user_doc.base_hash).first()
    if not base_doc:
        raise HTTPException(status_code=404, detail="Base document not found")

    if base_doc.global_summary:
        return FullSummaryResponse(summary=base_doc.global_summary)

    all_chunks = (
        db.query(Chunk)
        .filter(Chunk.base_hash == user_doc.base_hash)
        .order_by(Chunk.page_number.asc())
        .all()
    )
    if not all_chunks:
        raise HTTPException(status_code=404, detail="No content found for this document")

    all_text = "\n".join(c.text for c in all_chunks)
    summary_text = generate_full_document_summary(all_text)

    base_doc.global_summary = summary_text
    db.commit()

    return FullSummaryResponse(summary=summary_text)


@router.post("/{document_id}/summary/custom", response_model=FullSummaryResponse)
def create_custom_summary(
    document_id: int,
    payload: CustomSummaryRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a summary guided by custom user instructions."""
    user_doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == document_id, UserDocument.user_id == current_user.id)
        .first()
    )
    if not user_doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if payload.page_number is not None:
        chunks = (
            db.query(Chunk)
            .filter(Chunk.base_hash == user_doc.base_hash, Chunk.page_number == payload.page_number)
            .all()
        )
        if not chunks:
            raise HTTPException(status_code=404, detail="Page not found")
        text = "\n".join(c.text for c in chunks)
    else:
        chunks = (
            db.query(Chunk)
            .filter(Chunk.base_hash == user_doc.base_hash)
            .order_by(Chunk.page_number.asc())
            .all()
        )
        if not chunks:
            raise HTTPException(status_code=404, detail="No content found for this document")
        text = "\n".join(c.text for c in chunks)

    summary_text = generate_custom_summary(text, payload.custom_prompt)
    return FullSummaryResponse(summary=summary_text)
