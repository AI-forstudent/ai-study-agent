"""
app/db/seeds/seed_personal_hub.py
───────────────────────────────────
Populates the local dev database with realistic Personal Hub mock data.

Run inside the backend container:
    docker exec ai_study_backend uv run python -m app.db.seeds.seed_personal_hub

The script is fully idempotent — running it multiple times will not create
duplicate rows. It checks for existing data before inserting.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.domain import (
    AcademicProfile,
    CourseCatalog,
    JobApplication,
    StudentCourseRecord,
    User,
)


# ── Helper ─────────────────────────────────────────────────────────────────

def _utc(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, tzinfo=timezone.utc)


# ── Seed definitions ───────────────────────────────────────────────────────

SEED_EMAIL = "dvir@studyagent.ai"
SEED_PASSWORD = "studyagent123"

COURSES = [
    # (name, department, credits, is_yearly, difficulty, icon_name)
    ("Introduction to Programming",   "Computer Science",    3.0, False, 1.5, "Code"),
    ("Data Structures",               "Computer Science",    4.0, False, 3.0, "GitBranch"),
    ("Algorithms",                    "Computer Science",    4.0, True,  4.0, "Zap"),
    ("Databases",                     "Data Engineering",    3.0, False, 2.5, "Database"),
    ("Linear Algebra",                "Mathematics",         4.0, True,  3.5, "Grid"),
    ("Probability & Statistics",      "Mathematics",         4.0, False, 3.5, "BarChart2"),
    ("Machine Learning",              "Data Engineering",    4.0, False, 4.5, "BrainCircuit"),
    ("Data Engineering Workshop",     "Data Engineering",    3.0, False, 4.0, "Workflow"),
]

# prerequisite links: (course_name -> [prerequisite_name, ...])
PREREQUISITES: dict[str, list[str]] = {
    "Data Structures":          ["Introduction to Programming"],
    "Algorithms":               ["Data Structures"],
    "Databases":                ["Introduction to Programming"],
    "Probability & Statistics": ["Linear Algebra"],
    "Machine Learning":         ["Algorithms", "Probability & Statistics"],
    "Data Engineering Workshop": ["Databases", "Machine Learning"],
}

# student records: (course_name, status, grade, exam_date_a)
RECORDS = [
    ("Introduction to Programming", "completed", 92, _utc(2024, 2, 5)),
    ("Data Structures",             "completed", 88, _utc(2024, 6, 20)),
    ("Algorithms",                  "completed", 84, _utc(2024, 6, 25)),
    ("Databases",                   "completed", 91, _utc(2024, 6, 22)),
    ("Linear Algebra",              "completed", 78, _utc(2024, 6, 18)),
    ("Probability & Statistics",    "active",    None, _utc(2026, 6, 15)),
    ("Machine Learning",            "active",    None, _utc(2026, 6, 28)),
]

JOBS = [
    dict(
        company="Google",
        role="Software Engineer Intern",
        status="interview",
        application_date=_utc(2026, 3, 10),
        debrief_notes=(
            "First round was a live coding session on LeetCode-medium graphs. "
            "Solved it but was too slow on the follow-up. "
            "Lesson: practice timed graph traversal — BFS/DFS must be automatic. "
            "Interviewer was friendly. Second round scheduled next month."
        ),
        is_debrief_public=True,
    ),
    dict(
        company="Wix",
        role="Data Engineering Intern",
        status="applied",
        application_date=_utc(2026, 4, 1),
        debrief_notes=None,
        is_debrief_public=False,
    ),
]


# ── Main ───────────────────────────────────────────────────────────────────

def run() -> None:
    db = SessionLocal()
    try:
        # 1. Seed user
        user = db.query(User).filter(User.email == SEED_EMAIL).first()
        if user is None:
            user = User(
                email=SEED_EMAIL,
                password_hash=get_password_hash(SEED_PASSWORD),
            )
            db.add(user)
            db.flush()
            print(f"[seed] Created user: {SEED_EMAIL}")
        else:
            print(f"[seed] User already exists: {SEED_EMAIL}")

        # 2. Academic profile
        profile = db.query(AcademicProfile).filter(AcademicProfile.user_id == user.id).first()
        if profile is None:
            profile = AcademicProfile(
                user_id=user.id,
                university="Ben-Gurion University of the Negev",
                degree="B.Sc. Data Engineering",
                current_year=2,
                target_gpa=85.0,
                extra_credits=3.0,
                social_links={
                    "linkedin": "https://linkedin.com/in/dvir",
                    "github":   "https://github.com/dvir",
                },
            )
            db.add(profile)
            db.flush()
            print("[seed] Created academic profile.")
        else:
            print("[seed] Academic profile already exists.")

        # 3. Course catalog
        catalog: dict[str, CourseCatalog] = {}
        for name, dept, creds, yearly, diff, icon in COURSES:
            existing = db.query(CourseCatalog).filter(CourseCatalog.name == name).first()
            if existing is None:
                course = CourseCatalog(
                    name=name,
                    department=dept,
                    credits=creds,
                    is_yearly=yearly,
                    difficulty_rating=diff,
                    icon_name=icon,
                )
                db.add(course)
                db.flush()
                catalog[name] = course
                print(f"[seed] Created course: {name}")
            else:
                catalog[name] = existing
                print(f"[seed] Course already exists: {name}")

        # 4. Prerequisite links
        for course_name, prereq_names in PREREQUISITES.items():
            course = catalog[course_name]
            existing_prereq_ids = {c.id for c in course.prerequisites}
            for prereq_name in prereq_names:
                prereq = catalog[prereq_name]
                if prereq.id not in existing_prereq_ids:
                    course.prerequisites.append(prereq)
                    print(f"[seed] Linked prerequisite: {prereq_name} → {course_name}")
        db.flush()

        # 5. Student course records
        for course_name, status, grade, exam_date_a in RECORDS:
            course = catalog[course_name]
            existing_record = (
                db.query(StudentCourseRecord)
                .filter(
                    StudentCourseRecord.user_id   == user.id,
                    StudentCourseRecord.course_id == course.id,
                )
                .first()
            )
            if existing_record is None:
                record = StudentCourseRecord(
                    user_id=user.id,
                    course_id=course.id,
                    status=status,
                    grade=grade,
                    exam_date_a=exam_date_a,
                )
                db.add(record)
                print(f"[seed] Created record: {course_name} ({status})")
            else:
                print(f"[seed] Record already exists: {course_name}")

        # 6. Job applications
        for job_data in JOBS:
            existing_job = (
                db.query(JobApplication)
                .filter(
                    JobApplication.user_id == user.id,
                    JobApplication.company == job_data["company"],
                    JobApplication.role    == job_data["role"],
                )
                .first()
            )
            if existing_job is None:
                job = JobApplication(user_id=user.id, **job_data)
                db.add(job)
                print(f"[seed] Created job application: {job_data['company']} — {job_data['role']}")
            else:
                print(f"[seed] Job already exists: {job_data['company']} — {job_data['role']}")

        db.commit()
        print("[seed] Done — all personal hub data committed.")

    except Exception as exc:
        db.rollback()
        print(f"[seed] ERROR: {exc}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()
