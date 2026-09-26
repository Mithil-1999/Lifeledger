"""Private document storage.

- Files are stored under DOCUMENT_STORAGE_DIR/<user_id>/<random key>: no user-controlled
  path parts, no extension, outside any web root. They are only reachable through the
  authenticated API, which checks ownership on every request.
- Uploads are read in chunks with a hard size limit, identified by their bytes
  (see file_validation), checked against the user's quota, then written atomically.
"""

import hashlib
import logging
import os
import secrets
import uuid
from datetime import date
from pathlib import Path
from typing import Any, BinaryIO

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Document
from app.services.file_validation import ALLOWED_EXTENSIONS, KINDS, FileValidationError, detect_kind, safe_filename

logger = logging.getLogger("lifevault.documents")
CHUNK = 64 * 1024


class DocumentError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


# --- Storage -----------------------------------------------------------------------------------------------------


def _user_dir(user_id: uuid.UUID) -> Path:
    return get_settings().document_storage_dir / str(user_id)


def file_path(doc: Document) -> Path:
    path = (_user_dir(doc.user_id) / doc.storage_key).resolve()
    root = get_settings().document_storage_dir.resolve()
    if root not in path.parents:  # defence in depth; storage_key is always server-generated
        raise DocumentError("Invalid document path.", 500)
    return path


def read_limited(stream: BinaryIO, limit: int) -> bytes:
    """Read the upload in chunks, refusing to buffer more than `limit` bytes."""
    chunks, total = [], 0
    while chunk := stream.read(CHUNK):
        total += len(chunk)
        if total > limit:
            raise DocumentError(f"File is too large. The limit is {limit / (1024 * 1024):g} MB.", 413)
        chunks.append(chunk)
    return b"".join(chunks)


def _write_atomically(directory: Path, key: str, data: bytes) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    tmp = directory / f".{key}.tmp"
    with open(tmp, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.chmod(tmp, 0o600)  # owner-only (no-op for most bits on Windows)
    except OSError:
        pass
    os.replace(tmp, directory / key)


def _remove_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        logger.error("Could not delete stored document file: %s", type(exc).__name__)


# --- Queries -------------------------------------------------------------------------------------------------------


def used_bytes(db: Session, user_id: uuid.UUID) -> int:
    return int(db.scalar(select(func.coalesce(func.sum(Document.size_bytes), 0)).where(Document.user_id == user_id)))


def to_out(doc: Document) -> dict[str, Any]:
    return {
        "id": doc.id,
        "title": doc.title,
        "category": doc.category,
        "description": doc.description,
        "document_date": doc.document_date,
        "original_filename": doc.original_filename,
        "content_type": doc.content_type,
        "file_kind": doc.file_kind,
        "size_bytes": doc.size_bytes,
        "sha256": doc.sha256,
        "previewable": KINDS[doc.file_kind].inline,
        "created_at": doc.created_at,
        "updated_at": doc.updated_at,
    }


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


SORTS = {
    "newest": (Document.created_at.desc(),),
    "oldest": (Document.created_at.asc(),),
    "title": (func.lower(Document.title).asc(),),
    "document_date": (Document.document_date.desc().nulls_last(), Document.created_at.desc()),
    "largest": (Document.size_bytes.desc(),),
}


def list_documents(
    db: Session,
    user_id: uuid.UUID,
    *,
    search: str | None = None,
    category: str | None = None,
    file_kind: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    sort: str = "newest",
) -> dict[str, Any]:
    settings = get_settings()
    stmt = select(Document).where(Document.user_id == user_id)
    if category:
        stmt = stmt.where(Document.category == category)
    if file_kind:
        stmt = stmt.where(Document.file_kind == file_kind)
    if date_from:
        stmt = stmt.where(Document.document_date >= date_from)
    if date_to:
        stmt = stmt.where(Document.document_date <= date_to)
    if search:
        pattern = f"%{_escape_like(search.strip())}%"
        stmt = stmt.where(
            or_(
                Document.title.ilike(pattern, escape="\\"),
                Document.description.ilike(pattern, escape="\\"),
                Document.original_filename.ilike(pattern, escape="\\"),
            )
        )
    docs = list(db.scalars(stmt.order_by(*SORTS[sort])))
    return {
        "items": [to_out(d) for d in docs],
        "total_count": len(docs),
        "used_bytes": used_bytes(db, user_id),
        "quota_bytes": settings.document_quota_bytes,
        "max_file_bytes": settings.document_max_bytes,
        "allowed_extensions": ALLOWED_EXTENSIONS,
    }


def get_document(db: Session, user_id: uuid.UUID, document_id: uuid.UUID) -> Document:
    # Same 404 whether it doesn't exist or belongs to someone else.
    doc = db.scalar(select(Document).where(Document.id == document_id, Document.user_id == user_id))
    if doc is None:
        raise DocumentError("Document not found.", 404)
    return doc


# --- Writes ----------------------------------------------------------------------------------------------------------


def upload_document(
    db: Session,
    user_id: uuid.UUID,
    *,
    stream: BinaryIO,
    filename: str | None,
    title: str | None,
    category: str,
    description: str | None,
    document_date: date | None,
) -> Document:
    settings = get_settings()
    name = safe_filename(filename)
    data = read_limited(stream, settings.document_max_bytes)
    try:
        kind = detect_kind(data, name)
    except FileValidationError as exc:
        raise DocumentError(str(exc), 422) from None

    if used_bytes(db, user_id) + len(data) > settings.document_quota_bytes:
        raise DocumentError("Not enough storage space left. Delete some documents first.", 413)

    key = secrets.token_hex(24)
    doc = Document(
        user_id=user_id,
        title=(title or name.rsplit(".", 1)[0])[:200],
        category=category,
        description=description,
        document_date=document_date,
        original_filename=name,
        content_type=kind.content_type,
        file_kind=kind.kind,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        storage_key=key,
    )
    directory = _user_dir(user_id)
    _write_atomically(directory, key, data)
    db.add(doc)
    try:
        db.commit()
    except Exception:
        db.rollback()
        _remove_file(directory / key)  # don't leave orphaned files behind
        raise
    db.refresh(doc)
    return doc


def update_document(db: Session, user_id: uuid.UUID, document_id: uuid.UUID, data: dict[str, Any]) -> Document:
    doc = get_document(db, user_id, document_id)
    for field in ("title", "category", "description", "document_date"):
        setattr(doc, field, data[field])
    db.commit()
    db.refresh(doc)
    return doc


def delete_document(db: Session, user_id: uuid.UUID, document_id: uuid.UUID) -> None:
    doc = get_document(db, user_id, document_id)
    path = file_path(doc)
    db.delete(doc)
    db.commit()
    _remove_file(path)  # after the commit, so a failed delete never loses the record
