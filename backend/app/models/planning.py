"""Budgets, bills and savings goals (Phase 5). Money columns are NUMERIC(14, 2)."""

import enum
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.finance import MONEY, Category, Expense, _in_list


def _user_fk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)


# --- Budgets ---------------------------------------------------------------------------------


class Budget(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Spending limit for one expense category in one month."""

    __tablename__ = "budgets"
    __table_args__ = (
        UniqueConstraint("user_id", "category_id", "month", name="uq_budgets_user_category_month"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("extract(day from month) = 1", name="month_first_day"),
        CheckConstraint("warning_threshold BETWEEN 1 AND 100", name="threshold_range"),
    )

    user_id: Mapped[uuid.UUID] = _user_fk()
    category_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False)
    month: Mapped[date] = mapped_column(Date, nullable=False)  # always the 1st of the month
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    # Warn once spending reaches this percentage of the budget.
    warning_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=80, server_default="80")

    category: Mapped[Category] = relationship(lazy="joined")


# --- Bills -------------------------------------------------------------------------------------


class BillCategory(enum.StrEnum):
    RENT = "rent"
    WIFI = "wifi"
    ELECTRICITY = "electricity"
    WATER = "water"
    MOBILE = "mobile"
    SUBSCRIPTION = "subscription"
    INSURANCE = "insurance"
    LOAN = "loan"
    OTHER = "other"


# Bill category -> built-in expense category slug used when a payment is recorded as an expense.
BILL_EXPENSE_CATEGORY = {
    BillCategory.RENT: "rent",
    BillCategory.WIFI: "internet",
    BillCategory.ELECTRICITY: "electricity",
    BillCategory.WATER: "water",
    BillCategory.MOBILE: "mobile",
    BillCategory.SUBSCRIPTION: "subscription",
    BillCategory.INSURANCE: "insurance",
    BillCategory.LOAN: "loan_payment",
    BillCategory.OTHER: "other",
}


class BillFrequency(enum.StrEnum):
    ONE_TIME = "one_time"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"


class BillStatus(enum.StrEnum):
    """Stored status. "overdue" is never stored: it's derived (pending and past due)."""

    PENDING = "pending"
    PAID = "paid"


class Bill(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "bills"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(_in_list("category", BillCategory), name="category_valid"),
        CheckConstraint(_in_list("frequency", BillFrequency), name="frequency_valid"),
        CheckConstraint(_in_list("status", BillStatus), name="status_valid"),
        CheckConstraint("notes IS NULL OR char_length(notes) <= 2000", name="notes_length"),
        CheckConstraint("anchor_day BETWEEN 1 AND 31", name="anchor_day_range"),
        Index("ix_bills_user_id_due_date", "user_id", "due_date"),
    )

    user_id: Mapped[uuid.UUID] = _user_fk()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="NPR", server_default="NPR")
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    # Next date the bill is due. Paying a recurring bill moves this to the next cycle.
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Intended day of month for monthly+ bills, so a bill due on the 31st returns to the
    # 31st after a shorter month instead of drifting to the 28th/30th forever.
    anchor_day: Mapped[int] = mapped_column(Integer, nullable=False)
    frequency: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default=BillStatus.PENDING, server_default="pending")
    notes: Mapped[str | None] = mapped_column(Text)

    payments: Mapped[list["BillPayment"]] = relationship(
        back_populates="bill", cascade="all, delete-orphan", passive_deletes=True, order_by="BillPayment.paid_on.desc()"
    )


class BillPayment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One payment of a bill (one cycle). Optionally linked to the expense it created."""

    __tablename__ = "bill_payments"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    user_id: Mapped[uuid.UUID] = _user_fk()
    bill_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    paid_on: Mapped[date] = mapped_column(Date, nullable=False)
    # The due date of the cycle this payment settled.
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    expense_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="SET NULL")
    )

    bill: Mapped[Bill] = relationship(back_populates="payments")
    expense: Mapped[Expense | None] = relationship()


# --- Savings -------------------------------------------------------------------------------------


class SavingsGoal(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "savings_goals"
    __table_args__ = (
        CheckConstraint("target_amount > 0", name="target_positive"),
        # Kept equal to the sum of the goal's contributions by the service layer.
        CheckConstraint("current_amount >= 0", name="current_non_negative"),
        CheckConstraint("description IS NULL OR char_length(description) <= 2000", name="description_length"),
    )

    user_id: Mapped[uuid.UUID] = _user_fk()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    target_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    current_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"), server_default="0")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="NPR", server_default="NPR")
    target_date: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(Text)

    contributions: Mapped[list["SavingsContribution"]] = relationship(
        back_populates="goal",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="(SavingsContribution.date.desc(), SavingsContribution.created_at.desc())",
    )


class SavingsContribution(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A deposit (positive) or withdrawal (negative) on a savings goal."""

    __tablename__ = "savings_contributions"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="amount_non_zero"),
        Index("ix_savings_contributions_user_id_date", "user_id", "date"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    goal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("savings_goals.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(String(255))

    goal: Mapped[SavingsGoal] = relationship(back_populates="contributions")
