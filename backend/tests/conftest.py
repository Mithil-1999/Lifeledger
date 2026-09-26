"""Test configuration.

Tests run against a dedicated PostgreSQL database (`<your db>_test`, or TEST_DATABASE_URL).
At session start it is DROPPED and re-created, then migrated with `alembic upgrade head`,
which proves the migrations work from a clean database. At the end it is downgraded to
`base`, which exercises every downgrade too. Database tests are skipped if PostgreSQL
isn't reachable.
"""

import os

# Configure the environment BEFORE the app (and its engine/settings) is imported.
from sqlalchemy.engine import make_url  # noqa: E402

from app.core.config import Settings  # noqa: E402  (plain class: not the cached settings)

_base = Settings()
_test_url = os.environ.get("TEST_DATABASE_URL") or make_url(_base.database_url).set(
    database=f"{make_url(_base.database_url).database}_test"
).render_as_string(hide_password=False)

os.environ["DATABASE_URL"] = _test_url
os.environ["ENVIRONMENT"] = "test"
os.environ["EMAIL_BACKEND"] = "memory"
os.environ["REGISTRATION_ENABLED"] = "true"
os.environ["RATE_LIMIT_ENABLED"] = "true"
os.environ["COOKIE_SECURE"] = "false"
# Uploaded test documents go to a throwaway directory, never the real storage.
import tempfile  # noqa: E402

os.environ["DOCUMENT_STORAGE_DIR"] = tempfile.mkdtemp(prefix="lifevault-test-docs-")

from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _recreate_test_database() -> bool:
    url = make_url(_test_url)
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT", connect_args={"connect_timeout": 3})
    try:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
            conn.execute(text(f'CREATE DATABASE "{url.database}"'))
        return True
    except Exception:
        return False
    finally:
        admin.dispose()


DB_AVAILABLE = _recreate_test_database()
requires_db = pytest.mark.skipif(not DB_AVAILABLE, reason="PostgreSQL test database not available")


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    if not DB_AVAILABLE:
        yield
        return
    cfg = _alembic_config()
    command.upgrade(cfg, "head")
    yield
    from app.db.session import engine

    engine.dispose()
    command.downgrade(cfg, "base")


@pytest.fixture(autouse=True)
def _clean_state():
    from app.core.rate_limit import limiter
    from app.services.email import sent_messages

    limiter.reset()
    sent_messages.clear()
    yield
    if DB_AVAILABLE:
        from app.db.session import engine

        with engine.begin() as conn:
            # Not TRUNCATE ... CASCADE: that would also wipe the seeded built-in categories
            # (categories references users). Row deletes cascade only to user-owned rows.
            conn.execute(text("DELETE FROM notes"))
            conn.execute(text("DELETE FROM documents"))
            conn.execute(text("DELETE FROM incomes"))
            conn.execute(text("DELETE FROM expenses"))
            conn.execute(text("DELETE FROM users"))


def make_client() -> TestClient:
    """A browser-like client: keeps cookies and sends the CSRF header like the SPA does."""
    from app.main import app

    client = TestClient(app)

    def track_csrf(response) -> None:  # Mirrors the SPA: adopt rotated tokens.
        if token := response.headers.get("X-CSRF-Token"):
            client.headers["X-CSRF-Token"] = token

    client.event_hooks["response"].append(track_csrf)
    client.get("/api/auth/csrf")
    return client


@pytest.fixture
def client() -> TestClient:
    return make_client()
