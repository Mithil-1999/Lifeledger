"""Shared logic for income and expense records.

Every function takes the ORM model (Income or Expense) and the owner's user id, and
every query is filtered by that user id. Totals are computed by PostgreSQL SUM() over
NUMERIC columns and returned as Decimal. No floating point is involved.
"""

import calendar
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Category, Expense, Income
from app.services.categories import get_usable_category

LedgerModel = type[Income] | type[Expense]
ZERO = Decimal("0.00")


class NotFoundError(Exception):
    pass


def kind_of(model: LedgerModel) -> str:
    return "income" if model is Income else "expense"


@dataclass
class LedgerFilters:
    search: str | None = None
    category_id: uuid.UUID | None = None
    payment_method: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    is_recurring: bool | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _filtered(model: LedgerModel, user_id: uuid.UUID, filters: LedgerFilters, currency: str) -> list[Any]:
    conditions: list[Any] = [model.user_id == user_id, model.currency == currency]
    if filters.category_id:
        conditions.append(model.category_id == filters.category_id)
    if filters.payment_method:
        conditions.append(model.payment_method == filters.payment_method)
    if filters.date_from:
        conditions.append(model.date >= filters.date_from)
    if filters.date_to:
        conditions.append(model.date <= filters.date_to)
    if filters.is_recurring is not None:
        conditions.append(model.is_recurring.is_(filters.is_recurring))
    if filters.min_amount is not None:
        conditions.append(model.amount >= filters.min_amount)
    if filters.max_amount is not None:
        conditions.append(model.amount <= filters.max_amount)
    if filters.search:
        pattern = f"%{_escape_like(filters.search.strip())}%"
        fields = [model.description, model.notes, Category.name]
        if model is Income:
            fields.append(Income.source)
        conditions.append(or_(*(field.ilike(pattern, escape="\\") for field in fields)))
    return conditions


SORTS = {
    "date_desc": lambda m: (m.date.desc(), m.created_at.desc()),
    "date_asc": lambda m: (m.date.asc(), m.created_at.asc()),
    "amount_desc": lambda m: (m.amount.desc(), m.date.desc()),
    "amount_asc": lambda m: (m.amount.asc(), m.date.desc()),
}


def list_records(
    db: Session,
    model: LedgerModel,
    user_id: uuid.UUID,
    filters: LedgerFilters,
    *,
    sort: str = "date_desc",
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[Any], int, Decimal, str]:
    currency = get_settings().default_currency
    conditions = _filtered(model, user_id, filters, currency)
    base: Select = select(model).join(Category, model.category_id == Category.id).where(and_(*conditions))

    totals = db.execute(
        select(func.count(model.id), func.coalesce(func.sum(model.amount), ZERO))
        .join(Category, model.category_id == Category.id)
        .where(and_(*conditions))
    ).one()
    items = db.scalars(base.order_by(*SORTS[sort](model)).limit(page_size).offset((page - 1) * page_size)).unique().all()
    return list(items), int(totals[0]), totals[1], currency


def get_record(db: Session, model: LedgerModel, user_id: uuid.UUID, record_id: uuid.UUID):
    record = db.scalar(select(model).where(model.id == record_id, model.user_id == user_id))
    if record is None:
        # Same response for "doesn't exist" and "belongs to someone else".
        raise NotFoundError
    return record


def _apply(db: Session, model: LedgerModel, user_id: uuid.UUID, record, data: dict[str, Any]) -> None:
    get_usable_category(db, user_id, data["category_id"], kind_of(model))
    for field, value in data.items():
        setattr(record, field, value)


def create_record(db: Session, model: LedgerModel, user_id: uuid.UUID, data: dict[str, Any]):
    record = model(user_id=user_id)
    _apply(db, model, user_id, record, data)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def update_record(db: Session, model: LedgerModel, user_id: uuid.UUID, record_id: uuid.UUID, data: dict[str, Any]):
    record = get_record(db, model, user_id, record_id)
    _apply(db, model, user_id, record, data)
    db.commit()
    db.refresh(record)
    return record


def delete_record(db: Session, model: LedgerModel, user_id: uuid.UUID, record_id: uuid.UUID) -> None:
    record = get_record(db, model, user_id, record_id)
    db.delete(record)
    db.commit()


# --- Aggregations -------------------------------------------------------------------------


def month_bounds(year_month: str) -> tuple[date, date]:
    """"2026-02" -> (2026-02-01, 2026-02-28)."""
    year, month = (int(part) for part in year_month.split("-"))
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def shift_month(year_month: str, delta: int) -> str:
    year, month = (int(part) for part in year_month.split("-"))
    index = year * 12 + (month - 1) + delta
    return f"{index // 12}-{index % 12 + 1:02d}"


def sum_between(db: Session, model: LedgerModel, user_id: uuid.UUID, start: date | None, end: date) -> Decimal:
    """Total amount in [start, end] (start=None means 'since the beginning')."""
    conditions = [model.user_id == user_id, model.currency == get_settings().default_currency, model.date <= end]
    if start is not None:
        conditions.append(model.date >= start)
    return db.scalar(select(func.coalesce(func.sum(model.amount), ZERO)).where(*conditions))


def monthly_totals(db: Session, model: LedgerModel, user_id: uuid.UUID, start: date, end: date) -> dict[str, tuple[Decimal, int]]:
    """{"2026-09": (total, count), ...} for months that have records in [start, end]."""
    month = func.to_char(model.date, "YYYY-MM")
    rows = db.execute(
        select(month, func.sum(model.amount), func.count(model.id))
        .where(
            model.user_id == user_id,
            model.currency == get_settings().default_currency,
            model.date >= start,
            model.date <= end,
        )
        .group_by(month)
    ).all()
    return {row[0]: (row[1], int(row[2])) for row in rows}


def category_totals(db: Session, model: LedgerModel, user_id: uuid.UUID, start: date, end: date) -> list[tuple[uuid.UUID, str, Decimal, int]]:
    total = func.sum(model.amount)
    rows = db.execute(
        select(Category.id, Category.name, total, func.count(model.id))
        .join(Category, model.category_id == Category.id)
        .where(
            model.user_id == user_id,
            model.currency == get_settings().default_currency,
            model.date >= start,
            model.date <= end,
        )
        .group_by(Category.id, Category.name)
        .order_by(total.desc(), Category.name)
    ).all()
    return [(row[0], row[1], row[2], int(row[3])) for row in rows]


def year_summary(db: Session, model: LedgerModel, user_id: uuid.UUID, year: int, current_month: str) -> dict[str, Any]:
    start, end = date(year, 1, 1), date(year, 12, 31)
    by_month = monthly_totals(db, model, user_id, start, end)
    months = []
    for m in range(1, 13):
        key = f"{year}-{m:02d}"
        total, count = by_month.get(key, (ZERO, 0))
        months.append({"month": key, "total": total, "count": count})
    categories = category_totals(db, model, user_id, start, end)

    # The current month may lie outside the requested year (e.g. viewing last year).
    if current_month.startswith(f"{year}-"):
        current_total = by_month.get(current_month, (ZERO, 0))[0]
    else:
        current_total = sum_between(db, model, user_id, *month_bounds(current_month))

    return {
        "year": year,
        "currency": get_settings().default_currency,
        "year_total": sum((m["total"] for m in months), ZERO),
        "year_count": sum(m["count"] for m in months),
        "current_month": current_month,
        "current_month_total": current_total,
        "months": months,
        "by_category": [
            {"category_id": cid, "category": name, "total": total, "count": count} for cid, name, total, count in categories
        ],
    }
