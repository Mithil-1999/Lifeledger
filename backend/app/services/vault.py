"""Password vault business logic.

- Every function is scoped to one user; other users' entries are simply "not found".
- Secrets are decrypted only when needed: lists decrypt usernames/emails for display but
  never passwords; the password is decrypted only by `reveal_password`, one entry at a
  time, and every reveal is written to the audit log (without the secret).
- Nothing here logs plaintext, keys or ciphertext.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import verify_password
from app.core.vault_crypto import decrypt_field, encrypt_field, new_wrapped_data_key, unwrap_data_key
from app.models import User, UserSession, VaultAction, VaultAuditLog, VaultCategory, VaultEntry, VaultKey


class VaultError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def utcnow() -> datetime:
    return datetime.now(UTC)


# --- Audit -------------------------------------------------------------------------------------------------


def audit(db: Session, user_id: uuid.UUID, action: VaultAction, *, entry: VaultEntry | None = None, ip: str | None = None, user_agent: str | None = None) -> None:
    db.add(
        VaultAuditLog(
            user_id=user_id,
            action=action.value,
            entry_id=entry.id if entry else None,
            entry_label=entry.website if entry else None,  # the site name, never a secret
            ip_address=ip,
            user_agent=(user_agent or "")[:255] or None,
        )
    )


def audit_log(db: Session, user_id: uuid.UUID, limit: int) -> list[VaultAuditLog]:
    return list(
        db.scalars(select(VaultAuditLog).where(VaultAuditLog.user_id == user_id).order_by(VaultAuditLog.created_at.desc()).limit(limit))
    )


# --- Unlock (step-up authentication) ---------------------------------------------------------------------------------


def is_unlocked(session: UserSession) -> bool:
    return session.vault_unlocked_until is not None and session.vault_unlocked_until > utcnow()


def require_unlocked(session: UserSession) -> None:
    if not is_unlocked(session):
        raise VaultError("The vault is locked. Re-enter your password to unlock it.", 423)


def unlock(db: Session, user: User, session: UserSession, password: str, *, ip: str | None, user_agent: str | None) -> datetime:
    if not verify_password(user.password_hash, password):
        audit(db, user.id, VaultAction.UNLOCK_FAILED, ip=ip, user_agent=user_agent)
        db.commit()
        raise VaultError("Incorrect password.", 401)
    session.vault_unlocked_until = utcnow() + timedelta(minutes=get_settings().vault_unlock_minutes)
    audit(db, user.id, VaultAction.VAULT_UNLOCKED, ip=ip, user_agent=user_agent)
    db.commit()
    return session.vault_unlocked_until


def lock(db: Session, user: User, session: UserSession, *, ip: str | None, user_agent: str | None) -> None:
    if session.vault_unlocked_until is not None:
        session.vault_unlocked_until = None
        audit(db, user.id, VaultAction.VAULT_LOCKED, ip=ip, user_agent=user_agent)
        db.commit()


# --- Keys ----------------------------------------------------------------------------------------------------------


def _data_key(db: Session, user_id: uuid.UUID) -> bytes:
    """The user's DEK (unwrapped in memory for this request only), created on first use."""
    row = db.get(VaultKey, user_id)
    if row is None:
        wrapped, version = new_wrapped_data_key(user_id)
        row = VaultKey(user_id=user_id, wrapped_key=wrapped, kek_version=version)
        db.add(row)
        db.flush()
    return unwrap_data_key(user_id, row.wrapped_key, row.kek_version)


def _dec(dek: bytes, entry: VaultEntry, field: str) -> str | None:
    blob = getattr(entry, f"{field}_enc")
    return None if blob is None else decrypt_field(dek, entry.user_id, entry.id, field, blob)


def _enc(dek: bytes, entry: VaultEntry, field: str, value: str | None) -> bytes | None:
    return None if value is None else encrypt_field(dek, entry.user_id, entry.id, field, value)


# --- Reading -------------------------------------------------------------------------------------------------------------


def to_out(entry: VaultEntry, dek: bytes, *, include_notes: bool = False) -> dict[str, Any]:
    out = {
        "id": entry.id,
        "website": entry.website,
        "url": entry.url,
        "category": entry.category,
        "username": _dec(dek, entry, "username"),
        "email": _dec(dek, entry, "email"),
        "is_favorite": entry.is_favorite,
        "has_notes": entry.notes_enc is not None,
        "password_changed_at": entry.password_changed_at,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
    }
    if include_notes:
        out["notes"] = _dec(dek, entry, "notes")
    return out


