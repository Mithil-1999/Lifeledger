"""Personal calendar: the user's own events plus a live view of tasks, reminders, bills and goal deadlines.

Only events are stored by this module. Everything else is read from its own table each
time the calendar is built, so nothing is duplicated and nothing can drift out of date.
Future repeats of recurring items (events, reminders, bills) are computed for the
requested range and marked `is_projected`; they are never written to the database.

An event's "remind me" setting is delivered by a normal Reminder row (it appears in the
Reminders module and the dashboard), linked through `calendar_events.reminder_id`. The
calendar shows that reminder on the event itself rather than as a second item.

All dates and times are wall-clock values in APP_TIMEZONE.
"""

import uuid
from collections import Counter
from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.models import (
    Bill,
    BillFrequency,
    BillPayment,
    BillStatus,
    CalendarEvent,
    EventRecurrence,
    Reminder,
    ReminderRepeat,
    ReminderStatus,
    SavingsGoal,
    Task,
    TaskStatus,
)
from app.services import reminders as reminder_service
from app.services import tasks as task_service
from app.services.bills import add_months, effective_status, next_due_date

MAX_RANGE_DAYS = 366
# All-day events have no start time; their reminders count back from this local time.
ALL_DAY_REMINDER_TIME = time(9, 0)
# Safety cap on how many repeats of one item a single request will compute.
MAX_REPEATS = 5000


class CalendarError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def local_now(now: datetime | None = None) -> datetime:
    return task_service.local_now(now)


# --- Event recurrence -------------------------------------------------------------------------------------


def nth_occurrence(start: date, recurrence: str | None, anchor_day: int, n: int) -> date:
    """Start date of the n-th occurrence (0 = the event itself). Computed from the first date, so it never drifts."""
    if n == 0 or recurrence is None:
        return start
    rec = EventRecurrence(recurrence)
    if rec == EventRecurrence.DAILY:
        return start + timedelta(days=n)
    if rec == EventRecurrence.WEEKLY:
        return start + timedelta(weeks=n)
    return add_months(start, n if rec == EventRecurrence.MONTHLY else 12 * n, anchor_day)


