"""Recurring bill management.

Status model: "pending" and "paid" are stored; "overdue" is derived (pending and past
its due date), so it can never go stale. Paying a recurring bill records a payment and
moves the bill to its next due date; paying a one-time bill marks it paid.
"""

import calendar
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import BILL_EXPENSE_CATEGORY, Bill, BillCategory, BillFrequency, BillPayment, BillStatus, Category, Expense

ZERO = Decimal("0.00")
DUE_SOON_DAYS = 30


class BillError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


# --- Dates -------------------------------------------------------------------------------------


def add_months(value: date, months: int, anchor_day: int) -> date:
    index = value.year * 12 + (value.month - 1) + months
    year, month = index // 12, index % 12 + 1
    return date(year, month, min(anchor_day, calendar.monthrange(year, month)[1]))


def next_due_date(due: date, frequency: str, anchor_day: int) -> date:
    if frequency == BillFrequency.WEEKLY:
        return due + timedelta(days=7)
    months = {BillFrequency.MONTHLY: 1, BillFrequency.QUARTERLY: 3, BillFrequency.YEARLY: 12}[BillFrequency(frequency)]
    return add_months(due, months, anchor_day)


def effective_status(bill: Bill, today: date) -> str:
    if bill.status == BillStatus.PAID:
        return "paid"
    return "overdue" if bill.due_date < today else "pending"


# --- Reading -----------------------------------------------------------------------------------


def _last_paid(db: Session, user_id: uuid.UUID, bill_ids: list[uuid.UUID]) -> dict[uuid.UUID, date]:
    if not bill_ids:
        return {}
    rows = db.execute(
        select(BillPayment.bill_id, func.max(BillPayment.paid_on))
        .where(BillPayment.user_id == user_id, BillPayment.bill_id.in_(bill_ids))
        .group_by(BillPayment.bill_id)
    ).all()
    return dict(rows)


def to_out(bill: Bill, today: date, last_paid_on: date | None) -> dict[str, Any]:
    return {
        "id": bill.id,
        "name": bill.name,
        "amount": bill.amount,
        "currency": bill.currency,
        "category": bill.category,
        "due_date": bill.due_date,
        "frequency": bill.frequency,
        "status": effective_status(bill, today),
        "days_until_due": (bill.due_date - today).days,
        "notes": bill.notes,
        "last_paid_on": last_paid_on,
        "created_at": bill.created_at,
        "updated_at": bill.updated_at,
    }


_STATUS_ORDER = {"overdue": 0, "pending": 1, "paid": 2}


def list_bills(db: Session, user_id: uuid.UUID, today: date, status: str | None = None, category: str | None = None) -> list[dict]:
    stmt = select(Bill).where(Bill.user_id == user_id)
    if category:
        stmt = stmt.where(Bill.category == category)
    bills = db.scalars(stmt).all()
    last_paid = _last_paid(db, user_id, [b.id for b in bills])
    items = [to_out(b, today, last_paid.get(b.id)) for b in bills]
    if status:
        items = [i for i in items if i["status"] == status]
    # Overdue first, then soonest due; paid bills last.
    items.sort(key=lambda i: (_STATUS_ORDER[i["status"]], i["due_date"], i["name"].lower()))
    return items


def overview(db: Session, user_id: uuid.UUID, today: date, status: str | None = None, category: str | None = None) -> dict:
    items = list_bills(db, user_id, today, None, category)
    overdue = [i for i in items if i["status"] == "overdue"]
    due_soon = [i for i in items if i["status"] == "pending" and i["days_until_due"] <= DUE_SOON_DAYS]
    month_start = today.replace(day=1)
    paid_this_month = db.scalar(
        select(func.coalesce(func.sum(BillPayment.amount), ZERO)).where(
            BillPayment.user_id == user_id, BillPayment.paid_on >= month_start, BillPayment.paid_on <= today
        )
    )
    return {
        "currency": get_settings().default_currency,
        "items": [i for i in items if status is None or i["status"] == status],
        "overdue_count": len(overdue),
        "overdue_total": sum((i["amount"] for i in overdue), ZERO),
        "due_soon_count": len(due_soon),
        "due_soon_total": sum((i["amount"] for i in due_soon), ZERO),
        "paid_this_month_total": paid_this_month,
    }


