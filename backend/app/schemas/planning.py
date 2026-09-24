"""Schemas for budgets, bills and savings goals."""

import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models import BillCategory, BillFrequency
from app.schemas.common import DecimalStr, PercentStr
from app.schemas.finance import MAX_AMOUNT, Amount, CategoryOut, Notes


def _blank_to_none(value: str | None) -> str | None:
    return value or None


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
LongText = Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=2000), AfterValidator(_blank_to_none)]


def _check_year_month(value: str) -> str:
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value) or not 2000 <= int(value[:4]) <= 2100:
        raise ValueError("Month must look like 2026-09 (years 2000-2100).")
    return value


YearMonth = Annotated[str, AfterValidator(_check_year_month)]


# --- Budgets ---------------------------------------------------------------------------------


class BudgetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: uuid.UUID
    month: YearMonth
    amount: Amount
    warning_threshold: int = Field(default=80, ge=1, le=100)


class BudgetUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Amount
    warning_threshold: int = Field(default=80, ge=1, le=100)


class BudgetCopyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_month: YearMonth
    to_month: YearMonth


BudgetStatus = Literal["ok", "warning", "over"]


class BudgetOut(BaseModel):
    id: uuid.UUID
    category: CategoryOut
    month: str
    amount: DecimalStr
    warning_threshold: int
    spent: DecimalStr
    remaining: DecimalStr  # negative when over budget
    percent_used: PercentStr
    status: BudgetStatus


class BudgetMonth(BaseModel):
    month: str
    currency: str
    total_budget: DecimalStr
    total_spent: DecimalStr  # spending in budgeted categories only
    total_remaining: DecimalStr
    percent_used: PercentStr
    unbudgeted_spent: DecimalStr  # spending in categories without a budget this month
    budgets: list[BudgetOut]


class BudgetCopyResult(BaseModel):
    copied: int
    skipped: int


# --- Bills -----------------------------------------------------------------------------------------


EffectiveBillStatus = Literal["pending", "paid", "overdue"]


class BillIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    amount: Amount
    category: BillCategory
    due_date: date
    frequency: BillFrequency
    notes: Notes = None
    # Only meaningful for one-time bills; recurring bills are paid via /pay each cycle.
    status: Literal["pending", "paid"] = "pending"

    @field_validator("due_date")
    @classmethod
    def _reasonable(cls, value: date) -> date:
        if not date(2000, 1, 1) <= value <= date(2100, 12, 31):
            raise ValueError("Due date must be between 2000 and 2100.")
        return value


class BillPayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    paid_on: date
    amount: Amount | None = Field(default=None, description="Defaults to the bill amount")
    record_expense: bool = False
    payment_method: Literal["cash", "bank_transfer", "card", "mobile_wallet", "cheque", "other"] = "cash"


class BillPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    amount: DecimalStr
    paid_on: date
    due_date: date
    expense_id: uuid.UUID | None


class BillOut(BaseModel):
    id: uuid.UUID
    name: str
    amount: DecimalStr
    currency: str
    category: BillCategory
    due_date: date
    frequency: BillFrequency
    status: EffectiveBillStatus
    days_until_due: int  # negative when overdue
    notes: str | None
    last_paid_on: date | None
    created_at: datetime
    updated_at: datetime


class BillsOverview(BaseModel):
    currency: str
    items: list[BillOut]
    overdue_count: int
    overdue_total: DecimalStr
    due_soon_count: int  # pending, due within the next 30 days
    due_soon_total: DecimalStr
    paid_this_month_total: DecimalStr


# --- Savings ---------------------------------------------------------------------------------------


class SavingsGoalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    target_amount: Amount
    current_amount: Annotated[Decimal, Field(ge=0, le=MAX_AMOUNT, max_digits=14, decimal_places=2)] = Decimal("0")
    target_date: date | None = None
    description: LongText = None


class ContributionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["deposit", "withdrawal"]
    amount: Amount
    date: date
    note: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=255), AfterValidator(_blank_to_none)] = None


class ContributionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    amount: DecimalStr  # negative for withdrawals
    date: date
    note: str | None
    created_at: datetime


class SavingsGoalOut(BaseModel):
    id: uuid.UUID
    name: str
    target_amount: DecimalStr
    current_amount: DecimalStr
    currency: str
    target_date: date | None
    description: str | None
    progress_percent: PercentStr  # can exceed 100 when over-saved
    remaining_amount: DecimalStr  # never negative
    completed: bool
    # Needed per month to reach the target by target_date (null if no date, reached, or past).
    monthly_needed: DecimalStr | None
    created_at: datetime
    updated_at: datetime


class SavingsOverview(BaseModel):
    currency: str
    total_saved: DecimalStr
    total_target: DecimalStr
    progress_percent: PercentStr
    goals: list[SavingsGoalOut]