def _first_index(start: date, recurrence: str, lo: date) -> int:
    """A lower bound for the first occurrence index that can start on or after `lo`."""
    if lo <= start:
        return 0
    rec = EventRecurrence(recurrence)
    if rec == EventRecurrence.DAILY:
        return (lo - start).days
    if rec == EventRecurrence.WEEKLY:
        return (lo - start).days // 7
    months = (lo.year * 12 + lo.month) - (start.year * 12 + start.month) - 1
    return max(0, months if rec == EventRecurrence.MONTHLY else months // 12)


def occurrence_dates(event: CalendarEvent, lo: date, hi: date) -> Iterator[date]:
    """Start dates of every occurrence that overlaps [lo, hi] (multi-day events included)."""
    duration = timedelta(days=(event.end_date - event.start_date).days)
    if event.recurrence is None:
        if event.start_date <= hi and event.end_date >= lo:
            yield event.start_date
        return
    n = _first_index(event.start_date, event.recurrence, lo - duration)
    for _ in range(MAX_REPEATS):
        occ = nth_occurrence(event.start_date, event.recurrence, event.anchor_day, n)
        if occ > hi:
            return
        if occ + duration >= lo:
            yield occ
        n += 1


# --- Event reminders ------------------------------------------------------------------------------------------


def _fire_at(event: CalendarEvent, occ: date) -> datetime:
    starts = datetime.combine(occ, event.start_time or ALL_DAY_REMINDER_TIME, tzinfo=get_settings().timezone)
    return starts - timedelta(minutes=event.reminder_minutes or 0)


def next_reminder_time(event: CalendarEvent, now: datetime) -> datetime | None:
    """When the event's reminder should next fire (local time), or None if every occurrence has passed."""
    if event.reminder_minutes is None:
        return None
    today = now.astimezone(get_settings().timezone).date()
    # An occurrence that starts before today can't have a reminder still to come.
    for occ in occurrence_dates(event, today, today + timedelta(days=800)):
        if occ < today and event.recurrence is not None:
            continue
        fire = _fire_at(event, occ)
        if fire > now:
            return fire
    return None


def _reminder_note(event: CalendarEvent) -> str:
    minutes = event.reminder_minutes or 0
    if minutes == 0:
        when = "when it starts"
    elif minutes % 1440 == 0:
        days = minutes // 1440
        when = "1 week before" if days == 7 else f"{days} day{'s' if days > 1 else ''} before"
    elif minutes % 60 == 0:
        hours = minutes // 60
        when = f"{hours} hour{'s' if hours > 1 else ''} before"
    else:
        when = f"{minutes} minutes before"
    note = f"Calendar event reminder ({when})."
    return f"{note} Location: {event.location}" if event.location else note


def sync_event_reminder(db: Session, event: CalendarEvent, now: datetime) -> None:
    """Create, update or remove the Reminder row that delivers this event's "remind me"."""
    reminder = db.get(Reminder, event.reminder_id) if event.reminder_id else None
    if reminder is not None and reminder.user_id != event.user_id:
        reminder = None
    fire = next_reminder_time(event, now)
    if fire is None:
        if reminder is not None:
            db.delete(reminder)
        event.reminder_id = None
        return
    if reminder is None:
        reminder = Reminder(user_id=event.user_id)
        db.add(reminder)
    reminder.title = event.title
    reminder.notes = _reminder_note(event)
    reminder.remind_at = fire.astimezone(UTC)
    reminder.repeat = event.recurrence or ReminderRepeat.NONE
    reminder.interval_count = None
    reminder.interval_unit = None
    reminder.anchor_day = fire.day
    reminder.status = ReminderStatus.ACTIVE
    reminder.snoozed_until = None
    reminder.completed_at = None
    db.flush()
    event.reminder_id = reminder.id


# --- Event CRUD -------------------------------------------------------------------------------------------------


def event_out(event: CalendarEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "title": event.title,
        "description": event.description,
        "location": event.location,
        "event_type": event.event_type,
        "category": event.category,
        "start_date": event.start_date,
        "end_date": event.end_date,
        "start_time": event.start_time,
        "end_time": event.end_time,
        "all_day": event.start_time is None,
        "recurrence": event.recurrence,
        "reminder_minutes": event.reminder_minutes,
        "reminder_id": event.reminder_id,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
    }


def get_event(db: Session, user_id: uuid.UUID, event_id: uuid.UUID) -> CalendarEvent:
    event = db.scalar(select(CalendarEvent).where(CalendarEvent.id == event_id, CalendarEvent.user_id == user_id))
    if event is None:
        raise CalendarError("Event not found.", 404)
    return event


def _apply(event: CalendarEvent, data: dict[str, Any]) -> None:
    for field in (
        "title", "description", "location", "event_type", "category",
        "start_date", "end_date", "start_time", "end_time", "recurrence", "reminder_minutes",
    ):
        setattr(event, field, data[field])
    event.anchor_day = data["start_date"].day


def create_event(db: Session, user_id: uuid.UUID, data: dict[str, Any], now: datetime | None = None) -> CalendarEvent:
    event = CalendarEvent(user_id=user_id)
    _apply(event, data)
    db.add(event)
    db.flush()
    sync_event_reminder(db, event, now or datetime.now(UTC))
    db.commit()
    db.refresh(event)
    return event


def update_event(
    db: Session, user_id: uuid.UUID, event_id: uuid.UUID, data: dict[str, Any], now: datetime | None = None
) -> CalendarEvent:
    event = get_event(db, user_id, event_id)
    _apply(event, data)
    sync_event_reminder(db, event, now or datetime.now(UTC))
    db.commit()
    db.refresh(event)
    return event


def delete_event(db: Session, user_id: uuid.UUID, event_id: uuid.UUID) -> None:
    event = get_event(db, user_id, event_id)
    if event.reminder_id is not None:
        reminder = db.get(Reminder, event.reminder_id)
        if reminder is not None and reminder.user_id == user_id:
            db.delete(reminder)
    db.delete(event)
    db.commit()


# --- The combined calendar feed ---------------------------------------------------------------------------------


def _item(source: str, source_id: uuid.UUID, title: str, day: date, **extra: Any) -> dict[str, Any]:
    item = {
        "key": f"{source}:{source_id}:{day.isoformat()}",
        "source": source,
        "source_id": source_id,
        "title": title,
        "date": day,
        "end_date": day,
        "start_time": None,
        "end_time": None,
        "all_day": True,
        "kind": source,
        "category": None,
        "status": None,
        "is_done": False,
        "is_overdue": False,
        "is_projected": False,
        "description": None,
        "location": None,
        "amount": None,
        "currency": None,
        "priority": None,
        "recurrence": None,
        "reminder_minutes": None,
    }
    item.update(extra)
    return item


def _event_items(db: Session, user_id: uuid.UUID, start: date, end: date, category: str | None) -> list[dict[str, Any]]:
    query = select(CalendarEvent).where(
        CalendarEvent.user_id == user_id,
        CalendarEvent.start_date <= end,
        or_(CalendarEvent.recurrence.is_not(None), CalendarEvent.end_date >= start),
    )
    if category:
        query = query.where(CalendarEvent.category == category)
    items = []
    for event in db.scalars(query):
        span = event.end_date - event.start_date
        for occ in occurrence_dates(event, start, end):
            items.append(
                _item(
                    "event", event.id, event.title, occ,
                    end_date=occ + span,
                    start_time=event.start_time,
                    end_time=event.end_time,
                    all_day=event.start_time is None,
                    kind=event.event_type,
                    category=event.category,
                    is_projected=occ != event.start_date,
                    description=event.description,
                    location=event.location,
                    recurrence=event.recurrence,
                    reminder_minutes=event.reminder_minutes,
                )
            )
    return items


def _task_items(db: Session, user_id: uuid.UUID, start: date, end: date, now: datetime) -> list[dict[str, Any]]:
    tasks = db.scalars(
        select(Task).where(
            Task.user_id == user_id,
            Task.due_date.between(start, end),
            Task.status != TaskStatus.CANCELLED,
        )
    )
    return [
        _item(
            "task", task.id, task.title, task.due_date,
            start_time=task.due_time,
            all_day=task.due_time is None,
            category=task.category,
            status=task.status,
            is_done=task.status == TaskStatus.COMPLETED,
            is_overdue=task_service.is_overdue(task, now),
            description=task.description,
            priority=task.priority,
            recurrence=task.recurrence,
        )
        for task in tasks
    ]


def _reminder_items(db: Session, user_id: uuid.UUID, start: date, end: date, now: datetime) -> list[dict[str, Any]]:
    tz = get_settings().timezone
    # Reminders created for calendar events are shown on the event itself, not twice.
    event_reminders = select(CalendarEvent.reminder_id).where(
        CalendarEvent.user_id == user_id, CalendarEvent.reminder_id.is_not(None)
    )
    reminders = db.scalars(select(Reminder).where(Reminder.user_id == user_id, Reminder.id.not_in(event_reminders)))
    utc_now = now.astimezone(UTC)
    items = []
    for reminder in reminders:
        common = {
            "description": reminder.notes,
            "recurrence": None if reminder.repeat == ReminderRepeat.NONE else reminder.repeat,
            "all_day": False,
        }
        current = reminder_service.effective_at(reminder).astimezone(tz)
        if reminder.status == ReminderStatus.COMPLETED:
            status = "completed"
        elif reminder_service.is_due(reminder, utc_now):
            status = "due"
        else:
            status = "snoozed" if reminder.snoozed_until else "scheduled"
        if start <= current.date() <= end:
            items.append(
                _item(
                    "reminder", reminder.id, reminder.title, current.date(),
                    start_time=current.time().replace(second=0, microsecond=0, tzinfo=None),
                    status=status,
                    is_done=status == "completed",
                    is_overdue=status == "due",
                    **common,
                )
            )
        if reminder.status != ReminderStatus.ACTIVE or reminder.repeat == ReminderRepeat.NONE:
            continue
        # Upcoming repeats, computed from the stored next occurrence (never stored themselves). Repeats
        # already in the past are left out: completing a late reminder skips them, so they never fire.
        local = reminder.remind_at.astimezone(tz)
        for _ in range(MAX_REPEATS):
            local = reminder_service._step(local, reminder)
            if local.date() > end:
                break
            if local.date() >= start and local > now:
                items.append(
                    _item(
                        "reminder", reminder.id, reminder.title, local.date(),
                        start_time=local.time().replace(second=0, microsecond=0, tzinfo=None),
                        status="scheduled",
                        is_projected=True,
                        **common,
                    )
                )
    return items


def _bill_items(db: Session, user_id: uuid.UUID, start: date, end: date, today: date) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[tuple[uuid.UUID, date]] = set()

    def bill_item(bill: Bill, day: date, **extra: Any) -> dict[str, Any]:
        return _item(
            "bill", bill.id, bill.name, day,
            category=bill.category,
            description=bill.notes,
            currency=bill.currency,
            recurrence=None if bill.frequency == BillFrequency.ONE_TIME else bill.frequency,
            **extra,
        )

    # Paid occurrences, from the payment history (a recurring bill has moved on to its next due date).
    payments = db.scalars(
        select(BillPayment)
        .options(joinedload(BillPayment.bill))
        .where(BillPayment.user_id == user_id, BillPayment.due_date.between(start, end))
    )
    for payment in payments:
        key = (payment.bill_id, payment.due_date)
        if key in seen:
            continue
        seen.add(key)
        items.append(bill_item(payment.bill, payment.due_date, amount=payment.amount, status="paid", is_done=True))

    for bill in db.scalars(select(Bill).where(Bill.user_id == user_id, Bill.due_date <= end)):
        status = effective_status(bill, today)
        if start <= bill.due_date and (bill.id, bill.due_date) not in seen:
            items.append(
                bill_item(
                    bill, bill.due_date,
                    amount=bill.amount, status=status, is_done=status == "paid", is_overdue=status == "overdue",
                )
            )
        if bill.status != BillStatus.PENDING or bill.frequency == BillFrequency.ONE_TIME:
            continue
        due = bill.due_date
        for _ in range(MAX_REPEATS):
            due = next_due_date(due, bill.frequency, bill.anchor_day)
            if due > end:
                break
            if due >= start:
                items.append(bill_item(bill, due, amount=bill.amount, status="upcoming", is_projected=True))
    return items


def _goal_items(db: Session, user_id: uuid.UUID, start: date, end: date, today: date) -> list[dict[str, Any]]:
    goals = db.scalars(
        select(SavingsGoal).where(SavingsGoal.user_id == user_id, SavingsGoal.target_date.between(start, end))
    )
    items = []
    for goal in goals:
        reached = goal.current_amount >= goal.target_amount
        overdue = not reached and goal.target_date < today
        items.append(
            _item(
                "goal", goal.id, goal.name, goal.target_date,
                kind="deadline",
                status="reached" if reached else "overdue" if overdue else "open",
                is_done=reached,
                is_overdue=overdue,
                description=goal.description,
                amount=goal.target_amount,
                currency=goal.currency,
            )
        )
    return items


def _matches(item: dict[str, Any], needle: str) -> bool:
    haystack = " ".join(filter(None, (item["title"], item["description"], item["location"], item["category"])))
    return needle in haystack.casefold()


def build_feed(
    db: Session,
    user_id: uuid.UUID,
    start: date,
    end: date,
    *,
    sources: set[str],
    search: str | None = None,
    category: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    if end < start:
        raise CalendarError("The end date can't be before the start date.", 422)
    if (end - start).days > MAX_RANGE_DAYS:
        raise CalendarError(f"Ask for at most {MAX_RANGE_DAYS} days at a time.", 422)
    now_local = local_now(now)
    today = now_local.date()

    items: list[dict[str, Any]] = []
    if "event" in sources:
        items += _event_items(db, user_id, start, end, category)
    if "task" in sources:
        items += _task_items(db, user_id, start, end, now_local)
    if "reminder" in sources:
        items += _reminder_items(db, user_id, start, end, now_local)
    if "bill" in sources:
        items += _bill_items(db, user_id, start, end, today)
    if "goal" in sources:
        items += _goal_items(db, user_id, start, end, today)

    if search:
        needle = search.strip().casefold()
        items = [item for item in items if _matches(item, needle)]
    items.sort(key=lambda i: (i["date"], not i["all_day"], i["start_time"] or time.min, i["title"].casefold()))
    return {
        "start": start,
        "end": end,
        "today": today,
        "items": items,
        "counts": dict(Counter(item["source"] for item in items)),
    }
