"""Account settings: profile, profile picture, sessions, security activity, preferences,
data export, backup information and account deletion (Phase 12)."""

import json
import logging
import os
import secrets
import shutil
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import func, inspect, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app import __version__
from app.core.config import get_settings
from app.core.security import verify_password
from app.models import (
    Bill,
    BillPayment,
    Budget,
    CalendarEvent,
    Category,
    Document,
    Expense,
    Income,
    Note,
    Notification,
    NotificationPreferences,
    Reminder,
    SavingsContribution,
    SavingsGoal,
    SecurityActivity,
    SecurityEvent,
    Task,
    User,
    UserPreferences,
    UserSession,
    VaultEntry,
)
from app.services import auth as auth_service
from app.services.documents import used_bytes
from app.services.file_validation import FileValidationError, detect_kind

logger = logging.getLogger("lifevault.account")

AVATAR_KINDS = {"png", "jpeg", "webp"}
DELETE_CONFIRMATION = "DELETE"


class AccountError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


# --- Security activity ------------------------------------------------------------------------------------


def record(db: Session, user_id: uuid.UUID, event: SecurityEvent, *, ip: str | None = None, user_agent: str | None = None, detail: str | None = None, commit: bool = True) -> None:
    db.add(SecurityActivity(user_id=user_id, event=event, ip_address=ip, user_agent=(user_agent or "")[:255] or None, detail=detail))
    if commit:
        db.commit()


def list_activity(db: Session, user_id: uuid.UUID, limit: int = 50) -> list[SecurityActivity]:
    return list(
        db.scalars(select(SecurityActivity).where(SecurityActivity.user_id == user_id).order_by(SecurityActivity.created_at.desc()).limit(limit))
    )


# --- Profile --------------------------------------------------------------------------------------------------


def update_profile(db: Session, user: User, data: dict[str, Any]) -> list[SecurityEvent]:
    """Update name/username/email. Changing the username or email needs the current password."""
    changes_identity = data["username"] != user.username or data["email"] != user.email
    if changes_identity:
        password = data.get("current_password")
        if not password or not verify_password(user.password_hash, password):
            raise AccountError("Enter your current password to change your username or email.", 403)
    for field, label in (("username", "username"), ("email", "email")):
        if data[field] != getattr(user, field):
            taken = db.scalar(select(func.count()).select_from(User).where(getattr(User, field) == data[field], User.id != user.id))
            if taken:
                raise AccountError(f"That {label} is already in use.", 409)
    events = []
    if data["email"] != user.email:
        events.append(SecurityEvent.EMAIL_CHANGED)
    if data["username"] != user.username:
        events.append(SecurityEvent.USERNAME_CHANGED)
    if data["name"] != user.name:
        events.append(SecurityEvent.PROFILE_UPDATED)
    user.name, user.username, user.email = data["name"], data["username"], data["email"]
    return events


# --- Profile picture ------------------------------------------------------------------------------------------


def _avatar_dir(user_id: uuid.UUID) -> Path:
    return get_settings().document_storage_dir / "avatars" / str(user_id)


def avatar_path(user: User) -> Path | None:
    if not user.avatar_key:
        return None
    path = (_avatar_dir(user.id) / user.avatar_key).resolve()
    if get_settings().document_storage_dir.resolve() not in path.parents or not path.is_file():
        return None
    return path


def set_avatar(db: Session, user: User, data: bytes, filename: str) -> None:
    try:
        kind = detect_kind(data, filename)
    except FileValidationError as exc:
        raise AccountError(str(exc), 415) from None
    if kind.kind not in AVATAR_KINDS:
        raise AccountError("Use a PNG, JPEG or WebP image.", 415)
    directory = _avatar_dir(user.id)
    directory.mkdir(parents=True, exist_ok=True)
    key = secrets.token_hex(16)
    tmp = directory / f".{key}.tmp"
    tmp.write_bytes(data)
    os.replace(tmp, directory / key)
    old = avatar_path(user)
    user.avatar_key, user.avatar_content_type, user.avatar_updated_at = key, kind.content_type, datetime.now(UTC)
    db.commit()
    if old is not None:
        old.unlink(missing_ok=True)


