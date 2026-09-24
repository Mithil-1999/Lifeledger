"""Dashboard summary contract.

Every section reports `available`: whether its module exists yet. Unavailable sections
carry no numbers at all (null / empty lists), so the UI shows empty states instead of
invented statistics. Later phases fill these in from real database data.
"""

import uuid
from datetime import date, datetime, time

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
    # Metrics that exist but aren't set up (e.g. no budgets this month, no savings goals).
    not_configured: list[str] = []


class TaskItem(BaseModel):
    id: uuid.UUID
    title: str
    due_date: date | None
    priority: str | None
    due_time: time | None = None
    status: str | None = None


class TasksSummary(BaseModel):
    available: bool
    available_from_phase: int | None
    today: list[TaskItem]  # open tasks due today
    pending: list[TaskItem]  # "Not Started" tasks that aren't overdue
    overdue: list[TaskItem]  # open tasks past their due date/time
    # Full counts (the lists above are capped for the dashboard).
    counts: dict[str, int] = {}


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
    remind_at: datetime  # when it next fires (snooze-aware)
    is_due: bool = False


class RemindersSummary(BaseModel):
    available: bool
    available_from_phase: int | None
    upcoming: list[ReminderItem]  # due ones first, then soonest
    due_count: int = 0


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
