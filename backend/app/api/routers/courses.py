"""
app/api/routers/courses.py
───────────────────────────
Course CRUD + public listing + star (membership upsert).

Visibility model
────────────────
• private        — only the owner sees it.
• admin_assigned — visible to users with a 'admin_assigned' membership row.
• public         — listed in GET /api/v1/courses/public; any logged-in user
                   can star it (POST /{id}/star) to add it to their library.

Mounted at /api/v1/courses in app/main.py.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.domain import (
    Course, CourseLecturer, CourseMembership, CourseTopic,
    Folder, User, UserDocument,
)
from app.services.document_service import extract_text
from app.services.llm_json import LLMJsonError, user_message_for
from app.services.permissions import (
    CourseCapabilities, Scope, gate_or_403, gate_or_403_shadow_404,
)
from app.services.syllabus_extractor import extract_syllabus

router = APIRouter(tags=["courses"])

VALID_VISIBILITIES = {"private", "admin_assigned", "public"}
VALID_ROLES = {"owner", "admin_assigned", "starred"}


# ── Schemas ────────────────────────────────────────────────────────────────

class CourseCreate(BaseModel):
    title:       str
    description: Optional[str] = None
    visibility:  str           = "private"
    color:       Optional[str] = None
    icon:        Optional[str] = None


class CourseUpdate(BaseModel):
    title:       Optional[str] = None
    description: Optional[str] = None
    visibility:  Optional[str] = None
    color:       Optional[str] = None
    icon:        Optional[str] = None


class CourseResponse(BaseModel):
    """My-Library shape: includes the caller's role + counts for cards."""
    model_config = ConfigDict(from_attributes=True)

    id:               int
    owner_id:         int
    title:            str
    description:      Optional[str] = None
    visibility:       str
    color:            Optional[str] = None
    icon:             Optional[str] = None
    created_at:       datetime
    role:             Optional[str] = None  # caller's membership role, if any
    is_hidden:        bool          = False  # caller's hide-toggle on this course
    folder_count:     int           = 0
    document_count:   int           = 0


class PublicCourseResponse(BaseModel):
    """Catalog shape: exposes owner_email for attribution and a star flag."""
    model_config = ConfigDict(from_attributes=True)

    id:             int
    title:          str
    description:    Optional[str] = None
    color:          Optional[str] = None
    icon:           Optional[str] = None
    created_at:     datetime
    owner_email:    str
    is_starred:     bool          = False
    document_count: int           = 0


# ── Helpers ────────────────────────────────────────────────────────────────

def _build_response(
    course: Course,
    role: Optional[str],
    db: Session,
    is_hidden: bool = False,
) -> CourseResponse:
    folder_count = (
        db.query(Folder).filter(Folder.course_id == course.id).count()
    )
    document_count = (
        db.query(UserDocument)
        .join(Folder, UserDocument.folder_id == Folder.id)
        .filter(Folder.course_id == course.id)
        .count()
    )
    return CourseResponse(
        id=course.id,
        owner_id=course.owner_id,
        title=course.title,
        description=course.description,
        visibility=course.visibility,
        color=course.color,
        icon=course.icon,
        created_at=course.created_at,
        role=role,
        is_hidden=is_hidden,
        folder_count=folder_count,
        document_count=document_count,
    )


def _get_owned_course_or_404(course_id: int, user: User, db: Session) -> Course:
    """Fetch a course the caller created, or 404. Cross-owner mutations 404.

    Used by syllabus attach/detach (still owner-only by design today). The
    write routes that participate in the Phase-2 admin matrix
    (update_course, delete_course) call `_get_course_or_404` instead and
    let `gate_or_403_shadow_404` make the access decision so non-owner
    admins can be granted by their role assignment.
    """
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.owner_id == user.id)
        .first()
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


def _get_course_or_404(course_id: int, db: Session) -> Course:
    """Fetch a course by id, or 404 — does NOT enforce ownership.

    Pair this with `gate_or_403_shadow_404(...)` on Phase-2 write routes.
    The gate is responsible for the access decision; this helper only
    proves the row exists so the gate has an `owner_id` to consult.
    """
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