def remove_avatar(db: Session, user: User) -> None:
    old = avatar_path(user)
    user.avatar_key = user.avatar_content_type = user.avatar_updated_at = None
    db.commit()
    if old is not None:
        old.unlink(missing_ok=True)


# --- Sessions -------------------------------------------------------------------------------------------------------


def active_sessions(db: Session, user_id: uuid.UUID) -> list[UserSession]:
    now = datetime.now(UTC)
    sessions = db.scalars(
        select(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None), UserSession.expires_at > now).order_by(UserSession.last_seen_at.desc())
    ).all()
    # Idle-expired sessions are already unusable; don't list them.
    return [s for s in sessions if (now - s.last_seen_at).total_seconds() < s.idle_timeout_seconds]


def revoke_session(db: Session, user_id: uuid.UUID, session_id: uuid.UUID, current_id: uuid.UUID) -> None:
    if session_id == current_id:
        raise AccountError("Use “Sign out” to end the session you're using now.", 409)
    session = db.scalar(select(UserSession).where(UserSession.id == session_id, UserSession.user_id == user_id, UserSession.revoked_at.is_(None)))
    if session is None:
        raise AccountError("Session not found.", 404)
    auth_service.revoke_session(db, session)


def revoke_other_sessions(db: Session, user_id: uuid.UUID, current_id: uuid.UUID) -> int:
    count = len([s for s in active_sessions(db, user_id) if s.id != current_id])
    auth_service.revoke_all_sessions(db, user_id=user_id, except_session_id=current_id)
    return count


# --- Preferences -------------------------------------------------------------------------------------------------------


def get_preferences(db: Session, user_id: uuid.UUID) -> UserPreferences:
    prefs = db.get(UserPreferences, user_id)
    if prefs is None:
        db.execute(pg_insert(UserPreferences).values(user_id=user_id, currency=get_settings().default_currency).on_conflict_do_nothing())
        db.commit()
        prefs = db.get(UserPreferences, user_id)
    return prefs


def update_preferences(db: Session, user_id: uuid.UUID, currency: str, date_format: str) -> UserPreferences:
    if currency not in get_settings().supported_currencies:
        raise AccountError(f"Currency must be one of: {', '.join(get_settings().supported_currencies)}.", 422)
    prefs = get_preferences(db, user_id)
    prefs.currency, prefs.date_format = currency, date_format
    db.commit()
    db.refresh(prefs)
    return prefs


# --- Export ----------------------------------------------------------------------------------------------------------------

# Never exported: password hash, session/reset token hashes, avatar storage keys, vault secrets.
USER_FIELDS = ("id", "name", "username", "email", "status", "created_at", "last_login_at", "password_changed_at")


def _json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _rows(db: Session, model, where, *, include: tuple[str, ...] | None = None, exclude: tuple[str, ...] = ("user_id",)) -> list[dict[str, Any]]:
    columns = [c.key for c in inspect(model).column_attrs if (include is None or c.key in include) and c.key not in exclude]
    return [{col: _json_value(getattr(row, col)) for col in columns} for row in db.scalars(select(model).where(where))]


