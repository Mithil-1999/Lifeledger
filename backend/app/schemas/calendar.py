"""Schemas for the personal calendar."""

import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints, field_validator, model_validator

from app.models import EVENT_REMINDER_MINUTES, EventCategory, EventRecurrence, EventType
from app.schemas.common import DecimalStr

CalendarSource = Literal["event", "task", "reminder", "bill", "goal"]
CALENDAR_SOURCES: tuple[CalendarSource, ...] = ("event", "task", "reminder", "bill", "goal")


def _blank_to_none(value: str | None) -> str | None:
    return value or None


def _optional_text(max_length: int):
    return Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=max_length), AfterValidator(_blank_to_none)]


class EventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    description: _optional_text(2000) = None
    location: _optional_text(200) = None
    event_type: EventType = EventType.PERSONAL
    category: EventCategory = EventCategory.PERSONAL
    start_date: date
    # Defaults to start_date (a single-day event).
    end_date: date | None = None
    # No start time = all-day event.
    start_time: time | None = None
    end_time: time | None = None
    recurrence: EventRecurrence | None = None
    reminder_minutes: int | None = None

    @field_validator("reminder_minutes")
    @classmethod
    def _reminder_choice(cls, value: int | None) -> int | None:
        if value is not None and value not in EVENT_REMINDER_MINUTES:
            raise ValueError(f"Reminder must be one of {', '.join(map(str, EVENT_REMINDER_MINUTES))} minutes before.")
        return value

    @model_validator(mode="after")
    def _consistent(self) -> "EventIn":
        if not date(2000, 1, 1) <= self.start_date <= date(2100, 12, 31):
            raise ValueError("Start date must be between 2000 and 2100.")
        self.end_date = self.end_date or self.start_date
        if self.end_date < self.start_date:
            raise ValueError("The end date can't be before the start date.")
        if (self.end_date - self.start_date).days > 366:
            raise ValueError("An event can last at most a year.")
        if self.end_time is not None and self.start_time is None:
            raise ValueError("Add a start time to use an end time.")
        if self.start_time is not None:
            self.start_time = self.start_time.replace(second=0, microsecond=0, tzinfo=None)
        if self.end_time is not None:
            self.end_time = self.end_time.replace(second=0, microsecond=0, tzinfo=None)
            if self.end_date == self.start_date and self.end_time < self.start_time:
                raise ValueError("The end time can't be before the start time.")
        return self


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    location: str | None
    event_type: EventType
    category: EventCategory
    start_date: date
    end_date: date
    start_time: time | None
    end_time: time | None
    all_day: bool
    recurrence: EventRecurrence | None
    reminder_minutes: int | None
    reminder_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class CalendarItem(BaseModel):
    """One occurrence on the calendar. Everything except "event" is read live from its own module."""

    key: str  # unique per occurrence: "<source>:<id>:<date>"
    source: CalendarSource
    source_id: uuid.UUID
    title: str
    # Wall-clock values in APP_TIMEZONE.
    date: date
    end_date: date
    start_time: time | None
    end_time: time | None
    all_day: bool
    # Event type for events; "task" / "reminder" / "bill" / "goal" otherwise.
    kind: str
    category: str | None
    status: str | None
    is_done: bool
    is_overdue: bool
    # A computed future repeat of a recurring item, not a stored record.
    is_projected: bool
    description: str | None
    location: str | None
    amount: DecimalStr | None
    currency: str | None
    priority: str | None
    recurrence: str | None
    reminder_minutes: int | None


class CalendarFeed(BaseModel):
    start: date
    end: date
    today: date
    items: list[CalendarItem]
    counts: dict[str, int]