def list_entries(db: Session, user_id: uuid.UUID, *, search: str | None, category: str | None, favorites: bool) -> dict[str, Any]:
    entries = list(db.scalars(select(VaultEntry).where(VaultEntry.user_id == user_id)))
    dek = _data_key(db, user_id) if entries else b""
    items = [to_out(e, dek) for e in entries]  # usernames/emails only; passwords stay encrypted

    counts: dict[str, int] = {"all": len(items), "favorites": sum(1 for i in items if i["is_favorite"])}
    for cat in VaultCategory:
        counts[cat.value] = sum(1 for i in items if i["category"] == cat.value)

    if category:
        items = [i for i in items if i["category"] == category]
    if favorites:
        items = [i for i in items if i["is_favorite"]]
    if search:
        # Usernames/emails are encrypted at rest, so matching happens after decryption.
        term = search.strip().lower()
        items = [i for i in items if any(term in (i[f] or "").lower() for f in ("website", "url", "username", "email"))]
    items.sort(key=lambda i: (not i["is_favorite"], i["website"].lower()))
    return {"items": items, "counts": counts}


def get_entry(db: Session, user_id: uuid.UUID, entry_id: uuid.UUID) -> VaultEntry:
    entry = db.scalar(select(VaultEntry).where(VaultEntry.id == entry_id, VaultEntry.user_id == user_id))
    if entry is None:
        raise VaultError("Vault entry not found.", 404)
    return entry


def entry_detail(db: Session, user_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]:
    entry = get_entry(db, user_id, entry_id)
    return to_out(entry, _data_key(db, user_id), include_notes=True)


def reveal_password(db: Session, user_id: uuid.UUID, entry_id: uuid.UUID, purpose: str, *, ip: str | None, user_agent: str | None) -> str:
    entry = get_entry(db, user_id, entry_id)
    password = _dec(_data_key(db, user_id), entry, "password")
    audit(db, user_id, VaultAction.SECRET_COPIED if purpose == "copy" else VaultAction.SECRET_REVEALED, entry=entry, ip=ip, user_agent=user_agent)
    db.commit()
    return password  # type: ignore[return-value]


# --- Writing ------------------------------------------------------------------------------------------------------------------


def create_entry(db: Session, user_id: uuid.UUID, data: dict[str, Any], *, ip: str | None, user_agent: str | None) -> dict[str, Any]:
    if data["password"] is None:
        raise VaultError("Enter a password to save.", 422)
    dek = _data_key(db, user_id)
    entry = VaultEntry(id=uuid.uuid4(), user_id=user_id)  # id needed up front: it's bound into the ciphertexts
    _apply(entry, dek, data)
    db.add(entry)
    audit(db, user_id, VaultAction.ENTRY_CREATED, entry=entry, ip=ip, user_agent=user_agent)
    db.commit()
    db.refresh(entry)
    return to_out(entry, dek, include_notes=True)


def update_entry(db: Session, user_id: uuid.UUID, entry_id: uuid.UUID, data: dict[str, Any], *, ip: str | None, user_agent: str | None) -> dict[str, Any]:
    entry = get_entry(db, user_id, entry_id)
    dek = _data_key(db, user_id)
    _apply(entry, dek, data)
    audit(db, user_id, VaultAction.ENTRY_UPDATED, entry=entry, ip=ip, user_agent=user_agent)
    db.commit()
    db.refresh(entry)
    return to_out(entry, dek, include_notes=True)


def set_favorite(db: Session, user_id: uuid.UUID, entry_id: uuid.UUID, is_favorite: bool) -> dict[str, Any]:
    entry = get_entry(db, user_id, entry_id)
    entry.is_favorite = is_favorite
    db.commit()
    db.refresh(entry)
    return to_out(entry, _data_key(db, user_id))


def delete_entry(db: Session, user_id: uuid.UUID, entry_id: uuid.UUID, *, ip: str | None, user_agent: str | None) -> None:
    entry = get_entry(db, user_id, entry_id)
    audit(db, user_id, VaultAction.ENTRY_DELETED, entry=entry, ip=ip, user_agent=user_agent)
    db.delete(entry)
    db.commit()


def _apply(entry: VaultEntry, dek: bytes, data: dict[str, Any]) -> None:
    entry.website = data["website"]
    entry.url = data["url"]
    entry.category = data["category"]
    entry.is_favorite = data["is_favorite"]
    entry.username_enc = _enc(dek, entry, "username", data["username"])
    entry.email_enc = _enc(dek, entry, "email", data["email"])
    entry.notes_enc = _enc(dek, entry, "notes", data["notes"])
    if data["password"] is not None:  # None on update = keep the current password
        entry.password_enc = _enc(dek, entry, "password", data["password"])
        entry.password_changed_at = utcnow()
