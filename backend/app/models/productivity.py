"""Tasks and reminders (Phase 6)."""

import enum
import uuid
from datetime import date, datetime, time

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, Text, Time
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.finance import _in_list


class TaskStatus(enum.StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


OPEN_TASK_STATUSES = (TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS)


class TaskPriority(enum.StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


PRIORITY_RANK = {TaskPriority.URGENT: 0, TaskPriority.HIGH: 1, TaskPriority.MEDIUM: 2, TaskPriority.LOW: 3}


class TaskRecurrence(enum.StrEnum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class Task(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """created_at (from TimestampMixin) is the task's created date."""

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(_in_list("status", TaskStatus), name="status_valid"),
        CheckConstraint(_in_list("priority", TaskPriority), name="priority_valid"),
        CheckConstraint(f"recurrence IS NULL OR {_in_list('recurrence', TaskRecurrence)}", name="recurrence_valid"),
        CheckConstraint("due_time IS NULL OR due_date IS NOT NULL", name="time_needs_date"),
        CheckConstraint("recurrence IS NULL OR due_date IS NOT NULL", name="recurrence_needs_date"),
        CheckConstraint("(status = 'completed') = (completed_at IS NOT NULL)", name="completed_at_consistent"),
        CheckConstraint("char_length(btrim(title)) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("description IS NULL OR char_length(description) <= 5000", name="description_length"),
        Index("ix_tasks_user_id_status_due_date", "user_id", "status", "due_date"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(50))
    priority: Mapped[str] = mapped_column(String(10), nullable=False, default=TaskPriority.MEDIUM, server_default="medium")
    status: Mapped[str] = mapped_column(String(15), nullable=False, default=TaskStatus.NOT_STARTED, server_default="not_started")
    due_date: Mapped[date | None] = mapped_column(Date)
    due_time: Mapped[time | None] = mapped_column(Time)
    recurrence: Mapped[str | None] = mapped_column(String(10))
    # Intended day of month for monthly/yearly repeats (so the 31st doesn't drift to the 28th).
    anchor_day: Mapped[int | None] = mapped_column(Integer)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # For recurring tasks: the occurrence this one was generated from.
    previous_task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL")
    )


class ReminderRepeat(enum.StrEnum):
    NONE = "none"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"
    CUSTOM = "custom"  # every `interval_count` `interval_unit`s


class IntervalUnit(enum.StrEnum):
    DAYS = "days"
    WEEKS = "weeks"
    MONTHS = "months"
    YEARS = "years"


class ReminderStatus(enum.StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"  # one-time reminders only


class Reminder(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "reminders"
    __table_args__ = (
        CheckConstraint(_in_list("repeat", ReminderRepeat), name="repeat_valid"),
        CheckConstraint(_in_list("status", ReminderStatus), name="status_valid"),
        CheckConstraint(
            "(repeat = 'custom' AND interval_count BETWEEN 1 AND 365 AND "
            f"{_in_list('interval_unit', IntervalUnit)}) OR "
            "(repeat <> 'custom' AND interval_count IS NULL AND interval_unit IS NULL)",
            name="custom_interval_consistent",
        ),
        CheckConstraint("status = 'active' OR repeat = 'none'", name="only_one_time_completes"),
        CheckConstraint("char_length(btrim(title)) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("notes IS NULL OR char_length(notes) <= 2000", name="notes_length"),
        Index("ix_reminders_user_id_remind_at", "user_id", "remind_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    # Next occurrence (UTC). Completing a recurring reminder moves this forward.
    remind_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    repeat: Mapped[str] = mapped_column(String(10), nullable=False, default=ReminderRepeat.NONE, server_default="none")
    interval_count: Mapped[int | None] = mapped_column(Integer)
    interval_unit: Mapped[str | None] = mapped_column(String(10))
    # Local day-of-month the reminder was set for, so monthly/yearly repeats return to it after short months.
    anchor_day: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default=ReminderStatus.ACTIVE, server_default="active")
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