def get_bill(db: Session, user_id: uuid.UUID, bill_id: uuid.UUID) -> Bill:
    bill = db.scalar(select(Bill).where(Bill.id == bill_id, Bill.user_id == user_id))
    if bill is None:
        raise BillError("Bill not found.", 404)
    return bill


def bill_out(db: Session, user_id: uuid.UUID, bill: Bill, today: date) -> dict:
    return to_out(bill, today, _last_paid(db, user_id, [bill.id]).get(bill.id))


# --- Writing -----------------------------------------------------------------------------------


def _apply(bill: Bill, data: dict[str, Any]) -> None:
    if data["frequency"] != BillFrequency.ONE_TIME and data["status"] == BillStatus.PAID:
        raise BillError("Recurring bills are paid with “Mark as paid” each cycle.", 422)
    for field in ("name", "amount", "category", "due_date", "frequency", "notes", "status"):
        setattr(bill, field, data[field])
    bill.anchor_day = data["due_date"].day


def create_bill(db: Session, user_id: uuid.UUID, data: dict[str, Any]) -> Bill:
    bill = Bill(user_id=user_id, currency=get_settings().default_currency)
    _apply(bill, data)
    db.add(bill)
    db.commit()
    db.refresh(bill)
    return bill


def update_bill(db: Session, user_id: uuid.UUID, bill_id: uuid.UUID, data: dict[str, Any]) -> Bill:
    bill = get_bill(db, user_id, bill_id)
    _apply(bill, data)
    db.commit()
    db.refresh(bill)
    return bill


def delete_bill(db: Session, user_id: uuid.UUID, bill_id: uuid.UUID) -> None:
    # Payment history goes with it; expenses created from payments are kept (they're real spending).
    db.delete(get_bill(db, user_id, bill_id))
    db.commit()


def pay_bill(
    db: Session,
    user_id: uuid.UUID,
    bill_id: uuid.UUID,
    *,
    paid_on: date,
    amount: Decimal | None,
    record_expense: bool,
    payment_method: str,
) -> Bill:
    bill = get_bill(db, user_id, bill_id)
    if bill.status == BillStatus.PAID:
        raise BillError("This bill is already paid.", 409)
    paid_amount = amount if amount is not None else bill.amount

    expense_id = None
    if record_expense:
        slug = BILL_EXPENSE_CATEGORY[BillCategory(bill.category)]
        category = db.scalar(select(Category).where(Category.is_system.is_(True), Category.kind == "expense", Category.slug == slug))
        expense = Expense(
            user_id=user_id,
            category_id=category.id,
            amount=paid_amount,
            currency=bill.currency,
            date=paid_on,
            payment_method=payment_method,
            description=f"{bill.name} (bill)"[:255],
        )
        db.add(expense)
        db.flush()
        expense_id = expense.id

    db.add(BillPayment(user_id=user_id, bill_id=bill.id, amount=paid_amount, paid_on=paid_on, due_date=bill.due_date, expense_id=expense_id))
    if bill.frequency == BillFrequency.ONE_TIME:
        bill.status = BillStatus.PAID
    else:
        bill.due_date = next_due_date(bill.due_date, bill.frequency, bill.anchor_day)
    db.commit()
    db.refresh(bill)
    return bill


def list_payments(db: Session, user_id: uuid.UUID, bill_id: uuid.UUID) -> list[BillPayment]:
    get_bill(db, user_id, bill_id)
    return list(
        db.scalars(
            select(BillPayment)
            .where(BillPayment.bill_id == bill_id, BillPayment.user_id == user_id)
            .order_by(BillPayment.paid_on.desc(), BillPayment.created_at.desc())
        )
    )
