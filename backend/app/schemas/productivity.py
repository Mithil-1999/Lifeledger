"""Schemas for tasks and reminders."""

import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.models import IntervalUnit, ReminderRepeat, TaskPriority, TaskRecurrence, TaskStatus


def _blank_to_none(value: str | None) -> str | None:
    return value or None


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


def _optional_text(max_length: int):
    return Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=max_length), AfterValidator(_blank_to_none)]


# --- Tasks -----------------------------------------------------------------------------------------

TaskView = Literal["today", "upcoming", "overdue", "completed", "all"]


class TaskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    description: _optional_text(5000) = None
    category: _optional_text(50) = None
    priority: TaskPriority = TaskPriority.MEDIUM
    status: TaskStatus = TaskStatus.NOT_STARTED
    due_date: date | None = None
    due_time: time | None = None
    recurrence: TaskRecurrence | None = None

    @model_validator(mode="after")
    def _consistent(self) -> "TaskIn":
        if self.due_time is not None and self.due_date is None:
            raise ValueError("Add a due date to use a due time.")
        if self.recurrence is not None and self.due_date is None:
            raise ValueError("Recurring tasks need a due date.")
        if self.due_date is not None and not date(2000, 1, 1) <= self.due_date <= date(2100, 12, 31):
            raise ValueError("Due date must be between 2000 and 2100.")
        if self.due_time is not None:
            self.due_time = self.due_time.replace(second=0, microsecond=0, tzinfo=None)
        return self


class TaskStatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: TaskStatus


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    category: str | None
    priority: TaskPriority
    status: TaskStatus
    due_date: date | None
    due_time: time | None
    recurrence: TaskRecurrence | None
    created_at: datetime
    completed_at: datetime | None
    previous_task_id: uuid.UUID | None
    # Derived from stored status and due date/time (in APP_TIMEZONE); never stored.
    is_overdue: bool
    is_due_soon: bool


class TaskCounts(BaseModel):
    today: int
    upcoming: int
    overdue: int
    completed: int
    all: int


class TaskList(BaseModel):
    view: TaskView
    items: list[TaskOut]
    counts: TaskCounts


class PendingTasks(BaseModel):
    """"You haven't worked on these tasks": only tasks whose stored status is Not Started.
    The three groups are disjoint (overdue first, then due soon, then the rest)."""

    due_soon_days: int
    overdue: list[TaskOut]
    due_soon: list[TaskOut]
    not_started: list[TaskOut]


# --- Reminders ---------------------------------------------------------------------------------------

ReminderView = Literal["due", "upcoming", "completed", "all"]


class ReminderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    notes: _optional_text(2000) = None
    # Must include a timezone offset (e.g. "2026-09-25T09:00:00+05:45" or "...Z").
    remind_at: AwareDatetime
    repeat: ReminderRepeat = ReminderRepeat.NONE
    interval_count: int | None = Field(default=None, ge=1, le=365)
    interval_unit: IntervalUnit | None = None

    @model_validator(mode="after")
    def _custom_interval(self) -> "ReminderIn":
        if self.repeat == ReminderRepeat.CUSTOM:
            if self.interval_count is None or self.interval_unit is None:
                raise ValueError("Custom reminders need “every N days/weeks/months/years”.")
        else:
            self.interval_count = None
            self.interval_unit = None
        if not datetime(2000, 1, 1).year <= self.remind_at.year <= 2100:
            raise ValueError("Reminder time must be between 2000 and 2100.")
        return self


class SnoozeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 30)
    until: AwareDatetime | None = None

    @model_validator(mode="after")
    def _one_of(self) -> "SnoozeIn":
        if (self.minutes is None) == (self.until is None):
            raise ValueError("Give either minutes or until.")
        return self


class ReminderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    notes: str | None
    remind_at: datetime
    repeat: ReminderRepeat
    interval_count: int | None
    interval_unit: IntervalUnit | None
    status: Literal["active", "completed"]
    snoozed_until: datetime | None
    completed_at: datetime | None
    last_completed_at: datetime | None
    created_at: datetime
    # When it next fires: the snooze time if snoozed, otherwise remind_at.
    effective_at: datetime
    is_due: bool
    is_snoozed: bool


class ReminderCounts(BaseModel):
    due: int
    upcoming: int
    completed: int
    all: int


class ReminderList(BaseModel):
    view: ReminderView
    items: list[ReminderOut]
    counts: ReminderCounts
