"""Income, expenses and their categories.

Money is stored as NUMERIC(14, 2): exact decimal arithmetic in PostgreSQL and
`decimal.Decimal` in Python. Floats are never used for amounts.
"""

import enum
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

MONEY = Numeric(14, 2)


class CategoryKind(enum.StrEnum):
    INCOME = "income"
    EXPENSE = "expense"


class PaymentMethod(enum.StrEnum):
    CASH = "cash"
    BANK_TRANSFER = "bank_transfer"
    CARD = "card"
    MOBILE_WALLET = "mobile_wallet"  # eSewa, Khalti, IME Pay, ...
    CHEQUE = "cheque"
    OTHER = "other"


class RecurrenceInterval(enum.StrEnum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"


def _in_list(column: str, enum_cls: type[enum.StrEnum]) -> str:
    values = ", ".join(f"'{member.value}'" for member in enum_cls)
    return f"{column} IN ({values})"


class Category(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Built-in categories have user_id NULL and is_system true; custom ones belong to a user."""

    __tablename__ = "categories"
    __table_args__ = (
        CheckConstraint(_in_list("kind", CategoryKind), name="kind_valid"),
        CheckConstraint("char_length(btrim(name)) BETWEEN 1 AND 50", name="name_length"),
        CheckConstraint("(is_system AND user_id IS NULL) OR (NOT is_system AND user_id IS NOT NULL)", name="owner_consistent"),
        # Names are unique per kind (case-insensitive): globally for built-ins, per user for custom ones.
        Index("uq_categories_system_kind_name", "kind", text("lower(name)"), unique=True, postgresql_where=text("user_id IS NULL")),
        Index("uq_categories_user_kind_name", "user_id", "kind", text("lower(name)"), unique=True, postgresql_where=text("user_id IS NOT NULL")),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    # Stable identifier for built-ins (e.g. "rent"), so later phases can reference them.
    slug: Mapped[str | None] = mapped_column(String(40))
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))


class _LedgerEntry(UUIDPrimaryKeyMixin, TimestampMixin):
    """Columns shared by income and expense records."""

    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="NPR", server_default="NPR")
    date: Mapped[date] = mapped_column(Date, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False)
    is_recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    recurrence_interval: Mapped[str | None] = mapped_column(String(10))
    description: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)


def _ledger_constraints(table: str) -> tuple:
    return (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
        CheckConstraint(_in_list("payment_method", PaymentMethod), name="payment_method_valid"),
        CheckConstraint(
            f"(is_recurring AND {_in_list('recurrence_interval', RecurrenceInterval)}) "
            "OR (NOT is_recurring AND recurrence_interval IS NULL)",
            name="recurrence_consistent",
        ),
        CheckConstraint("notes IS NULL OR char_length(notes) <= 2000", name="notes_length"),
        # Almost every query is "this user's records in a date range".
        Index(f"ix_{table}_user_id_date", "user_id", "date"),
    )


class Income(_LedgerEntry, Base):
    __tablename__ = "incomes"
    __table_args__ = _ledger_constraints("incomes")

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False, index=True
    )
    source: Mapped[str] = mapped_column(String(120), nullable=False)

    category: Mapped[Category] = relationship(lazy="joined")


class Expense(_LedgerEntry, Base):
    __tablename__ = "expenses"
    __table_args__ = _ledger_constraints("expenses")

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False, index=True
    )

    category: Mapped[Category] = relationship(lazy="joined")

