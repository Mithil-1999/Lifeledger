"""Schemas for notes and documents."""

import re
import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.models import DocumentCategory, NoteCategory

MAX_TAGS = 20


def _blank_to_none(value: str | None) -> str | None:
    return value or None


def _normalise_tags(tags: list[str]) -> list[str]:
    cleaned: set[str] = set()
    for tag in tags:
        tag = re.sub(r"\s+", "-", tag.strip().lstrip("#").lower())
        if not tag:
            continue
        if len(tag) > 30 or not re.fullmatch(r"[\w\-]+", tag):
            raise ValueError("Tags use letters, numbers, - and _ (max 30 characters).")
        cleaned.add(tag)
    if len(cleaned) > MAX_TAGS:
        raise ValueError(f"Use at most {MAX_TAGS} tags.")
    return sorted(cleaned)


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


# --- Notes ----------------------------------------------------------------------------------------------

NoteView = Literal["active", "archived", "all"]


class NoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    content: Annotated[str, Field(max_length=100_000)] = ""
    category: NoteCategory = NoteCategory.PERSONAL
    tags: Annotated[list[Annotated[str, Field(max_length=60)]], Field(max_length=50), AfterValidator(_normalise_tags)] = []
    is_pinned: bool = False
    is_archived: bool = False


class NoteFlags(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_pinned: bool | None = None
    is_archived: bool | None = None


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    content: str
    category: NoteCategory
    tags: list[str]
    is_pinned: bool
    is_archived: bool
    created_at: datetime
    updated_at: datetime


class NoteList(BaseModel):
    view: NoteView
    items: list[NoteOut]
    counts: dict[str, int]  # active, archived, pinned


class TagCount(BaseModel):
    tag: str
    count: int


# --- Documents ----------------------------------------------------------------------------------------------


class DocumentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    category: DocumentCategory
    description: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=2000), AfterValidator(_blank_to_none)] = None
    document_date: date | None = None


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: DocumentCategory
    description: str | None
    document_date: date | None
    original_filename: str
    content_type: str
    file_kind: str
    size_bytes: int
    sha256: str
    previewable: bool
    created_at: datetime
    updated_at: datetime


class DocumentList(BaseModel):
    items: list[DocumentOut]
    total_count: int
    used_bytes: int  # across ALL of the user's documents (not just the filtered ones)
    quota_bytes: int
    max_file_bytes: int
    allowed_extensions: list[str]
