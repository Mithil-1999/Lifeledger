"""Schemas for categories, income and expenses."""

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.core.config import get_settings
from app.models import CategoryKind, PaymentMethod, RecurrenceInterval
from app.schemas.common import DecimalStr

EARLIEST_DATE = date(2000, 1, 1)
MAX_AMOUNT = Decimal("999999999999.99")  # NUMERIC(14, 2)


def _blank_to_none(value: str | None) -> str | None:
    return value or None


CategoryName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
OptionalText = Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=255), AfterValidator(_blank_to_none)]
Notes = Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=2000), AfterValidator(_blank_to_none)]
# Exact decimals only: at most 2 decimal places, strictly positive, fits NUMERIC(14, 2).
Amount = Annotated[Decimal, Field(gt=0, le=MAX_AMOUNT, max_digits=14, decimal_places=2)]


# --- Categories ------------------------------------------------------------------------


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: CategoryKind
    name: str
    slug: str | None
    is_system: bool


class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: CategoryKind
    name: CategoryName


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName


# --- Income / expense records -----------------------------------------------------------


class _LedgerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Amount
    currency: str | None = Field(default=None, description="ISO 4217 code; defaults to the app currency (NPR)")
    date: date
    category_id: uuid.UUID
    payment_method: PaymentMethod
    is_recurring: bool = False
    recurrence_interval: RecurrenceInterval | None = None
    description: OptionalText = None
    notes: Notes = None

    @field_validator("currency")
    @classmethod
    def _supported_currency(cls, value: str | None) -> str:
        settings = get_settings()
        code = (value or settings.default_currency).upper()
        if code not in settings.supported_currencies:
            raise ValueError(f"Currency must be one of: {', '.join(settings.supported_currencies)}.")
        return code

    @field_validator("date")
    @classmethod
    def _reasonable_date(cls, value: date) -> date:
        latest = date.today() + timedelta(days=366)
        if not EARLIEST_DATE <= value <= latest:
            raise ValueError(f"Date must be between {EARLIEST_DATE.isoformat()} and {latest.isoformat()}.")
        return value

    @model_validator(mode="after")
    def _recurrence(self) -> "_LedgerIn":
        if self.currency is None:
            self.currency = get_settings().default_currency
        if self.is_recurring and self.recurrence_interval is None:
            raise ValueError("Choose how often this repeats.")
        if not self.is_recurring:
            self.recurrence_interval = None
        return self


class IncomeIn(_LedgerIn):
    source: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class ExpenseIn(_LedgerIn):
    pass


class _LedgerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    amount: DecimalStr
    currency: str
    date: date
    category: CategoryOut
    payment_method: PaymentMethod
    is_recurring: bool
    recurrence_interval: RecurrenceInterval | None
    description: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class IncomeOut(_LedgerOut):
    source: str


class ExpenseOut(_LedgerOut):
    pass


T = TypeVar("T")

SortOption = Literal["date_desc", "date_asc", "amount_desc", "amount_asc"]


class Page(BaseModel, Generic[T]):
    items: list[T]
    total_count: int
    # Sum of amounts across ALL records matching the filters (not just this page).
    total_amount: DecimalStr
    currency: str
    page: int
    page_size: int


class MonthTotal(BaseModel):
    month: str  # "2026-09"
    total: DecimalStr
    count: int


class CategoryTotal(BaseModel):
    category_id: uuid.UUID
    category: str
    total: DecimalStr
    count: int


class LedgerSummary(BaseModel):
    year: int
    currency: str
    year_total: DecimalStr
    year_count: int
    current_month: str
    current_month_total: DecimalStr
    months: list[MonthTotal]  # always 12 entries, January to December
    by_category: list[CategoryTotal]  # this year, largest first
