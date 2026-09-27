"""Account settings and security activity (Phase 12)."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.models.finance import _in_list


class SecurityEvent(enum.StrEnum):
    LOGIN_SUCCEEDED = "login_succeeded"
    LOGIN_FAILED = "login_failed"  # wrong password for an existing account
    LOGOUT = "logout"
    PASSWORD_CHANGED = "password_changed"
    PASSWORD_RESET = "password_reset"
    SESSION_REVOKED = "session_revoked"
    OTHER_SESSIONS_REVOKED = "other_sessions_revoked"
    PROFILE_UPDATED = "profile_updated"
    EMAIL_CHANGED = "email_changed"
    USERNAME_CHANGED = "username_changed"
    DATA_EXPORTED = "data_exported"


class SecurityActivity(UUIDPrimaryKeyMixin, Base):
    """Account security log. Stores what happened, when and from where, never secrets or content."""

    __tablename__ = "security_activity"
    __table_args__ = (
        CheckConstraint(_in_list("event", SecurityEvent), name="event_valid"),
        Index("ix_security_activity_user_id_created_at", "user_id", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    event: Mapped[str] = mapped_column(String(30), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    # Short, non-sensitive context such as "json, financial" for an export.
    detail: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class DateFormat(enum.StrEnum):
    DEFAULT = "default"  # Thu, 24 Sep 2026
    DMY = "dmy"  # 24/09/2026
    MDY = "mdy"  # 09/24/2026
    ISO = "iso"  # 2026-09-24


class UserPreferences(Base):
    """Display preferences (one row per user, created with defaults on first use)."""

    __tablename__ = "user_preferences"
    __table_args__ = (
        CheckConstraint(_in_list("date_format", DateFormat), name="date_format_valid"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="NPR", server_default="NPR")
    date_format: Mapped[str] = mapped_column(String(10), nullable=False, default=DateFormat.DEFAULT, server_default="default")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
