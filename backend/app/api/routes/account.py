"""Account settings. All routes require a signed-in user and only touch that user's data."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse

from app.api.deps import CurrentSession, CurrentUser, DbSession
from app.core import rate_limit
from app.core.config import get_settings
from app.core.security import verify_password
from app.core.upload_limit import AVATAR_MAX_BYTES
from app.models import SecurityEvent
from app.schemas.account import (
    ActivityOut,
    BackupInfo,
    CountOut,
    DeleteAccountRequest,
    ExportRequest,
    PreferencesIn,
    PreferencesOut,
    ProfileUpdate,
    SessionOut,
    TwoFactorStatus,
)
from app.schemas.auth import UserPublic
from app.services import account as account_service
from app.services.documents import DocumentError, read_limited

router = APIRouter(prefix="/account", tags=["account"])

EXPORT_PER_USER = rate_limit.Limit(5, 60 * 60)
SENSITIVE_PER_USER = rate_limit.Limit(10, 15 * 60)


def _http(exc: Exception) -> HTTPException:
    return HTTPException(status_code=getattr(exc, "status_code", 400), detail=str(exc))


def _record(db, request: Request, user_id, event: SecurityEvent, detail: str | None = None) -> None:
    account_service.record(db, user_id, event, ip=rate_limit.client_ip(request), user_agent=request.headers.get("user-agent"), detail=detail)


# --- Profile -------------------------------------------------------------------------------------------------


@router.put("/profile", response_model=UserPublic)
def update_profile(payload: ProfileUpdate, request: Request, user: CurrentUser, db: DbSession) -> Any:
    rate_limit.enforce("account-sensitive", str(user.id), SENSITIVE_PER_USER)
    data = payload.model_dump()
    data["current_password"] = payload.current_password.get_secret_value() if payload.current_password else None
    try:
        events = account_service.update_profile(db, user, data)
    except account_service.AccountError as exc:
        db.rollback()
        raise _http(exc) from None
    db.commit()
    for event in events:
        _record(db, request, user.id, event)
    db.refresh(user)
    return UserPublic.model_validate(user)


@router.post("/avatar", response_model=UserPublic)
def upload_avatar(user: CurrentUser, db: DbSession, file: Annotated[UploadFile, File()]) -> Any:
    try:
        data = read_limited(file.file, AVATAR_MAX_BYTES)
        account_service.set_avatar(db, user, data, file.filename or "")
    except (account_service.AccountError, DocumentError) as exc:
        raise _http(exc) from None
    db.refresh(user)
    return UserPublic.model_validate(user)


@router.get("/avatar", response_class=FileResponse)
def get_avatar(user: CurrentUser) -> FileResponse:
    path = account_service.avatar_path(user)
    if path is None:
        raise HTTPException(status_code=404, detail="No profile picture.")
    return FileResponse(
        path,
        media_type=user.avatar_content_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            # Only ever an image: never run anything from it.
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Content-Disposition": "inline",
        },
    )


@router.delete("/avatar", response_model=UserPublic)
def delete_avatar(user: CurrentUser, db: DbSession) -> Any:
    account_service.remove_avatar(db, user)
    db.refresh(user)
    return UserPublic.model_validate(user)


# --- Sessions and security activity ---------------------------------------------------------------------------


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(user: CurrentUser, session: CurrentSession, db: DbSession) -> Any:
    return [
        {
            "id": s.id,
            "created_at": s.created_at,
            "last_seen_at": s.last_seen_at,
            "expires_at": s.expires_at,
            "user_agent": s.user_agent,
            "ip_address": s.ip_address,
            "current": s.id == session.id,
        }
        for s in account_service.active_sessions(db, user.id)
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(session_id: uuid.UUID, request: Request, user: CurrentUser, session: CurrentSession, db: DbSession) -> Response:
    try:
        account_service.revoke_session(db, user.id, session_id, session.id)
    except account_service.AccountError as exc:
        raise _http(exc) from None
    _record(db, request, user.id, SecurityEvent.SESSION_REVOKED)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sessions/revoke-others", response_model=CountOut)
def revoke_other_sessions(request: Request, user: CurrentUser, session: CurrentSession, db: DbSession) -> Any:
    count = account_service.revoke_other_sessions(db, user.id, session.id)
    _record(db, request, user.id, SecurityEvent.OTHER_SESSIONS_REVOKED, detail=f"{count} session(s)")
    return {"count": count}


@router.get("/security-activity", response_model=list[ActivityOut])
def security_activity(user: CurrentUser, db: DbSession, limit: Annotated[int, Query(ge=1, le=200)] = 50) -> Any:
    return account_service.list_activity(db, user.id, limit)


@router.get("/two-factor", response_model=TwoFactorStatus)
def two_factor_status(user: CurrentUser) -> Any:
    """2FA is designed (see SECURITY.md) but not implemented yet; this reports that honestly."""
    return {"available": False, "enabled": False, "methods_planned": ["totp", "recovery_codes"]}


# --- Preferences -----------------------------------------------------------------------------------------------


def _prefs_out(prefs) -> dict:
    settings = get_settings()
    return {"currency": prefs.currency, "date_format": prefs.date_format, "timezone": settings.app_timezone, "supported_currencies": settings.supported_currencies}


@router.get("/preferences", response_model=PreferencesOut)
def get_preferences(user: CurrentUser, db: DbSession) -> Any:
    return _prefs_out(account_service.get_preferences(db, user.id))


@router.put("/preferences", response_model=PreferencesOut)
def update_preferences(payload: PreferencesIn, user: CurrentUser, db: DbSession) -> Any:
    try:
        return _prefs_out(account_service.update_preferences(db, user.id, payload.currency, payload.date_format.value))
    except account_service.AccountError as exc:
        raise _http(exc) from None


# --- Data management ---------------------------------------------------------------------------------------------


@router.post("/export", response_class=Response)
def export_data(payload: ExportRequest, request: Request, user: CurrentUser, db: DbSession) -> Response:
    """Download your data as JSON. Asks for your password because the file contains personal information."""
    rate_limit.enforce("account-export", str(user.id), EXPORT_PER_USER)
    if not verify_password(user.password_hash, payload.password.get_secret_value()):
        raise HTTPException(status_code=403, detail="Your password is incorrect.")
    content = account_service.export_json(db, user, payload.scope)
    _record(db, request, user.id, SecurityEvent.DATA_EXPORTED, detail=f"json, {payload.scope}")
    filename = f"lifevault-{payload.scope}-export-{datetime.now(UTC):%Y%m%d-%H%M}.json"
    return Response(
        content=content.encode("utf-8"),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


@router.get("/backup-info", response_model=BackupInfo)
def backup_info(user: CurrentUser, db: DbSession) -> Any:
    return account_service.backup_info(db, user.id)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(payload: DeleteAccountRequest, user: CurrentUser, db: DbSession) -> Response:
    rate_limit.enforce("account-sensitive", str(user.id), SENSITIVE_PER_USER)
    try:
        account_service.delete_account(db, user, payload.password.get_secret_value(), payload.confirmation)
    except account_service.AccountError as exc:
        raise _http(exc) from None
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    settings = get_settings()
    response.delete_cookie(settings.session_cookie_name, path="/", httponly=True, secure=settings.cookie_secure, samesite="lax")
    return response
