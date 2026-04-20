"""
app/core/database.py
────────────────────
SQLAlchemy engine, session factory, and declarative Base for the new
app/ package.  All domain models in app/models/ inherit from this Base.

The Alembic env.py imports THIS Base so autogenerate sees the full Grand
Vision schema and produces correct migrations.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import DATABASE_URL

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # drop stale connections before checkout
    echo=False,           # set True locally to log SQL
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency — yields a SQLAlchemy session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
