"""Schemas for account settings."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models import DateFormat, SecurityEvent
from app.schemas.auth import Email, Name, Password, Username


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    username: Username
    email: Email
    # Required only when the username or email changes.
    current_password: Password | None = None


class SessionOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    user_agent: str | None
    ip_address: str | None
    current: bool


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event: SecurityEvent
    ip_address: str | None
    user_agent: str | None
    detail: str | None
    created_at: datetime


class PreferencesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    date_format: DateFormat


class PreferencesOut(BaseModel):
    currency: str
    date_format: DateFormat
    # Server-wide settings, shown for information.
    timezone: str
    supported_currencies: list[str]


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Literal["all", "personal", "financial"]
    password: Password


class DeleteAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: Password
    confirmation: str


class BackupInfo(BaseModel):
    counts: dict[str, int]
    document_bytes: int
    last_export_at: datetime | None
    app_version: str
    database_revision: str | None


class CountOut(BaseModel):
    count: int


class TwoFactorStatus(BaseModel):
    available: bool
    enabled: bool
    methods_planned: list[str]
