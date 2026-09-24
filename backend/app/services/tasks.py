"""Tasks: CRUD, views, the "haven't worked on" list and recurring occurrences.

"Overdue" and "due soon" are derived from the stored status and due date/time in
APP_TIMEZONE; they are never stored, so they can't go stale. Nothing here infers what
the user has or hasn't done beyond the stored status.
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import OPEN_TASK_STATUSES, PRIORITY_RANK, Task, TaskPriority, TaskRecurrence, TaskStatus
from app.services.bills import add_months

DUE_SOON_DAYS = 3


class TaskError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def local_now(now: datetime | None = None) -> datetime:
    return (now or datetime.now(UTC)).astimezone(get_settings().timezone)


# --- Derived state -------------------------------------------------------------------------------------


def is_open(task: Task) -> bool:
    return task.status in OPEN_TASK_STATUSES


def is_overdue(task: Task, now: datetime) -> bool:
    if not is_open(task) or task.due_date is None:
        return False
    today = now.date()
    if task.due_date < today:
        return True
    return task.due_date == today and task.due_time is not None and task.due_time < now.time().replace(tzinfo=None)


def is_due_soon(task: Task, now: datetime) -> bool:
    today = now.date()
    return (
        is_open(task)
        and task.due_date is not None
        and not is_overdue(task, now)
        and today <= task.due_date <= today + timedelta(days=DUE_SOON_DAYS)
    )


def to_out(task: Task, now: datetime) -> dict[str, Any]:
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "category": task.category,
        "priority": task.priority,
        "status": task.status,
        "due_date": task.due_date,
        "due_time": task.due_time,
        "recurrence": task.recurrence,
        "created_at": task.created_at,
        "completed_at": task.completed_at,
        "previous_task_id": task.previous_task_id,
        "is_overdue": is_overdue(task, now),
        "is_due_soon": is_due_soon(task, now),
    }


def _sort_key(task: Task):
    """Soonest due first (undated last), then by time, then most important."""
    return (
        task.due_date is None,
        task.due_date or date.max,
        task.due_time is None,
        task.due_time or datetime.max.time(),
        PRIORITY_RANK[TaskPriority(task.priority)],
        task.title.lower(),
    )


def in_view(task: Task, view: str, now: datetime) -> bool:
    today = now.date()
    if view == "all":
        return True
    if view == "completed":
        return task.status == TaskStatus.COMPLETED
    if not is_open(task):
        return False
    if view == "today":
        return task.due_date == today
    if view == "upcoming":
        return task.due_date is not None and task.due_date > today
    if view == "overdue":
        return is_overdue(task, now)
    raise ValueError(view)


# --- Reading -----------------------------------------------------------------------------------------------


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _query(db: Session, user_id: uuid.UUID, *, status: str | None = None, priority: str | None = None, category: str | None = None, search: str | None = None) -> list[Task]:
    stmt = select(Task).where(Task.user_id == user_id)
    if status:
        stmt = stmt.where(Task.status == status)
    if priority:
        stmt = stmt.where(Task.priority == priority)
    if category:
        stmt = stmt.where(func.lower(Task.category) == category.lower())
    if search:
        pattern = f"%{_escape_like(search.strip())}%"
        stmt = stmt.where(or_(Task.title.ilike(pattern, escape="\\"), Task.description.ilike(pattern, escape="\\"), Task.category.ilike(pattern, escape="\\")))
    return list(db.scalars(stmt))


def list_tasks(db: Session, user_id: uuid.UUID, view: str, now: datetime | None = None, **filters: Any) -> dict[str, Any]:
    now = local_now(now)
    tasks = _query(db, user_id, **filters)
    counts = {v: sum(1 for t in tasks if in_view(t, v, now)) for v in ("today", "upcoming", "overdue", "completed", "all")}
    selected = [t for t in tasks if in_view(t, view, now)]
    if view == "completed":
        selected.sort(key=lambda t: t.completed_at or datetime.min.replace(tzinfo=UTC), reverse=True)
    elif view == "all":
        # Open tasks first (soonest due), then completed/cancelled.
        selected.sort(key=lambda t: (not is_open(t), _sort_key(t)))
    else:
        selected.sort(key=_sort_key)
    return {"view": view, "items": [to_out(t, now) for t in selected], "counts": counts}


def pending_tasks(db: Session, user_id: uuid.UUID, now: datetime | None = None) -> dict[str, Any]:
    now = local_now(now)
    tasks = sorted(_query(db, user_id, status=TaskStatus.NOT_STARTED), key=_sort_key)
    overdue = [t for t in tasks if is_overdue(t, now)]
    due_soon = [t for t in tasks if is_due_soon(t, now)]
    rest = [t for t in tasks if t not in overdue and t not in due_soon]
    return {
        "due_soon_days": DUE_SOON_DAYS,
        "overdue": [to_out(t, now) for t in overdue],
        "due_soon": [to_out(t, now) for t in due_soon],
        "not_started": [to_out(t, now) for t in rest],
    }


def categories(db: Session, user_id: uuid.UUID) -> list[str]:
    rows = db.scalars(
        select(Task.category).where(Task.user_id == user_id, Task.category.is_not(None)).group_by(Task.category).order_by(func.lower(Task.category))
    )
    return list(rows)


def get_task(db: Session, user_id: uuid.UUID, task_id: uuid.UUID) -> Task:
    task = db.scalar(select(Task).where(Task.id == task_id, Task.user_id == user_id))
    if task is None:
        raise TaskError("Task not found.", 404)
    return task


# --- Recurrence ----------------------------------------------------------------------------------------------


def next_due_date(due: date, recurrence: str, anchor_day: int, today: date) -> date:
    """Next occurrence strictly after `due`, skipping occurrences already in the past."""

    def step(value: date) -> date:
        if recurrence == TaskRecurrence.DAILY:
            return value + timedelta(days=1)
        if recurrence == TaskRecurrence.WEEKLY:
            return value + timedelta(days=7)
        return add_months(value, 1 if recurrence == TaskRecurrence.MONTHLY else 12, anchor_day)

    candidate = step(due)
    while candidate < today:
        candidate = step(candidate)
    return candidate


def _spawn_next_occurrence(db: Session, task: Task, today: date) -> None:
    already = db.scalar(select(Task.id).where(Task.previous_task_id == task.id))
    if already is not None:  # e.g. completed, reopened, completed again
        return
    db.add(
        Task(
            user_id=task.user_id,
            title=task.title,
            description=task.description,
            category=task.category,
            priority=task.priority,
            status=TaskStatus.NOT_STARTED,
            due_date=next_due_date(task.due_date, task.recurrence, task.anchor_day or task.due_date.day, today),
            due_time=task.due_time,
            recurrence=task.recurrence,
            anchor_day=task.anchor_day,
            previous_task_id=task.id,
        )
    )


# --- Writing -----------------------------------------------------------------------------------------------------


def _set_status(db: Session, task: Task, status: str, now: datetime) -> None:
    was_completed = task.status == TaskStatus.COMPLETED
    task.status = status
    if status == TaskStatus.COMPLETED:
        if not was_completed:
            task.completed_at = now.astimezone(UTC)
            if task.recurrence and task.due_date:
                _spawn_next_occurrence(db, task, now.date())
    else:
        task.completed_at = None


def _apply(db: Session, task: Task, data: dict[str, Any], now: datetime) -> None:
    status = data.pop("status")
    for field, value in data.items():
        setattr(task, field, value)
    task.anchor_day = task.due_date.day if task.recurrence and task.due_date else None
    _set_status(db, task, status, now)


def create_task(db: Session, user_id: uuid.UUID, data: dict[str, Any], now: datetime | None = None) -> Task:
    now = local_now(now)
    task = Task(user_id=user_id, status=TaskStatus.NOT_STARTED)
    db.add(task)
    _apply(db, task, dict(data), now)
    db.commit()
    db.refresh(task)
    return task


def update_task(db: Session, user_id: uuid.UUID, task_id: uuid.UUID, data: dict[str, Any], now: datetime | None = None) -> Task:
    now = local_now(now)
    task = get_task(db, user_id, task_id)
    _apply(db, task, dict(data), now)
    db.commit()
    db.refresh(task)
    return task


def set_status(db: Session, user_id: uuid.UUID, task_id: uuid.UUID, status: str, now: datetime | None = None) -> Task:
    now = local_now(now)
    task = get_task(db, user_id, task_id)
    _set_status(db, task, status, now)
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, user_id: uuid.UUID, task_id: uuid.UUID) -> None:
    db.delete(get_task(db, user_id, task_id))
    db.commit()
