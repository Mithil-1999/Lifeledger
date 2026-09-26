"""Schemas for the password vault.

Passwords arrive as SecretStr (masked in reprs, logs and tracebacks). No response model
here has a password field except RevealOut, which only the audited reveal endpoint uses.
"""

import re
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, SecretStr, StringConstraints, field_validator

from app.models import VaultAction, VaultCategory


def _blank_to_none(value: str | None) -> str | None:
    return value or None


Text = lambda n: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=n), AfterValidator(_blank_to_none)]  # noqa: E731
VaultPassword = Annotated[SecretStr, Field(min_length=1, max_length=1024)]


class VaultEntryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    website: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    url: Text(2048) = None
    username: Text(320) = None
    email: Text(320) = None
    # Required when creating. When updating, omit/null to keep the current password.
    password: VaultPassword | None = None
    category: VaultCategory = VaultCategory.OTHER
    notes: Annotated[str | None, Field(max_length=5000), AfterValidator(_blank_to_none)] = None
    is_favorite: bool = False

    @field_validator("url")
    @classmethod
    def _http_only(cls, value: str | None) -> str | None:
        if value is None:
            return None
        # An explicit scheme must be http(s): rejects javascript:, data:, file:, vbscript: ...
        # ("host:port" like example.com:8080 isn't treated as a scheme).
        scheme = re.match(r"^([a-z][a-z0-9+.\-]*):(?!\d)", value, re.IGNORECASE)
        if scheme and scheme.group(1).lower() not in ("http", "https"):
            raise ValueError("URL must be an http(s) address.")
        if not scheme:
            value = "https://" + value  # bare host like "example.com"
        if not value.lower().startswith(("http://", "https://")) or any(c.isspace() for c in value):
            raise ValueError("URL must be an http(s) address.")
        return value


class FavoriteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_favorite: bool


class UnlockIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: Annotated[SecretStr, Field(min_length=1, max_length=128)]


class RevealIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    purpose: Literal["reveal", "copy"] = "reveal"


class VaultEntryOut(BaseModel):
    """What lists and details return. There is intentionally NO password field."""

    id: uuid.UUID
    website: str
    url: str | None
    category: VaultCategory
    username: str | None
    email: str | None
    is_favorite: bool
    has_notes: bool
    password_changed_at: datetime
    created_at: datetime
    updated_at: datetime


class VaultEntryDetail(VaultEntryOut):
    notes: str | None


class VaultEntryList(BaseModel):
    items: list[VaultEntryOut]
    counts: dict[str, int]  # all, favorites, and per category


class RevealOut(BaseModel):
    password: str


class VaultStatus(BaseModel):
    configured: bool
    unlocked: bool
    unlocked_until: datetime | None
    unlock_minutes: int


class AuditEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    action: VaultAction
    entry_id: uuid.UUID | None
    entry_label: str | None
    ip_address: str | None
    created_at: datetime
