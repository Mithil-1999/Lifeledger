"""Monthly category budgets. Spent amounts always come from the user's real expenses."""

import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Budget, Expense
from app.services import ledger
from app.services.categories import CategoryError, get_usable_category

ZERO = Decimal("0.00")
ONE_DECIMAL = Decimal("0.1")


class BudgetError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def month_start(year_month: str) -> date:
    return ledger.month_bounds(year_month)[0]


def percent(part: Decimal, whole: Decimal) -> Decimal:
    """part / whole as a percentage with one decimal place (exact decimal arithmetic)."""
    if whole <= 0:
        return Decimal("0.0")
    return (part * 100 / whole).quantize(ONE_DECIMAL, rounding=ROUND_HALF_UP)


def budget_status(spent: Decimal, amount: Decimal, threshold: int) -> str:
    if spent > amount:
        return "over"
    # Compare exactly (spent/amount >= threshold%), not the rounded display percentage:
    # 799.99 of 1000 is 79.999%, which rounds to "80.0" but must not trigger an 80% warning.
    if spent * 100 >= amount * threshold:
        return "warning"
    return "ok"


def _get(db: Session, user_id: uuid.UUID, budget_id: uuid.UUID) -> Budget:
    budget = db.scalar(select(Budget).where(Budget.id == budget_id, Budget.user_id == user_id))
    if budget is None:
        raise BudgetError("Budget not found.", 404)
    return budget


def budget_month(db: Session, user_id: uuid.UUID, year_month: str) -> dict[str, Any]:
    start, end = ledger.month_bounds(year_month)
    budgets = db.scalars(select(Budget).where(Budget.user_id == user_id, Budget.month == start)).unique().all()
    spent_by_category = {cid: total for cid, _, total, _ in ledger.category_totals(db, Expense, user_id, start, end)}

    rows = []
    for budget in budgets:
        spent = spent_by_category.get(budget.category_id, ZERO)
        rows.append(
            {
                "id": budget.id,
                "category": budget.category,
                "month": year_month,
                "amount": budget.amount,
                "warning_threshold": budget.warning_threshold,
                "spent": spent,
                "remaining": budget.amount - spent,
                "percent_used": percent(spent, budget.amount),
                "status": budget_status(spent, budget.amount, budget.warning_threshold),
            }
        )
    # Most at-risk first, then alphabetically.
    rows.sort(key=lambda r: (-r["percent_used"], r["category"].name.lower()))

    total_budget = sum((r["amount"] for r in rows), ZERO)
    total_spent = sum((r["spent"] for r in rows), ZERO)
    all_spent = sum(spent_by_category.values(), ZERO)
    return {
        "month": year_month,
        "currency": get_settings().default_currency,
        "total_budget": total_budget,
        "total_spent": total_spent,
        "total_remaining": total_budget - total_spent,
        "percent_used": percent(total_spent, total_budget),
        "unbudgeted_spent": all_spent - total_spent,
        "budgets": rows,
    }


def find_row(db: Session, user_id: uuid.UUID, budget: Budget) -> dict[str, Any]:
    month = budget.month.strftime("%Y-%m")
    return next(r for r in budget_month(db, user_id, month)["budgets"] if r["id"] == budget.id)


def create_budget(db: Session, user_id: uuid.UUID, category_id: uuid.UUID, year_month: str, amount: Decimal, threshold: int) -> Budget:
    try:
        get_usable_category(db, user_id, category_id, "expense")
    except CategoryError as exc:
        raise BudgetError(str(exc), 422) from None
    budget = Budget(user_id=user_id, category_id=category_id, month=month_start(year_month), amount=amount, warning_threshold=threshold)
    db.add(budget)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise BudgetError("This category already has a budget for that month.", 409) from None
    db.refresh(budget)
    return budget


def update_budget(db: Session, user_id: uuid.UUID, budget_id: uuid.UUID, amount: Decimal, threshold: int) -> Budget:
    budget = _get(db, user_id, budget_id)
    budget.amount = amount
    budget.warning_threshold = threshold
    db.commit()
    db.refresh(budget)
    return budget


def delete_budget(db: Session, user_id: uuid.UUID, budget_id: uuid.UUID) -> None:
    db.delete(_get(db, user_id, budget_id))
    db.commit()


def copy_budgets(db: Session, user_id: uuid.UUID, from_month: str, to_month: str) -> tuple[int, int]:
    """Copy one month's budgets into another, skipping categories already budgeted there."""
    if from_month == to_month:
        raise BudgetError("Choose two different months.", 422)
    source = db.scalars(select(Budget).where(Budget.user_id == user_id, Budget.month == month_start(from_month))).unique().all()
    existing = set(
        db.scalars(select(Budget.category_id).where(Budget.user_id == user_id, Budget.month == month_start(to_month)))
    )
    copied = 0
    for budget in source:
        if budget.category_id in existing:
            continue
        db.add(
            Budget(
                user_id=user_id,
                category_id=budget.category_id,
                month=month_start(to_month),
                amount=budget.amount,
                warning_threshold=budget.warning_threshold,
            )
        )
        copied += 1
    db.commit()
    return copied, len(source) - copied
