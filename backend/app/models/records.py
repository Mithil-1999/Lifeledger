"""Notes and documents (Phase 8)."""

import enum
import uuid
from datetime import date

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.finance import _in_list


class NoteCategory(enum.StrEnum):
    PERSONAL = "personal"
    WORK = "work"
    EDUCATION = "education"
    FINANCE = "finance"
    IDEAS = "ideas"
    IMPORTANT = "important"
    OTHER = "other"


class Note(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Plain-text note. Content is never rendered as HTML by the app."""

    __tablename__ = "notes"
    __table_args__ = (
        CheckConstraint(_in_list("category", NoteCategory), name="category_valid"),
        CheckConstraint("char_length(btrim(title)) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("char_length(content) <= 100000", name="content_length"),
        CheckConstraint("cardinality(tags) <= 20", name="tag_count"),
        # Archived notes are never pinned.
        CheckConstraint("NOT (is_archived AND is_pinned)", name="archived_not_pinned"),
        Index("ix_notes_tags", "tags", postgresql_using="gin"),
        Index("ix_notes_user_id_updated_at", "user_id", "updated_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    category: Mapped[str] = mapped_column(String(15), nullable=False, default=NoteCategory.PERSONAL, server_default="personal")
    # Normalised: lower-case, unique, sorted.
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(30)), nullable=False, default=list, server_default=text("'{}'"))
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))


class DocumentCategory(enum.StrEnum):
    IDENTITY = "identity"
    EDUCATION = "education"
    FINANCE = "finance"
    MEDICAL = "medical"
    PROPERTY = "property"
    INSURANCE = "insurance"
    WORK = "work"
    RECEIPTS = "receipts"
    PERSONAL = "personal"
    OTHER = "other"


class Document(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Metadata for an uploaded file. The bytes live in private storage under `storage_key`,
    outside any web root, and are only reachable through authenticated API routes."""

    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint(_in_list("category", DocumentCategory), name="category_valid"),
        CheckConstraint("char_length(btrim(title)) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("description IS NULL OR char_length(description) <= 2000", name="description_length"),
        CheckConstraint("size_bytes > 0", name="size_positive"),
        CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name="sha256_format"),
        Index("ix_documents_user_id_created_at", "user_id", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(15), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    document_date: Mapped[date | None] = mapped_column(Date)
    # Sanitised original name, used only for the download's suggested filename.
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # Detected from the file's bytes (never taken from the client).
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_kind: Mapped[str] = mapped_column(String(10), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # Random name of the stored file (no user-controlled parts).
    storage_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