def build_export(db: Session, user: User, scope: str) -> dict[str, Any]:
    uid = user.id
    data: dict[str, Any] = {
        "format": "lifevault-export",
        "version": 1,
        "app_version": __version__,
        "exported_at": datetime.now(UTC).isoformat(),
        "scope": scope,
        "currency": get_settings().default_currency,
        "about": "Money amounts are exact decimal strings. Password vault secrets and uploaded files are not included.",
    }
    if scope in ("all", "personal"):
        data["profile"] = {f: _json_value(getattr(user, f)) for f in USER_FIELDS}
        data["preferences"] = _rows(db, UserPreferences, UserPreferences.user_id == uid, exclude=("user_id",))
        data["notification_preferences"] = _rows(db, NotificationPreferences, NotificationPreferences.user_id == uid)
        data["tasks"] = _rows(db, Task, Task.user_id == uid)
        data["reminders"] = _rows(db, Reminder, Reminder.user_id == uid)
        data["calendar_events"] = _rows(db, CalendarEvent, CalendarEvent.user_id == uid)
        data["notes"] = _rows(db, Note, Note.user_id == uid)
        # File contents stay on the server; download them individually from Documents.
        data["documents"] = _rows(db, Document, Document.user_id == uid, exclude=("user_id", "storage_key"))
        # Only non-secret vault metadata: usernames, emails, passwords and notes are encrypted and never exported.
        data["vault_entries"] = _rows(db, VaultEntry, VaultEntry.user_id == uid, include=("id", "website", "url", "category", "is_favorite", "created_at", "updated_at"))
        data["notifications"] = _rows(db, Notification, Notification.user_id == uid, exclude=("user_id", "dedupe_key"))
        data["security_activity"] = _rows(db, SecurityActivity, SecurityActivity.user_id == uid)
    if scope in ("all", "financial"):
        data["categories"] = _rows(db, Category, Category.user_id == uid)
        data["incomes"] = _rows(db, Income, Income.user_id == uid)
        data["expenses"] = _rows(db, Expense, Expense.user_id == uid)
        data["budgets"] = _rows(db, Budget, Budget.user_id == uid)
        data["bills"] = _rows(db, Bill, Bill.user_id == uid)
        data["bill_payments"] = _rows(db, BillPayment, BillPayment.user_id == uid)
        data["savings_goals"] = _rows(db, SavingsGoal, SavingsGoal.user_id == uid)
        data["savings_contributions"] = _rows(db, SavingsContribution, SavingsContribution.user_id == uid)
    return data


def export_json(db: Session, user: User, scope: str) -> str:
    return json.dumps(build_export(db, user, scope), ensure_ascii=False, indent=2)


# --- Backup information -----------------------------------------------------------------------------------------------------

COUNTED = {
    "incomes": Income,
    "expenses": Expense,
    "budgets": Budget,
    "bills": Bill,
    "savings_goals": SavingsGoal,
    "tasks": Task,
    "reminders": Reminder,
    "calendar_events": CalendarEvent,
    "notes": Note,
    "documents": Document,
    "vault_entries": VaultEntry,
}


def backup_info(db: Session, user_id: uuid.UUID) -> dict[str, Any]:
    counts = {name: db.scalar(select(func.count()).select_from(model).where(model.user_id == user_id)) for name, model in COUNTED.items()}
    last_export = db.scalar(
        select(func.max(SecurityActivity.created_at)).where(SecurityActivity.user_id == user_id, SecurityActivity.event == SecurityEvent.DATA_EXPORTED)
    )
    try:
        revision = db.scalar(text("SELECT version_num FROM alembic_version"))
    except Exception:  # noqa: BLE001 - informational only
        db.rollback()
        revision = None
    return {
        "counts": counts,
        "document_bytes": used_bytes(db, user_id),
        "last_export_at": last_export,
        "app_version": __version__,
        "database_revision": revision,
    }


# --- Account deletion ----------------------------------------------------------------------------------------------------------


def delete_account(db: Session, user: User, password: str, confirmation: str) -> None:
    """Permanently delete the user, everything they own, and their stored files."""
    if confirmation != DELETE_CONFIRMATION:
        raise AccountError(f"Type {DELETE_CONFIRMATION} to confirm.", 422)
    if not verify_password(user.password_hash, password):
        raise AccountError("Your password is incorrect.", 403)
    user_id = user.id
    storage = get_settings().document_storage_dir
    # Ledger rows reference the user's custom categories; remove them first so the cascade is simple.
    for model in (BillPayment, Income, Expense, Budget):
        db.query(model).filter(model.user_id == user_id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
    # Files are removed only after the database delete succeeded.
    for directory in (storage / str(user_id), storage / "avatars" / str(user_id)):
        try:
            shutil.rmtree(directory, ignore_errors=False) if directory.exists() else None
        except OSError as exc:
            logger.error("Could not remove a deleted account's files: %s", type(exc).__name__)

