"""Personal notes: CRUD, search, tags, categories, pinning and archiving (per user)."""

import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Note


class NoteError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_notes(
    db: Session, user_id: uuid.UUID, view: str, *, search: str | None = None, category: str | None = None, tag: str | None = None
) -> dict[str, Any]:
    base = select(Note).where(Note.user_id == user_id)
    if category:
        base = base.where(Note.category == category)
    if tag:
        base = base.where(Note.tags.any(tag.strip().lstrip("#").lower()))
    if search:
        pattern = f"%{_escape_like(search.strip())}%"
        base = base.where(
            or_(
                Note.title.ilike(pattern, escape="\\"),
                Note.content.ilike(pattern, escape="\\"),
                func.array_to_string(Note.tags, " ").ilike(pattern, escape="\\"),
            )
        )
    notes = list(db.scalars(base))
    counts = {
        "active": sum(1 for n in notes if not n.is_archived),
        "archived": sum(1 for n in notes if n.is_archived),
        "pinned": sum(1 for n in notes if n.is_pinned),
    }
    if view == "active":
        notes = [n for n in notes if not n.is_archived]
    elif view == "archived":
        notes = [n for n in notes if n.is_archived]
    # Pinned first, then most recently edited.
    notes.sort(key=lambda n: (not n.is_pinned, -n.updated_at.timestamp()))
    return {"view": view, "items": notes, "counts": counts}


def tag_counts(db: Session, user_id: uuid.UUID) -> list[dict[str, Any]]:
    tag = func.unnest(Note.tags).label("tag")
    sub = select(tag).where(Note.user_id == user_id, Note.is_archived.is_(False)).subquery()
    rows = db.execute(select(sub.c.tag, func.count()).group_by(sub.c.tag).order_by(func.count().desc(), sub.c.tag)).all()
    return [{"tag": row[0], "count": int(row[1])} for row in rows]


def get_note(db: Session, user_id: uuid.UUID, note_id: uuid.UUID) -> Note:
    note = db.scalar(select(Note).where(Note.id == note_id, Note.user_id == user_id))
    if note is None:
        raise NoteError("Note not found.", 404)
    return note


def _apply_flags(note: Note, is_pinned: bool | None, is_archived: bool | None) -> None:
    if is_archived is not None:
        note.is_archived = is_archived
        if is_archived:
            note.is_pinned = False  # archiving unpins
    if is_pinned is not None:
        if is_pinned and note.is_archived:
            raise NoteError("Archived notes can't be pinned. Unarchive it first.", 409)
        note.is_pinned = is_pinned


def create_note(db: Session, user_id: uuid.UUID, data: dict[str, Any]) -> Note:
    note = Note(user_id=user_id, title=data["title"], content=data["content"], category=data["category"], tags=data["tags"])
    _apply_flags(note, data["is_pinned"] and not data["is_archived"], data["is_archived"])
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def update_note(db: Session, user_id: uuid.UUID, note_id: uuid.UUID, data: dict[str, Any]) -> Note:
    note = get_note(db, user_id, note_id)
    note.title, note.content, note.category, note.tags = data["title"], data["content"], data["category"], data["tags"]
    note.is_pinned = False
    _apply_flags(note, data["is_pinned"] and not data["is_archived"], data["is_archived"])
    db.commit()
    db.refresh(note)
    return note


def set_flags(db: Session, user_id: uuid.UUID, note_id: uuid.UUID, is_pinned: bool | None, is_archived: bool | None) -> Note:
    note = get_note(db, user_id, note_id)
    _apply_flags(note, is_pinned, is_archived)
    db.commit()
    db.refresh(note)
    return note


def delete_note(db: Session, user_id: uuid.UUID, note_id: uuid.UUID) -> None:
    db.delete(get_note(db, user_id, note_id))
    db.commit()