def _ensure_visibility(visibility: str) -> None:
    if visibility not in VALID_VISIBILITIES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid visibility '{visibility}'. Must be one of {sorted(VALID_VISIBILITIES)}.",
        )


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("/public", response_model=List[PublicCourseResponse])
def list_public_courses(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The public Courses tab — every logged-in user sees the same catalog.

    Each card carries an `is_starred` flag computed against the caller's
    memberships so the frontend can render the star toggle without a second
    round-trip.
    """
    rows = (
        db.query(Course)
        .filter(Course.visibility == "public")
        .order_by(Course.created_at.desc())
        .all()
    )
    starred_ids = {
        m.course_id
        for m in db.query(CourseMembership).filter(CourseMembership.user_id == current_user.id).all()
    }

    out: list[PublicCourseResponse] = []
    for c in rows:
        document_count = (
            db.query(UserDocument)
            .join(Folder, UserDocument.folder_id == Folder.id)
            .filter(Folder.course_id == c.id)
            .count()
        )
        out.append(
            PublicCourseResponse(
                id=c.id,
                title=c.title,
                description=c.description,
                color=c.color,
                icon=c.icon,
                created_at=c.created_at,
                owner_email=c.owner.email,
                is_starred=c.id in starred_ids,
                document_count=document_count,
            )
        )
    return out


@router.get("/", response_model=List[CourseResponse])
def list_my_courses(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The "My Courses" lane — courses the caller owns OR has a membership in.

    A course shows up if any of these is true:
      • Course.owner_id == current_user.id        → role inferred as 'owner'
      • CourseMembership row exists                → role from the row
    """
    # Courses I own (owner role is inferred — no membership row needed)
    owned = (
        db.query(Course)
        .filter(Course.owner_id == current_user.id)
        .all()
    )
    # Courses I'm a member of (admin-assigned or starred)
    member_rows = (
        db.query(CourseMembership, Course)
        .join(Course, CourseMembership.course_id == Course.id)
        .filter(CourseMembership.user_id == current_user.id)
        .all()
    )

    # (course, role, is_hidden) keyed by course id. Owner inferred from
    # Course.owner_id always wins over a membership row's role; the
    # membership row still provides the is_hidden flag if the owner has
    # hidden their own course (rare but possible — we don't write
    # ownership rows by default, so for owner-without-membership the
    # default is_hidden=false applies).
    seen: dict[int, tuple[Course, str, bool]] = {}
    for c in owned:
        seen[c.id] = (c, "owner", False)
    for m, c in member_rows:
        existing = seen.get(c.id)
        if existing is None:
            seen[c.id] = (c, m.role, m.is_hidden)
        else:
            # Keep "owner" role; carry membership's is_hidden over so an
            # owner who explicitly added a hidden membership still has it
            # respected.
            seen[c.id] = (existing[0], existing[1], m.is_hidden)

    out = [_build_response(c, role, db, hidden) for c, role, hidden in seen.values()]
    out.sort(key=lambda x: x.created_at, reverse=True)
    return out


@router.post("/", response_model=CourseResponse, status_code=201)
def create_course(
    payload: CourseCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_visibility(payload.visibility)

    # Phase 2 gate. New courses currently land in the user's home community
    # (Default/General for v1 — admin UI for picking a real community arrives
    # in Phase 5). The creator becomes the implicit owner, so the v1
    # self-service rule in Default lets any authenticated user create a
    # course; outside Default the matrix would require community_admin+.
    target_community_id = 1   # TODO Phase 5: derive from payload once admin UI exposes it
    gate_or_403(
        current_user, CourseCapabilities.create_course,
        Scope.community(target_community_id), db,
        owner_id=current_user.id,
    )

    course = Course(
        owner_id=current_user.id,
        # community_id / organization_id are NOT NULL on the model; for v1
        # everything lives in Default until the admin UI exposes a picker.
        community_id=target_community_id,
        organization_id=1,
        title=payload.title,
        description=payload.description,
        visibility=payload.visibility,
        color=payload.color,
        icon=payload.icon,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return _build_response(course, "owner", db)


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Read a single course the caller can access.

    Access rules:
      • Owner can always read.
      • Membership row → can read.
      • Public visibility → any logged-in user can read.
      • Otherwise → 404 (no existence leak).
    """
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    role: Optional[str] = None
    is_hidden = False
    if course.owner_id == current_user.id:
        role = "owner"
        # Owners may also hold a membership row carrying their hide flag.
        owner_membership = (
            db.query(CourseMembership)
            .filter(
                CourseMembership.user_id == current_user.id,
                CourseMembership.course_id == course_id,
            )
            .first()
        )
        if owner_membership:
            is_hidden = owner_membership.is_hidden
    else:
        membership = (
            db.query(CourseMembership)
            .filter(
                CourseMembership.user_id == current_user.id,
                CourseMembership.course_id == course_id,
            )
            .first()
        )
        if membership:
            role = membership.role
            is_hidden = membership.is_hidden
        elif course.visibility != "public":
            raise HTTPException(status_code=404, detail="Course not found")

    return _build_response(course, role, db, is_hidden)


@router.put("/{course_id}", response_model=CourseResponse)
def update_course(
    course_id: int,
    payload: CourseUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Existence-only fetch: the access decision is made by the gate below.
    # (Previously this was `_get_owned_course_or_404`, which 404'd every
    # non-owner before the role-based gate could ever run — making the
    # Phase-2 admin matrix dead code on this route.)
    course = _get_course_or_404(course_id, db)

    # Phase 2 gate — in Default the owner-fallback grants the owner; outside
    # Default (or for non-owner admins), the role-based check runs. With the
    # flag off we still 404 cross-user writes (legacy UX, no existence leak).
    gate_or_403_shadow_404(
        current_user, CourseCapabilities.update_course,
        Scope.course(course.id), db,
        owner_id=course.owner_id,
        not_found_detail="Course not found",
    )

    if payload.visibility is not None:
        _ensure_visibility(payload.visibility)
        course.visibility = payload.visibility
    if payload.title is not None:
        course.title = payload.title
    if payload.description is not None:
        course.description = payload.description
    if payload.color is not None:
        course.color = payload.color
    if payload.icon is not None:
        course.icon = payload.icon

    db.commit()
    db.refresh(course)
    return _build_response(course, "owner", db)


@router.delete("/{course_id}", status_code=204)
def delete_course(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a course owned by the caller.

    Detaches contained Folders by nulling their `course_id` (so they become
    top-level folders in the user's library) — never cascade-deletes documents
    or threads. Memberships pointing at this course are removed.
    """
    # Existence-only fetch + gate: see update_course for the rationale.
    course = _get_course_or_404(course_id, db)

    gate_or_403_shadow_404(
        current_user, CourseCapabilities.delete_course,
        Scope.course(course.id), db,
        owner_id=course.owner_id,
        not_found_detail="Course not found",
    )

    db.query(Folder).filter(Folder.course_id == course_id).update(
        {"course_id": None}, synchronize_session=False
    )
    db.query(CourseMembership).filter(CourseMembership.course_id == course_id).delete(
        synchronize_session=False
    )
    db.delete(course)
    db.commit()


# ── Hide / Unhide (per-user toggle on My Courses) ─────────────────────────

class HideRequest(BaseModel):
    is_hidden: bool


@router.patch("/{course_id}/hide", response_model=CourseResponse)
def set_course_hidden(
    course_id: int,
    payload: HideRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Toggle the calling user's `is_hidden` flag on this course.

    Drives the Visible / Hidden collapsibles on the new Courses tabbed
    page (per the 2026-05-08 library restructure brief). Hiding a course
    does NOT remove ownership / starred-membership — the course stays in
    the user's list, just collapsed under the Hidden block.

    For owners without an explicit `course_memberships` row, we create
    one with role='owner' so the is_hidden flag has somewhere to live.
    Cross-user / unreachable courses 404 (no existence leak).
    """
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    is_owner = course.owner_id == current_user.id
    membership = (
        db.query(CourseMembership)
        .filter(
            CourseMembership.user_id == current_user.id,
            CourseMembership.course_id == course_id,
        )
        .first()
    )

    # Reachability — same rules as GET /{id}
    if not is_owner and membership is None and course.visibility != "public":
        raise HTTPException(status_code=404, detail="Course not found")

    # A non-owner non-member hitting Hide on a public course used to silently
    # get a `CourseMembership(role='starred')` here — implicitly starring a
    # course they only asked to hide. After unhiding it would surface in
    # `GET /courses/me` as a starred course they never starred. Reject the
    # call instead — the user can star explicitly first if they want the
    # course in their list.
    if not is_owner and membership is None:
        raise HTTPException(
            status_code=400,
            detail="Star this course first if you want it in your list — Hide only acts on courses you already own or have a membership in.",
        )

    if membership is None:
        # Owners without an explicit membership row get one created on the
        # spot so the hide flag has a home.
        membership = CourseMembership(
            user_id=current_user.id,
            course_id=course_id,
            role="owner",
            is_hidden=payload.is_hidden,
        )
        db.add(membership)
    else:
        membership.is_hidden = payload.is_hidden

    db.commit()
    db.refresh(membership)

    role: Optional[str] = "owner" if is_owner else membership.role
    return _build_response(course, role, db, membership.is_hidden)


# ── Star (membership upsert) ──────────────────────────────────────────────

class StarRequest(BaseModel):
    is_starred: bool


@router.post("/{course_id}/star", response_model=CourseResponse)
def star_course(
    course_id: int,
    payload: StarRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Toggle the calling user's "starred" membership on a public course.

    Only public courses can be starred; admin-assigned memberships are
    untouched (they were created out-of-band) — they cannot be downgraded
    via this endpoint.
    """
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course or course.visibility != "public":
        raise HTTPException(status_code=404, detail="Course not found")

    if course.owner_id == current_user.id:
        # Owners always see their own course; starring is a no-op for them.
        return _build_response(course, "owner", db)

    membership = (
        db.query(CourseMembership)
        .filter(
            CourseMembership.user_id == current_user.id,
            CourseMembership.course_id == course_id,
        )
        .first()
    )

    if payload.is_starred:
        if membership is None:
            membership = CourseMembership(
                user_id=current_user.id,
                course_id=course_id,
                role="starred",
            )
            db.add(membership)
        # If a membership already exists with role='admin_assigned', leave it
        # alone — starring an admin-assigned course is a no-op.
    else:
        if membership and membership.role == "starred":
            db.delete(membership)
        # Refuse to remove admin-assigned memberships via the star toggle.

    db.commit()

    role: Optional[str] = None
    refreshed = (
        db.query(CourseMembership)
        .filter(
            CourseMembership.user_id == current_user.id,
            CourseMembership.course_id == course_id,
        )
        .first()
    )
    if refreshed:
        role = refreshed.role
    return _build_response(course, role, db)


# ── Syllabus ──────────────────────────────────────────────────────────────


class SyllabusAttachRequest(BaseModel):
    """Use an existing UserDocument as the course syllabus.

    The doc must belong to the caller (the courses router does not stream
    files itself; reuse the existing document upload endpoint to put a PDF
    into the user's library, then attach it here).
    """
    user_document_id: int


class LecturerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:    int
    name:  str
    email: Optional[str] = None
    role:  str


class TopicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:     int
    name:   str
    source: str


class SyllabusResponse(BaseModel):
    """Combined view used by the Course detail page Syllabus tab."""
    user_document_id: Optional[int]              = None
    extracted:        Optional[dict[str, Any]]   = None
    topics:           list[TopicOut]             = []
    lecturers:        list[LecturerOut]          = []


def _seed_topics_and_lecturers(course: Course, extracted: dict[str, Any], db: Session) -> None:
    """Idempotently insert syllabus topics and lecturers for the course.

    Existing rows survive — re-extracting a syllabus won't lose
    'exam_inferred' topics or hand-edited lecturer rows. New names are added
    on the next pass; obsolete ones are NOT auto-deleted.
    """
    existing_topic_names = {t.name for t in course.topics}
    for name in extracted.get("topics", []):
        if name and name not in existing_topic_names:
            db.add(CourseTopic(course_id=course.id, name=name, source="syllabus"))
            existing_topic_names.add(name)

    existing_lect_names = {l.name for l in course.lecturers}
    for lec in extracted.get("lecturers", []):
        nm = (lec.get("name") or "").strip()
        if nm and nm not in existing_lect_names:
            db.add(CourseLecturer(
                course_id=course.id,
                name=nm,
                email=lec.get("email"),
                role=lec.get("role") or "lecturer",
            ))
            existing_lect_names.add(nm)


def _serialize_syllabus(course: Course) -> SyllabusResponse:
    return SyllabusResponse(
        user_document_id=course.syllabus_user_document_id,
        extracted=course.syllabus_extracted,
        topics=[TopicOut(id=t.id, name=t.name, source=t.source) for t in course.topics],
        lecturers=[
            LecturerOut(id=l.id, name=l.name, email=l.email, role=l.role)
            for l in course.lecturers
        ],
    )


@router.get("/{course_id}/syllabus", response_model=SyllabusResponse)
def get_course_syllabus(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the course's cached syllabus + derived topics/lecturers.

    Read access matches GET /{course_id}: owner, member, or any logged-in
    user for a public course.
    """
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    if course.owner_id != current_user.id:
        membership = (
            db.query(CourseMembership)
            .filter(
                CourseMembership.user_id == current_user.id,
                CourseMembership.course_id == course_id,
            )
            .first()
        )
        if not membership and course.visibility != "public":
            raise HTTPException(status_code=404, detail="Course not found")

    return _serialize_syllabus(course)


@router.post("/{course_id}/syllabus", response_model=SyllabusResponse)
def attach_course_syllabus(
    course_id: int,
    payload: SyllabusAttachRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Attach an existing UserDocument as the course syllabus and run a
    one-time Gemini extraction.

    Idempotent re-runs (same user_document_id) re-extract and refresh the
    cached fields; topics and lecturers are upserted (new ones added; old
    ones — including manually edited rows — preserved).
    """
    course = _get_owned_course_or_404(course_id, current_user, db)

    user_doc = (
        db.query(UserDocument)
        .filter(
            UserDocument.id == payload.user_document_id,
            UserDocument.user_id == current_user.id,
        )
        .first()
    )
    if not user_doc:
        raise HTTPException(status_code=404, detail="Syllabus document not found in your library")
    if not user_doc.base_document or not user_doc.base_document.file_path:
        raise HTTPException(status_code=422, detail="Syllabus document has no file on disk")

    # Re-run text extraction — pdfplumber for PDF, the DOCX path for Word, etc.
    try:
        pages = extract_text(user_doc.base_document.file_path)
    except Exception as exc:  # narrow extraction errors are surfaced as 422
        raise HTTPException(status_code=422, detail=f"Could not read syllabus: {exc}")
    full_text = "\n".join(p["text"] for p in pages)

    try:
        extracted = extract_syllabus(full_text)
    except LLMJsonError as exc:
        # The technical reason (`exc.reason`) is logged inside llm_json; here
        # we only show the user a human-readable explanation with retry hint.
        raise HTTPException(status_code=502, detail=user_message_for(exc))

    course.syllabus_user_document_id = user_doc.id
    course.syllabus_extracted        = extracted
    db.flush()

    _seed_topics_and_lecturers(course, extracted, db)
    db.commit()
    db.refresh(course)
    return _serialize_syllabus(course)


@router.delete("/{course_id}/syllabus", response_model=SyllabusResponse)
def detach_course_syllabus(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detach the syllabus document and clear the cached extraction.

    Topics and lecturers are NOT auto-deleted — they may have been used to
    tag exam questions or hand-edited; the user can prune them explicitly
    from the topics/lecturers endpoints (TODO).
    """
    course = _get_owned_course_or_404(course_id, current_user, db)
    course.syllabus_user_document_id = None
    course.syllabus_extracted        = None
    db.commit()
    db.refresh(course)
    return _serialize_syllabus(course)


# ══════════════════════════════════════════════════════════════════════════════
# Course lecturers — manual CRUD (F-034)
# ══════════════════════════════════════════════════════════════════════════════
# The syllabus extractor populates `course_lecturers` from the PDF. F-034 adds
# a manual path so the course owner can add a lecturer who isn't in the
# syllabus (guest lectures, TAs, anything ad-hoc) before attaching a
# lecturer summary to a lecture.

class CourseLecturerCreate(BaseModel):
    name:  str
    email: Optional[str] = None
    role:  Optional[str] = "lecturer"


class CourseLecturerUpdate(BaseModel):
    name:  Optional[str] = None
    email: Optional[str] = None
    role:  Optional[str] = None


@router.get("/{course_id}/lecturers", response_model=List[LecturerOut])
def list_course_lecturers(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all CourseLecturer rows for a course.

    Read access matches GET /{course_id}: owner, member, or any logged-in
    user for a public course. Used by the "pick a lecturer" dropdown in
    the lecture session view.
    """
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if course.owner_id != current_user.id:
        membership = (
            db.query(CourseMembership)
            .filter(
                CourseMembership.user_id == current_user.id,
                CourseMembership.course_id == course_id,
            )
            .first()
        )
        if not membership and course.visibility != "public":
            raise HTTPException(status_code=404, detail="Course not found")

    rows = (
        db.query(CourseLecturer)
        .filter(CourseLecturer.course_id == course_id)
        .order_by(CourseLecturer.id.asc())
        .all()
    )
    return [LecturerOut(id=l.id, name=l.name, email=l.email, role=l.role) for l in rows]


@router.post("/{course_id}/lecturers", response_model=LecturerOut, status_code=201)
def add_course_lecturer(
    course_id: int,
    payload: CourseLecturerCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a lecturer to a course manually (owner-only)."""
    course = _get_owned_course_or_404(course_id, current_user, db)
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Lecturer name is required.")
    row = CourseLecturer(
        course_id=course.id,
        name=name,
        email=(payload.email or "").strip() or None,
        role=(payload.role or "lecturer").strip() or "lecturer",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return LecturerOut(id=row.id, name=row.name, email=row.email, role=row.role)


@router.put("/{course_id}/lecturers/{lecturer_id}", response_model=LecturerOut)
def update_course_lecturer(
    course_id: int,
    lecturer_id: int,
    payload: CourseLecturerUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Edit a course lecturer's name / email / role (owner-only)."""
    _get_owned_course_or_404(course_id, current_user, db)
    row = (
        db.query(CourseLecturer)
        .filter(CourseLecturer.id == lecturer_id, CourseLecturer.course_id == course_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Lecturer not found")

    sent = payload.model_fields_set
    if "name" in sent and payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name cannot be empty.")
        row.name = name
    if "email" in sent:
        row.email = (payload.email or "").strip() or None
    if "role" in sent and payload.role is not None:
        row.role = payload.role.strip() or "lecturer"

    db.commit()
    db.refresh(row)
    return LecturerOut(id=row.id, name=row.name, email=row.email, role=row.role)


@router.delete("/{course_id}/lecturers/{lecturer_id}", status_code=204)
def delete_course_lecturer(
    course_id: int,
    lecturer_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a lecturer from a course (owner-only).

    Lecturer-summary rows referencing this lecturer get their `lecturer_id`
    nulled (the FK is ON DELETE SET NULL) — the summary content stays."""
    _get_owned_course_or_404(course_id, current_user, db)
    row = (
        db.query(CourseLecturer)
        .filter(CourseLecturer.id == lecturer_id, CourseLecturer.course_id == course_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Lecturer not found")
    db.delete(row)
    db.commit()
