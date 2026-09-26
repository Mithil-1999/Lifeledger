"""Password vault (Phase 7). See app/core/vault_crypto.py for the key-management design."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, LargeBinary, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.finance import _in_list


class VaultKey(Base):
    """A user's data-encryption key, stored ONLY wrapped (encrypted) with the master key."""

    __tablename__ = "vault_keys"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    wrapped_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    kek_version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class VaultCategory(enum.StrEnum):
    EMAIL = "email"
    SOCIAL_MEDIA = "social_media"
    BANKING = "banking"
    EDUCATION = "education"
    WORK = "work"
    SHOPPING = "shopping"
    GOVERNMENT = "government"
    HOSTING = "hosting"
    OTHER = "other"


class VaultEntry(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Site name, URL and category are plaintext (for listing/filtering). Username, email,
    password and notes are AES-256-GCM ciphertexts; the server never stores them in the clear."""

    __tablename__ = "vault_entries"
    __table_args__ = (
        CheckConstraint(_in_list("category", VaultCategory), name="category_valid"),
        CheckConstraint("char_length(btrim(website)) BETWEEN 1 AND 200", name="website_length"),
        # Only http(s) links are stored, so a saved URL can never be a javascript: link.
        CheckConstraint("url IS NULL OR url ~* '^https?://'", name="url_scheme"),
        Index("ix_vault_entries_user_id_website", "user_id", "website"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    website: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(String(2048))
    category: Mapped[str] = mapped_column(String(20), nullable=False, default=VaultCategory.OTHER, server_default="other")
    is_favorite: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    username_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    email_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    password_enc: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    notes_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    password_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class VaultAction(enum.StrEnum):
    ENTRY_CREATED = "entry_created"
    ENTRY_UPDATED = "entry_updated"
    ENTRY_DELETED = "entry_deleted"
    SECRET_REVEALED = "secret_revealed"
    SECRET_COPIED = "secret_copied"
    VAULT_UNLOCKED = "vault_unlocked"
    UNLOCK_FAILED = "unlock_failed"
    VAULT_LOCKED = "vault_locked"


class VaultAuditLog(UUIDPrimaryKeyMixin, Base):
    """Append-only record of vault actions. Never contains secrets: only the action, which
    entry (id + site name at the time), when, and from where."""

    __tablename__ = "vault_audit_log"
    __table_args__ = (
        CheckConstraint(_in_list("action", VaultAction), name="action_valid"),
        Index("ix_vault_audit_log_user_id_created_at", "user_id", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Kept (not cascaded) when the entry is deleted, so deletions stay visible in the log.
    entry_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    entry_label: Mapped[str | None] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
