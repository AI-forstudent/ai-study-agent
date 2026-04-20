from logging.config import fileConfig
import os
import sys

from sqlalchemy import engine_from_config, pool
from dotenv import load_dotenv
from alembic import context

# ── Make `app/` importable when running `alembic` from the backend/ root ──
# sys.path already includes "." via alembic.ini prepend_sys_path, but we
# also ensure the parent of `app/` (i.e. backend/) is on the path.
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

# ── Load env vars before importing app modules ─────────────────────────────
load_dotenv(os.path.join(_backend_dir, ".env"))

# ── Import ALL domain models so their metadata is registered on Base ───────
# app/models/domain.py re-declares every table (existing + new) and is the
# single source of truth for autogenerate.
from app.core.database import Base  # noqa: E402
import app.models.domain  # noqa: F401  — registers all ORM classes on Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override the DB URL from environment (never hard-code credentials)
config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
