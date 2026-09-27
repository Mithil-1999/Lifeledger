"""Schemas for notifications and notification preferences."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import NotificationType


class NotificationOut(BaseModel):
    id: uuid.UUID
    type: NotificationType
    title: str
    message: str
    related_type: Literal["task", "bill", "budget", "savings_goal", "reminder"]
    related_id: uuid.UUID
    is_read: bool
    read_at: datetime | None
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    total: int
    unread_count: int


class UnreadCount(BaseModel):
    unread_count: int


class ReadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    read: bool


class CountOut(BaseModel):
    count: int


class CheckResult(BaseModel):
    created: int
    unread_count: int


class PreferencesBase(BaseModel):
    task_overdue: bool
    task_upcoming: bool
    bill_overdue: bool
    bill_upcoming: bool
    budget_threshold: bool
    savings_milestone: bool
    reminder_due: bool
    task_lead_days: int = Field(ge=0, le=14)
    bill_lead_days: int = Field(ge=0, le=30)
    browser_enabled: bool


class PreferencesIn(PreferencesBase):
    model_config = ConfigDict(extra="forbid")


class PreferencesOut(PreferencesBase):
    model_config = ConfigDict(from_attributes=True)

    updated_at: datetime
