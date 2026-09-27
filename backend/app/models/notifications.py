"""In-app notifications, per-user preferences, and the background-job run log (Phase 11)."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.models.finance import _in_list


class NotificationType(enum.StrEnum):
    TASK_OVERDUE = "task_overdue"
    TASK_UPCOMING = "task_upcoming"
    BILL_OVERDUE = "bill_overdue"
    BILL_UPCOMING = "bill_upcoming"
    BUDGET_THRESHOLD = "budget_threshold"
    SAVINGS_MILESTONE = "savings_milestone"
    REMINDER_DUE = "reminder_due"


class RelatedType(enum.StrEnum):
    TASK = "task"
    BILL = "bill"
    BUDGET = "budget"
    SAVINGS_GOAL = "savings_goal"
    REMINDER = "reminder"


class Notification(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(_in_list("type", NotificationType), name="type_valid"),
        CheckConstraint(_in_list("related_type", RelatedType), name="related_type_valid"),
        # One notification per event: the same key is never inserted twice for a user.
        Index("uq_notifications_user_id_dedupe_key", "user_id", "dedupe_key", unique=True),
        Index("ix_notifications_user_id_created_at", "user_id", "created_at"),
        Index("ix_notifications_user_id_unread", "user_id", postgresql_where=text("read_at IS NULL AND dismissed_at IS NULL")),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    # The record this is about. No foreign key: the notification stays as history if the record is deleted.
    related_type: Mapped[str] = mapped_column(String(15), nullable=False)
    related_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(200), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # "Deleting" hides a notification but keeps its dedupe key, so the same event can't come back.
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class NotificationPreferences(Base):
    """One row per user; created with defaults on first use."""

    __tablename__ = "notification_preferences"
    __table_args__ = (
        CheckConstraint("task_lead_days BETWEEN 0 AND 14", name="task_lead_days_range"),
        CheckConstraint("bill_lead_days BETWEEN 0 AND 30", name="bill_lead_days_range"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    task_overdue: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"), default=True)
    task_upcoming: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"), default=True)
    bill_overdue: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"), default=True)
    bill_upcoming: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"), default=True)
    budget_threshold: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"), default=True)
    savings_milestone: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"), default=True)
    reminder_due: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"), default=True)
    # How many days ahead "upcoming" starts (0 = due today only).
    task_lead_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)
    bill_lead_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default="3", default=3)
    # Whether the browser may show system notifications (the browser's own permission is still required).
    browser_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"), default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class JobStatus(enum.StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"  # another worker held the lock


class JobRun(UUIDPrimaryKeyMixin, Base):
    """Audit trail of background job runs (never contains user content)."""

    __tablename__ = "job_runs"
    __table_args__ = (
        CheckConstraint(_in_list("status", JobStatus), name="status_valid"),
        Index("ix_job_runs_name_started_at", "name", "started_at"),
    )

    name: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    users_checked: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    notifications_created: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    # Exception class name only: messages could contain data.
    error: Mapped[str | None] = mapped_column(String(100))
