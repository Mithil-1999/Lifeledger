"""Personal calendar events (Phase 9).

Only the user's own appointments, personal events and deadlines are stored here. Tasks,
reminders, bills and savings-goal deadlines are read from their own tables when the
calendar is built, so they are never duplicated.

Dates and times are wall-clock values in APP_TIMEZONE (like task due dates). An event
without a start time is an all-day event.
"""

import enum
import uuid
from datetime import date, time

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Integer, String, Text, Time
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.finance import _in_list


class EventType(enum.StrEnum):
    APPOINTMENT = "appointment"
    PERSONAL = "personal"
    DEADLINE = "deadline"


class EventCategory(enum.StrEnum):
    PERSONAL = "personal"
    WORK = "work"
    HEALTH = "health"
    FAMILY = "family"
    FINANCE = "finance"
    EDUCATION = "education"
    SOCIAL = "social"
    TRAVEL = "travel"
    OTHER = "other"


class EventRecurrence(enum.StrEnum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


# "Remind me" choices, in minutes before the event starts (all-day events count from 09:00).
EVENT_REMINDER_MINUTES = (0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080)


class CalendarEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "calendar_events"
    __table_args__ = (
        CheckConstraint(_in_list("event_type", EventType), name="event_type_valid"),
        CheckConstraint(_in_list("category", EventCategory), name="category_valid"),
        CheckConstraint(f"recurrence IS NULL OR {_in_list('recurrence', EventRecurrence)}", name="recurrence_valid"),
        CheckConstraint("end_date >= start_date", name="end_after_start"),
        CheckConstraint("end_time IS NULL OR start_time IS NOT NULL", name="end_time_needs_start_time"),
        CheckConstraint(
            "end_time IS NULL OR end_date > start_date OR end_time >= start_time", name="end_time_after_start_time"
        ),
        CheckConstraint("anchor_day BETWEEN 1 AND 31", name="anchor_day_range"),
        CheckConstraint(
            "reminder_minutes IS NULL OR reminder_minutes IN "
            f"({', '.join(str(m) for m in EVENT_REMINDER_MINUTES)})",
            name="reminder_minutes_valid",
        ),
        CheckConstraint("char_length(btrim(title)) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("description IS NULL OR char_length(description) <= 2000", name="description_length"),
        Index("ix_calendar_events_user_id_start_date", "user_id", "start_date"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(200))
    event_type: Mapped[str] = mapped_column(String(15), nullable=False, default=EventType.PERSONAL, server_default="personal")
    category: Mapped[str] = mapped_column(String(15), nullable=False, default=EventCategory.PERSONAL, server_default="personal")
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    recurrence: Mapped[str | None] = mapped_column(String(10))
    # Day of month the event was set for, so monthly/yearly repeats return to the 31st after short months.
    anchor_day: Mapped[int] = mapped_column(Integer, nullable=False)
    reminder_minutes: Mapped[int | None] = mapped_column(Integer)
    # The Reminder that fires for this event (lives in the normal reminders list, so it isn't duplicated).
    reminder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reminders.id", ondelete="SET NULL")
    )
