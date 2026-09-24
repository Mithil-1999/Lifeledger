"""Dashboard summary contract.

Every section reports `available`: whether its module exists yet. Unavailable sections
carry no numbers at all (null / empty lists), so the UI shows empty states instead of
invented statistics. Later phases fill these in from real database data.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.schemas.common import DecimalStr, Money


class Period(BaseModel):
    label: str  # e.g. "September 2026"
    start: date  # first day of the current month (in APP_TIMEZONE)
    end: date  # last day of the current month
    today: date
    timezone: str


class FinancialSummary(BaseModel):
    available: bool
    available_from_phase: int | None
    monthly_income: Money | None
    monthly_expenses: Money | None
    current_balance: Money | None
    savings: Money | None
    budget_remaining: Money | None
    # Metrics that aren't computed yet -> phase that adds them (values above are null).
    pending: dict[str, int] = {}


class TaskItem(BaseModel):
    id: uuid.UUID
    title: str
    due_date: date | None
    priority: str | None


class TasksSummary(BaseModel):
    available: bool
    available_from_phase: int | None
    today: list[TaskItem]
    pending: list[TaskItem]
    overdue: list[TaskItem]


class BillItem(BaseModel):
    id: uuid.UUID
    name: str
    amount: Money
    due_date: date


class BillsSummary(BaseModel):
    available: bool
    available_from_phase: int | None
    upcoming: list[BillItem]
    overdue: list[BillItem]


class ReminderItem(BaseModel):
    id: uuid.UUID
    title: str
    remind_at: datetime


class RemindersSummary(BaseModel):
    available: bool
    available_from_phase: int | None
    upcoming: list[ReminderItem]


class MonthlyPoint(BaseModel):
    month: str  # "2026-09"
    income: DecimalStr | None = None
    expenses: DecimalStr | None = None
    savings: DecimalStr | None = None


class CategoryPoint(BaseModel):
    category: str
    amount: DecimalStr


class ChartsData(BaseModel):
    available: bool
    available_from_phase: int | None
    income_vs_expenses: list[MonthlyPoint]
    expense_categories: list[CategoryPoint]
    monthly_spending: list[MonthlyPoint]
    savings: list[MonthlyPoint]
    pending: dict[str, int] = {}


class DashboardSummary(BaseModel):
    currency: str
    period: Period
    generated_at: datetime
    finance: FinancialSummary
    tasks: TasksSummary
    bills: BillsSummary
    reminders: RemindersSummary
    charts: ChartsData
