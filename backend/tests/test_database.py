"""Integration check against the real PostgreSQL configured by DATABASE_URL.

Skipped automatically when no database is reachable, so unit tests still run anywhere.
"""

import pytest
from sqlalchemy import text

from app.db.session import check_database_connection, engine

pytestmark = pytest.mark.skipif(not check_database_connection(), reason="PostgreSQL not reachable")


def test_connects_to_postgresql():
    with engine.connect() as connection:
        version = connection.execute(text("SHOW server_version")).scalar_one()
    assert version


def test_migrations_applied():
    with engine.connect() as connection:
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one_or_none()
    assert revision is not None, "Run `alembic upgrade head` first"
