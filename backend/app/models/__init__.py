"""ORM models.

Import every model module here so `Base.metadata` is fully populated for Alembic.
Phase 1 defines no business tables yet.
"""

from app.db.base import Base

__all__ = ["Base"]
