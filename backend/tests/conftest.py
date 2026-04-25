"""
conftest.py — shared pytest fixtures and configuration.

By default, only unit tests (no live DB required) run with a plain `pytest` call.
Tests that require a live PostgreSQL instance must be decorated with
@pytest.mark.integration and are skipped unless --run-integration is passed.

Why this split:
  Unit tests (JWT, hashing) are pure-Python and run in every environment.
  Integration tests (routes, RAG) need pgvector which SQLite cannot emulate.
"""

import os
import pytest

# Set env defaults before any app module is imported so config.py doesn't
# raise on missing variables in the test environment.
os.environ.setdefault("DATABASE_URL", "postgresql://user:password@localhost:5432/app_db")
os.environ.setdefault("SECRET_KEY", "test-only-secret-key-not-for-production")
os.environ.setdefault("GOOGLE_API_KEY", "test-placeholder")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:5173")


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="Run integration tests that require a live PostgreSQL + pgvector database",
    )


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "integration: mark test as requiring a live PostgreSQL database (skipped by default)",
    )


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    if not config.getoption("--run-integration"):
        skip = pytest.mark.skip(reason="Requires live DB — pass --run-integration to enable")
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(skip)
