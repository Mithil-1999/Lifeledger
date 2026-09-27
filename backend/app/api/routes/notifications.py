"""Notification center and preferences. All routes require a signed-in user and only touch that user's data."""

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.core.rate_limit import Limit, enforce
from app.models import NotificationType
from app.schemas.notifications import CheckResult, CountOut, NotificationList, NotificationOut, PreferencesIn, PreferencesOut, ReadIn, UnreadCount
from app.services import notifications as notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])

# The app asks for a fresh check when it opens; the background job does the rest.
CHECK_PER_USER = Limit(6, 60)


def _http(exc: Exception) -> HTTPException:
    return HTTPException(status_code=getattr(exc, "status_code", 400), detail=str(exc))


@router.get("", response_model=NotificationList)
def list_notifications(
    user: CurrentUser,
    db: DbSession,
    status_filter: Annotated[Literal["all", "unread"], Query(alias="status")] = "all",
    type_filter: Annotated[NotificationType | None, Query(alias="type")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> Any:
    return notification_service.list_notifications(
        db, user.id, unread_only=status_filter == "unread", type_=type_filter.value if type_filter else None, limit=limit, offset=offset
    )


@router.get("/unread-count", response_model=UnreadCount)
def unread_count(user: CurrentUser, db: DbSession) -> Any:
    return {"unread_count": notification_service.unread_count(db, user.id)}


@router.post("/check", response_model=CheckResult)
def check_now(user: CurrentUser, db: DbSession) -> Any:
    """Run the checks for the signed-in user right away (also done by the background job)."""
    enforce("notifications-check", str(user.id), CHECK_PER_USER)
    created = notification_service.check_user(db, user.id)
    return {"created": created, "unread_count": notification_service.unread_count(db, user.id)}


@router.post("/read-all", response_model=CountOut)
def read_all(user: CurrentUser, db: DbSession) -> Any:
    return {"count": notification_service.mark_all_read(db, user.id)}


@router.post("/dismiss-read", response_model=CountOut)
def dismiss_read(user: CurrentUser, db: DbSession) -> Any:
    return {"count": notification_service.dismiss_read(db, user.id)}


@router.get("/preferences", response_model=PreferencesOut)
def get_preferences(user: CurrentUser, db: DbSession) -> Any:
    return notification_service.get_preferences(db, user.id)


@router.put("/preferences", response_model=PreferencesOut)
def update_preferences(payload: PreferencesIn, user: CurrentUser, db: DbSession) -> Any:
    return notification_service.update_preferences(db, user.id, payload.model_dump())


@router.patch("/{notification_id}", response_model=NotificationOut)
def set_read(notification_id: uuid.UUID, payload: ReadIn, user: CurrentUser, db: DbSession) -> Any:
    try:
        return notification_service.to_out(notification_service.set_read(db, user.id, notification_id, payload.read))
    except notification_service.NotificationError as exc:
        raise _http(exc) from None


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def dismiss(notification_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    try:
        notification_service.dismiss(db, user.id, notification_id)
    except notification_service.NotificationError as exc:
        raise _http(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
