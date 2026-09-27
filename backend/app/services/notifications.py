"""Notifications: generation (the recurring checks), the notification center, and preferences.

How duplicates are prevented: every notification has a `dedupe_key` that identifies the
event it's about, e.g. "bill_upcoming:<bill id>:2026-10-05". A unique index on
(user_id, dedupe_key) plus INSERT ... ON CONFLICT DO NOTHING means running the checks any
number of times, from any number of workers at once, creates each notification once.

Recurring records produce new events naturally: a recurring bill's next due date, a
reminder's next occurrence (or snooze time) and a recurring task's next copy all have
new keys, so each cycle notifies once.

The checks only read stored data and apply the same rules as the rest of the app
(task overdue / bill overdue / budget status / reminder due). Nothing is guessed.
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import (
    OPEN_TASK_STATUSES,
    Bill,
    BillStatus,
    Notification,
    NotificationPreferences,
    NotificationType,
    Reminder,
    ReminderStatus,
    SavingsGoal,
    Task,
)
from app.services import budgets as budget_service
from app.services import reminders as reminder_service
from app.services import tasks as task_service

MILESTONES = (25, 50, 75, 100)
TYPE_FIELDS = tuple(t.value for t in NotificationType)


class NotificationError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


# --- Formatting ------------------------------------------------------------------------------------------


def format_money(amount: Decimal, currency: str | None = None) -> str:
    """NPR with South Asian digit grouping (12,34,567.50), like the web app."""
    currency = currency or get_settings().default_currency
    negative = amount < 0
    whole, _, fraction = f"{abs(amount):.2f}".partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{'-' if negative else ''}{currency} {whole}.{fraction}"


def _day(value: date) -> str:
    return f"{value:%a} {value.day} {value:%b %Y}"


def _when(due: date, today: date) -> str:
    days = (due - today).days
    if days == 0:
        return "today"
    if days == 1:
        return "tomorrow"
    return f"in {days} days ({_day(due)})"


# --- Preferences ---------------------------------------------------------------------------------------


def get_preferences(db: Session, user_id: uuid.UUID) -> NotificationPreferences:
    prefs = db.get(NotificationPreferences, user_id)
    if prefs is None:
        db.execute(pg_insert(NotificationPreferences).values(user_id=user_id).on_conflict_do_nothing())
        db.commit()
        prefs = db.get(NotificationPreferences, user_id)
    return prefs


def update_preferences(db: Session, user_id: uuid.UUID, data: dict[str, Any]) -> NotificationPreferences:
    prefs = get_preferences(db, user_id)
    for field, value in data.items():
        setattr(prefs, field, value)
    db.commit()
    db.refresh(prefs)
    return prefs


# --- Creating notifications ----------------------------------------------------------------------------


def _create(db: Session, user_id: uuid.UUID, type_: NotificationType, key: str, title: str, message: str, related_type: str, related_id: uuid.UUID) -> bool:
    """Insert once per (user, key). Returns True only if a new row was created."""
    stmt = (
        pg_insert(Notification)
        .values(
            user_id=user_id,
            type=type_,
            dedupe_key=key[:200],
            title=title[:200],
            message=message,
            related_type=related_type,
            related_id=related_id,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "dedupe_key"])
        .returning(Notification.id)
    )
    return db.execute(stmt).first() is not None


def _check_tasks(db: Session, user_id: uuid.UUID, prefs: NotificationPreferences, local_now: datetime) -> int:
    today = local_now.date()
    horizon = today + timedelta(days=prefs.task_lead_days)
    tasks = db.scalars(
        select(Task).where(Task.user_id == user_id, Task.status.in_(OPEN_TASK_STATUSES), Task.due_date.is_not(None), Task.due_date <= horizon)
    )
    created = 0
    for task in tasks:
        time_text = f" at {task.due_time:%H:%M}" if task.due_time else ""
        if task_service.is_overdue(task, local_now):
            if prefs.task_overdue:
                created += _create(
                    db, user_id, NotificationType.TASK_OVERDUE,
                    f"task_overdue:{task.id}:{task.due_date}:{task.due_time or ''}",
                    f"Overdue task: {task.title}",
                    f"This task was due {_day(task.due_date)}{time_text} and isn't done yet.",
                    "task", task.id,
                )
        elif prefs.task_upcoming and task.due_date >= today:
            created += _create(
                db, user_id, NotificationType.TASK_UPCOMING,
                f"task_upcoming:{task.id}:{task.due_date}:{task.due_time or ''}",
                f"Task due {_when(task.due_date, today).split(' (')[0]}: {task.title}",
                f"Due {_when(task.due_date, today)}{time_text}.",
                "task", task.id,
            )
    return created


def _check_bills(db: Session, user_id: uuid.UUID, prefs: NotificationPreferences, today: date) -> int:
    horizon = today + timedelta(days=prefs.bill_lead_days)
    bills = db.scalars(select(Bill).where(Bill.user_id == user_id, Bill.status == BillStatus.PENDING, Bill.due_date <= horizon))
    created = 0
    for bill in bills:
        amount = format_money(bill.amount, bill.currency)
        if bill.due_date < today:
            if prefs.bill_overdue:
                created += _create(
                    db, user_id, NotificationType.BILL_OVERDUE,
                    f"bill_overdue:{bill.id}:{bill.due_date}",
                    f"Overdue bill: {bill.name}",
                    f"{amount} was due {_day(bill.due_date)} and hasn't been marked as paid.",
                    "bill", bill.id,
                )
        elif prefs.bill_upcoming:
            created += _create(
                db, user_id, NotificationType.BILL_UPCOMING,
                f"bill_upcoming:{bill.id}:{bill.due_date}",
                f"Bill due {_when(bill.due_date, today).split(' (')[0]}: {bill.name}",
                f"{amount} is due {_when(bill.due_date, today)}.",
                "bill", bill.id,
            )
    return created


def _check_budgets(db: Session, user_id: uuid.UUID, today: date) -> int:
    month = today.strftime("%Y-%m")
    created = 0
    for row in budget_service.budget_month(db, user_id, month)["budgets"]:
        if row["status"] == "ok":
            continue
        name = row["category"].name
        label = today.strftime("%B %Y")
        if row["status"] == "over":
            title = f"Over budget: {name}"
            message = (
                f"You've spent {format_money(row['spent'])} of your {format_money(row['amount'])} {name} budget for {label}, "
                f"{format_money(-row['remaining'])} over."
            )
        else:
            title = f"Budget {row['warning_threshold']}% reached: {name}"
            message = f"You've used {row['percent_used']}% of your {format_money(row['amount'])} {name} budget for {label}."
        # One notification per budget (a budget is for one month) per level: warning, then over.
        created += _create(db, user_id, NotificationType.BUDGET_THRESHOLD, f"budget:{row['id']}:{row['status']}", title, message, "budget", row["id"])
    return created


def _check_savings(db: Session, user_id: uuid.UUID) -> int:
    created = 0
    for goal in db.scalars(select(SavingsGoal).where(SavingsGoal.user_id == user_id)):
        reached = [m for m in MILESTONES if goal.current_amount * 100 >= goal.target_amount * m]
        if not reached:
            continue
        top = reached[-1]
        # Only the highest milestone reached is announced; lower ones aren't back-filled.
        higher_keys = [f"savings:{goal.id}:{m}" for m in MILESTONES if m >= top]
        already = db.scalar(
            select(func.count()).select_from(Notification).where(Notification.user_id == user_id, Notification.dedupe_key.in_(higher_keys))
        )
        if already:
            continue
        if top == 100:
            title = f"Savings goal reached: {goal.name}"
            message = f"You've saved {format_money(goal.current_amount, goal.currency)} of your {format_money(goal.target_amount, goal.currency)} target."
        else:
            title = f"{top}% of your savings goal: {goal.name}"
            message = f"You've saved {format_money(goal.current_amount, goal.currency)} of {format_money(goal.target_amount, goal.currency)}."
        created += _create(db, user_id, NotificationType.SAVINGS_MILESTONE, f"savings:{goal.id}:{top}", title, message, "savings_goal", goal.id)
    return created


def _check_reminders(db: Session, user_id: uuid.UUID, now: datetime) -> int:
    tz = get_settings().timezone
    created = 0
    reminders = db.scalars(select(Reminder).where(Reminder.user_id == user_id, Reminder.status == ReminderStatus.ACTIVE))
    for reminder in reminders:
        if not reminder_service.is_due(reminder, now):
            continue
        at = reminder_service.effective_at(reminder)
        local = at.astimezone(tz)
        message = reminder.notes or f"Set for {local:%H:%M} on {_day(local.date())}."
        # Each occurrence (and each snooze) is a separate event.
        created += _create(
            db, user_id, NotificationType.REMINDER_DUE, f"reminder:{reminder.id}:{at.astimezone(UTC).isoformat()}",
            f"Reminder: {reminder.title}", message, "reminder", reminder.id,
        )
    return created


def check_user(db: Session, user_id: uuid.UUID, now: datetime | None = None) -> int:
    """Run every enabled check for one user. Safe to call repeatedly. Returns how many were created."""
    now = now or datetime.now(UTC)
    local_now = task_service.local_now(now)
    prefs = get_preferences(db, user_id)
    created = 0
    if prefs.task_overdue or prefs.task_upcoming:
        created += _check_tasks(db, user_id, prefs, local_now)
    if prefs.bill_overdue or prefs.bill_upcoming:
        created += _check_bills(db, user_id, prefs, local_now.date())
    if prefs.budget_threshold:
        created += _check_budgets(db, user_id, local_now.date())
    if prefs.savings_milestone:
        created += _check_savings(db, user_id)
    if prefs.reminder_due:
        created += _check_reminders(db, user_id, now)
    db.commit()
    return created


def purge_old(db: Session, now: datetime | None = None) -> int:
    """Delete read or dismissed notifications older than the retention period (unread ones are kept).

    After that, a condition that is STILL true (e.g. a bill overdue for months) may notify again,
    which is a deliberate, rare re-reminder rather than a duplicate."""
    cutoff = (now or datetime.now(UTC)) - timedelta(days=get_settings().notification_retention_days)
    result = db.execute(
        delete(Notification).where(
            (Notification.read_at.is_not(None)) | (Notification.dismissed_at.is_not(None)), Notification.created_at < cutoff
        )
    )
    db.commit()
    return result.rowcount or 0


# --- Notification center -------------------------------------------------------------------------------


def to_out(n: Notification) -> dict[str, Any]:
    return {
        "id": n.id,
        "type": n.type,
        "title": n.title,
        "message": n.message,
        "related_type": n.related_type,
        "related_id": n.related_id,
        "is_read": n.read_at is not None,
        "read_at": n.read_at,
        "created_at": n.created_at,
    }


def _visible(user_id: uuid.UUID) -> list[Any]:
    return [Notification.user_id == user_id, Notification.dismissed_at.is_(None)]


def unread_count(db: Session, user_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).select_from(Notification).where(*_visible(user_id), Notification.read_at.is_(None)))


def list_notifications(db: Session, user_id: uuid.UUID, *, unread_only: bool = False, type_: str | None = None, limit: int = 20, offset: int = 0) -> dict[str, Any]:
    conditions = _visible(user_id)
    if unread_only:
        conditions.append(Notification.read_at.is_(None))
    if type_:
        conditions.append(Notification.type == type_)
    total = db.scalar(select(func.count()).select_from(Notification).where(*conditions))
    items = db.scalars(
        select(Notification).where(*conditions).order_by(Notification.created_at.desc(), Notification.id).limit(limit).offset(offset)
    ).all()
    return {"items": [to_out(n) for n in items], "total": total, "unread_count": unread_count(db, user_id)}


def _get(db: Session, user_id: uuid.UUID, notification_id: uuid.UUID) -> Notification:
    n = db.scalar(select(Notification).where(Notification.id == notification_id, *_visible(user_id)))
    if n is None:
        raise NotificationError("Notification not found.", 404)
    return n


def set_read(db: Session, user_id: uuid.UUID, notification_id: uuid.UUID, read: bool) -> Notification:
    n = _get(db, user_id, notification_id)
    n.read_at = (n.read_at or datetime.now(UTC)) if read else None
    db.commit()
    db.refresh(n)
    return n


def mark_all_read(db: Session, user_id: uuid.UUID) -> int:
    result = db.execute(
        update(Notification).where(*_visible(user_id), Notification.read_at.is_(None)).values(read_at=datetime.now(UTC))
    )
    db.commit()
    return result.rowcount or 0


def dismiss(db: Session, user_id: uuid.UUID, notification_id: uuid.UUID) -> None:
    n = _get(db, user_id, notification_id)
    now = datetime.now(UTC)
    n.read_at = n.read_at or now
    n.dismissed_at = now
    db.commit()


def dismiss_read(db: Session, user_id: uuid.UUID) -> int:
    result = db.execute(
        update(Notification).where(*_visible(user_id), Notification.read_at.is_not(None)).values(dismissed_at=datetime.now(UTC))
    )
    db.commit()
    return result.rowcount or 0
