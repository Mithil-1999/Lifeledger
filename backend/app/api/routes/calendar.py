"""Personal calendar. All routes require a signed-in user and only touch that user's data."""

import uuid
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.models import EventCategory
from app.schemas.calendar import CALENDAR_SOURCES, CalendarFeed, EventIn, EventOut
from app.services import calendar as calendar_service

router = APIRouter(prefix="/calendar", tags=["calendar"])


def _http(exc: Exception) -> HTTPException:
    return HTTPException(status_code=getattr(exc, "status_code", 400), detail=str(exc))


@router.get("", response_model=CalendarFeed)
def calendar_feed(
    user: CurrentUser,
    db: DbSession,
    start: date,
    end: date,
    search: Annotated[str | None, Query(max_length=100)] = None,
    sources: Annotated[str | None, Query(max_length=100, description="Comma-separated: event,task,reminder,bill,goal")] = None,
    category: EventCategory | None = None,
) -> Any:
    """Events plus tasks, reminders, bills and savings-goal deadlines between `start` and `end` (inclusive)."""
    selected = set(CALENDAR_SOURCES)
    if sources:
        selected = {s.strip() for s in sources.split(",") if s.strip()}
        unknown = selected - set(CALENDAR_SOURCES)
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown calendar source: {sorted(unknown)[0]}.")
    try:
        return calendar_service.build_feed(
            db, user.id, start, end, sources=selected, search=search or None, category=category.value if category else None
        )
    except calendar_service.CalendarError as exc:
        raise _http(exc) from None


@router.post("/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(payload: EventIn, user: CurrentUser, db: DbSession) -> Any:
    return calendar_service.event_out(calendar_service.create_event(db, user.id, payload.model_dump()))


@router.get("/events/{event_id}", response_model=EventOut)
def get_event(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Any:
    try:
        return calendar_service.event_out(calendar_service.get_event(db, user.id, event_id))
    except calendar_service.CalendarError as exc:
        raise _http(exc) from None


@router.put("/events/{event_id}", response_model=EventOut)
def update_event(event_id: uuid.UUID, payload: EventIn, user: CurrentUser, db: DbSession) -> Any:
    try:
        return calendar_service.event_out(calendar_service.update_event(db, user.id, event_id, payload.model_dump()))
    except calendar_service.CalendarError as exc:
        raise _http(exc) from None


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    try:
        calendar_service.delete_event(db, user.id, event_id)
    except calendar_service.CalendarError as exc:
        raise _http(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
