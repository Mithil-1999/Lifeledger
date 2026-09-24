"""Tasks and reminders. All routes require a signed-in user and only touch that user's data."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.models import TaskPriority, TaskStatus
from app.schemas.productivity import (
    PendingTasks,
    ReminderIn,
    ReminderList,
    ReminderOut,
    ReminderView,
    SnoozeIn,
    TaskIn,
    TaskList,
    TaskOut,
    TaskStatusIn,
    TaskView,
)
from app.services import reminders as reminder_service
from app.services import tasks as task_service

router = APIRouter()


def _http(exc: Exception) -> HTTPException:
    return HTTPException(status_code=getattr(exc, "status_code", 400), detail=str(exc))


# --- Tasks -------------------------------------------------------------------------------------------------


@router.get("/tasks", response_model=TaskList, tags=["tasks"])
def list_tasks(
    user: CurrentUser,
    db: DbSession,
    view: TaskView = "all",
    status_filter: Annotated[TaskStatus | None, Query(alias="status")] = None,
    priority: TaskPriority | None = None,
    category: Annotated[str | None, Query(max_length=50)] = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
) -> Any:
    return task_service.list_tasks(
        db,
        user.id,
        view,
        status=status_filter.value if status_filter else None,
        priority=priority.value if priority else None,
        category=category or None,
        search=search or None,
    )


@router.get("/tasks/pending", response_model=PendingTasks, tags=["tasks"])
def pending_tasks(user: CurrentUser, db: DbSession) -> Any:
    """Tasks you haven't started (stored status "Not Started"), grouped into overdue / due soon / the rest."""
    return task_service.pending_tasks(db, user.id)


@router.get("/tasks/categories", response_model=list[str], tags=["tasks"])
def task_categories(user: CurrentUser, db: DbSession) -> Any:
    return task_service.categories(db, user.id)


@router.post("/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED, tags=["tasks"])
def create_task(payload: TaskIn, user: CurrentUser, db: DbSession) -> Any:
    task = task_service.create_task(db, user.id, payload.model_dump())
    return task_service.to_out(task, task_service.local_now())


@router.get("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
def get_task(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Any:
    try:
        return task_service.to_out(task_service.get_task(db, user.id, task_id), task_service.local_now())
    except task_service.TaskError as exc:
        raise _http(exc) from None


@router.put("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
def update_task(task_id: uuid.UUID, payload: TaskIn, user: CurrentUser, db: DbSession) -> Any:
    try:
        task = task_service.update_task(db, user.id, task_id, payload.model_dump())
    except task_service.TaskError as exc:
        raise _http(exc) from None
    return task_service.to_out(task, task_service.local_now())


@router.patch("/tasks/{task_id}/status", response_model=TaskOut, tags=["tasks"])
def set_task_status(task_id: uuid.UUID, payload: TaskStatusIn, user: CurrentUser, db: DbSession) -> Any:
    try:
        task = task_service.set_status(db, user.id, task_id, payload.status.value)
    except task_service.TaskError as exc:
        raise _http(exc) from None
    return task_service.to_out(task, task_service.local_now())


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["tasks"])
def delete_task(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    try:
        task_service.delete_task(db, user.id, task_id)
    except task_service.TaskError as exc:
        raise _http(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Reminders ------------------------------------------------------------------------------------------------


def _reminder_out(reminder) -> dict:
    return reminder_service.to_out(reminder, reminder_service.utcnow())


@router.get("/reminders", response_model=ReminderList, tags=["reminders"])
def list_reminders(user: CurrentUser, db: DbSession, view: ReminderView = "all") -> Any:
    return reminder_service.list_reminders(db, user.id, view)


@router.post("/reminders", response_model=ReminderOut, status_code=status.HTTP_201_CREATED, tags=["reminders"])
def create_reminder(payload: ReminderIn, user: CurrentUser, db: DbSession) -> Any:
    return _reminder_out(reminder_service.create_reminder(db, user.id, payload.model_dump()))


@router.get("/reminders/{reminder_id}", response_model=ReminderOut, tags=["reminders"])
def get_reminder(reminder_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Any:
    try:
        return _reminder_out(reminder_service.get_reminder(db, user.id, reminder_id))
    except reminder_service.ReminderError as exc:
        raise _http(exc) from None


@router.put("/reminders/{reminder_id}", response_model=ReminderOut, tags=["reminders"])
def update_reminder(reminder_id: uuid.UUID, payload: ReminderIn, user: CurrentUser, db: DbSession) -> Any:
    try:
        return _reminder_out(reminder_service.update_reminder(db, user.id, reminder_id, payload.model_dump()))
    except reminder_service.ReminderError as exc:
        raise _http(exc) from None


@router.delete("/reminders/{reminder_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["reminders"])
def delete_reminder(reminder_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    try:
        reminder_service.delete_reminder(db, user.id, reminder_id)
    except reminder_service.ReminderError as exc:
        raise _http(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/reminders/{reminder_id}/snooze", response_model=ReminderOut, tags=["reminders"])
def snooze_reminder(reminder_id: uuid.UUID, payload: SnoozeIn, user: CurrentUser, db: DbSession) -> Any:
    try:
        reminder = reminder_service.snooze(db, user.id, reminder_id, minutes=payload.minutes, until=payload.until)
    except reminder_service.ReminderError as exc:
        raise _http(exc) from None
    return _reminder_out(reminder)


@router.post("/reminders/{reminder_id}/complete", response_model=ReminderOut, tags=["reminders"])
def complete_reminder(reminder_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Any:
    try:
        reminder = reminder_service.complete(db, user.id, reminder_id)
    except reminder_service.ReminderError as exc:
        raise _http(exc) from None
    return _reminder_out(reminder)
