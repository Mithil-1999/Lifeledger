"""Reminders: one-time, daily, weekly, monthly, yearly and custom ("every N units").

Times are stored in UTC. Repeats are computed on the local wall clock (APP_TIMEZONE), so
a "9:00 every month on the 31st" reminder stays at 9:00 local and returns to the 31st
after shorter months. Delivering notifications is Phase 11; here reminders become
"due" in the app when their time passes.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Reminder, ReminderRepeat, ReminderStatus
from app.services.bills import add_months


class ReminderError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def utcnow() -> datetime:
    return datetime.now(UTC)


def effective_at(reminder: Reminder) -> datetime:
    return reminder.snoozed_until or reminder.remind_at


def is_due(reminder: Reminder, now: datetime) -> bool:
    return reminder.status == ReminderStatus.ACTIVE and effective_at(reminder) <= now


def to_out(reminder: Reminder, now: datetime) -> dict[str, Any]:
    return {
        "id": reminder.id,
        "title": reminder.title,
        "notes": reminder.notes,
        "remind_at": reminder.remind_at,
        "repeat": reminder.repeat,
        "interval_count": reminder.interval_count,
        "interval_unit": reminder.interval_unit,
        "status": reminder.status,
        "snoozed_until": reminder.snoozed_until,
        "completed_at": reminder.completed_at,
        "last_completed_at": reminder.last_completed_at,
        "created_at": reminder.created_at,
        "effective_at": effective_at(reminder),
        "is_due": is_due(reminder, now),
        "is_snoozed": reminder.status == ReminderStatus.ACTIVE and reminder.snoozed_until is not None and reminder.snoozed_until > now,
    }


def in_view(reminder: Reminder, view: str, now: datetime) -> bool:
    if view == "all":
        return True
    if view == "completed":
        return reminder.status == ReminderStatus.COMPLETED
    if reminder.status != ReminderStatus.ACTIVE:
        return False
    return is_due(reminder, now) if view == "due" else not is_due(reminder, now)


# --- Recurrence ----------------------------------------------------------------------------------------------


def _step(local: datetime, reminder: Reminder) -> datetime:
    repeat = ReminderRepeat(reminder.repeat)
    if repeat == ReminderRepeat.DAILY:
        return local + timedelta(days=1)
    if repeat == ReminderRepeat.WEEKLY:
        return local + timedelta(weeks=1)
    if repeat in (ReminderRepeat.MONTHLY, ReminderRepeat.YEARLY):
        months = 1 if repeat == ReminderRepeat.MONTHLY else 12
        return datetime.combine(add_months(local.date(), months, reminder.anchor_day), local.timetz())
    # custom
    count, unit = reminder.interval_count, reminder.interval_unit
    if unit == "days":
        return local + timedelta(days=count)
    if unit == "weeks":
        return local + timedelta(weeks=count)
    months = count if unit == "months" else count * 12
    return datetime.combine(add_months(local.date(), months, reminder.anchor_day), local.timetz())


def next_occurrence(reminder: Reminder, now: datetime) -> datetime:
    """Next occurrence after the current one that is also in the future (missed ones are skipped)."""
    tz = get_settings().timezone
    local = reminder.remind_at.astimezone(tz)
    candidate = _step(local, reminder)
    while candidate <= now:
        candidate = _step(candidate, reminder)
    return candidate.astimezone(UTC)


# --- CRUD & actions -------------------------------------------------------------------------------------------------


def get_reminder(db: Session, user_id: uuid.UUID, reminder_id: uuid.UUID) -> Reminder:
    reminder = db.scalar(select(Reminder).where(Reminder.id == reminder_id, Reminder.user_id == user_id))
    if reminder is None:
        raise ReminderError("Reminder not found.", 404)
    return reminder


def list_reminders(db: Session, user_id: uuid.UUID, view: str, now: datetime | None = None) -> dict[str, Any]:
    now = now or utcnow()
    reminders = list(db.scalars(select(Reminder).where(Reminder.user_id == user_id)))
    counts = {v: sum(1 for r in reminders if in_view(r, v, now)) for v in ("due", "upcoming", "completed", "all")}
    selected = [r for r in reminders if in_view(r, view, now)]
    if view == "completed":
        selected.sort(key=lambda r: r.completed_at or r.updated_at, reverse=True)
    else:
        selected.sort(key=lambda r: (r.status != ReminderStatus.ACTIVE, effective_at(r)))
    return {"view": view, "items": [to_out(r, now) for r in selected], "counts": counts}


def _apply(reminder: Reminder, data: dict[str, Any]) -> None:
    for field in ("title", "notes", "remind_at", "repeat", "interval_count", "interval_unit"):
        setattr(reminder, field, data[field])
    reminder.remind_at = data["remind_at"].astimezone(UTC)
    reminder.anchor_day = data["remind_at"].astimezone(get_settings().timezone).day
    # Saving a reminder (re)activates it and clears any snooze.
    reminder.status = ReminderStatus.ACTIVE
    reminder.snoozed_until = None
    reminder.completed_at = None


def create_reminder(db: Session, user_id: uuid.UUID, data: dict[str, Any]) -> Reminder:
    reminder = Reminder(user_id=user_id)
    _apply(reminder, data)
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder


def update_reminder(db: Session, user_id: uuid.UUID, reminder_id: uuid.UUID, data: dict[str, Any]) -> Reminder:
    reminder = get_reminder(db, user_id, reminder_id)
    _apply(reminder, data)
    db.commit()
    db.refresh(reminder)
    return reminder


def delete_reminder(db: Session, user_id: uuid.UUID, reminder_id: uuid.UUID) -> None:
    db.delete(get_reminder(db, user_id, reminder_id))
    db.commit()


def snooze(db: Session, user_id: uuid.UUID, reminder_id: uuid.UUID, *, minutes: int | None, until: datetime | None, now: datetime | None = None) -> Reminder:
    now = now or utcnow()
    reminder = get_reminder(db, user_id, reminder_id)
    if reminder.status != ReminderStatus.ACTIVE:
        raise ReminderError("Completed reminders can't be snoozed.", 409)
    target = now + timedelta(minutes=minutes) if minutes is not None else until.astimezone(UTC)
    if target <= now:
        raise ReminderError("Snooze until a time in the future.", 422)
    reminder.snoozed_until = target
    db.commit()
    db.refresh(reminder)
    return reminder


def complete(db: Session, user_id: uuid.UUID, reminder_id: uuid.UUID, now: datetime | None = None) -> Reminder:
    now = now or utcnow()
    reminder = get_reminder(db, user_id, reminder_id)
    if reminder.status != ReminderStatus.ACTIVE:
        raise ReminderError("This reminder is already completed.", 409)
    reminder.snoozed_until = None
    reminder.last_completed_at = now
    if reminder.repeat == ReminderRepeat.NONE:
        reminder.status = ReminderStatus.COMPLETED
        reminder.completed_at = now
    else:
        reminder.remind_at = next_occurrence(reminder, now)
    db.commit()
    db.refresh(reminder)
    return reminder
