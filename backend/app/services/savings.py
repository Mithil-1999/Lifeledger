"""Savings goals. Every change to a goal's balance is logged as a contribution, so
current_amount always equals the sum of its contributions and history can be charted."""

import uuid
from datetime import date
from decimal import ROUND_HALF_UP, ROUND_UP, Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import SavingsContribution, SavingsGoal
from app.services import ledger

ZERO = Decimal("0.00")
CENT = Decimal("0.01")


class SavingsError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _progress(current: Decimal, target: Decimal) -> Decimal:
    return (current * 100 / target).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def months_left(today: date, target: date) -> int:
    """Whole calendar months remaining including the current one (min 1)."""
    return max(1, (target.year - today.year) * 12 + (target.month - today.month) + (1 if target.day >= today.day else 0))


def goal_out(goal: SavingsGoal, today: date) -> dict[str, Any]:
    remaining = max(goal.target_amount - goal.current_amount, ZERO)
    completed = goal.current_amount >= goal.target_amount
    monthly_needed = None
    if goal.target_date and not completed and goal.target_date >= today:
        # Round UP to the cent so paying this each month really reaches the target.
        monthly_needed = (remaining / months_left(today, goal.target_date)).quantize(CENT, rounding=ROUND_UP)
    return {
        "id": goal.id,
        "name": goal.name,
        "target_amount": goal.target_amount,
        "current_amount": goal.current_amount,
        "currency": goal.currency,
        "target_date": goal.target_date,
        "description": goal.description,
        "progress_percent": _progress(goal.current_amount, goal.target_amount),
        "remaining_amount": remaining,
        "completed": completed,
        "monthly_needed": monthly_needed,
        "created_at": goal.created_at,
        "updated_at": goal.updated_at,
    }


def get_goal(db: Session, user_id: uuid.UUID, goal_id: uuid.UUID) -> SavingsGoal:
    goal = db.scalar(select(SavingsGoal).where(SavingsGoal.id == goal_id, SavingsGoal.user_id == user_id))
    if goal is None:
        raise SavingsError("Savings goal not found.", 404)
    return goal


def overview(db: Session, user_id: uuid.UUID, today: date) -> dict[str, Any]:
    goals = db.scalars(
        select(SavingsGoal).where(SavingsGoal.user_id == user_id).order_by(SavingsGoal.target_date.asc().nulls_last(), SavingsGoal.name)
    ).all()
    total_saved = sum((g.current_amount for g in goals), ZERO)
    total_target = sum((g.target_amount for g in goals), ZERO)
    return {
        "currency": get_settings().default_currency,
        "total_saved": total_saved,
        "total_target": total_target,
        "progress_percent": _progress(total_saved, total_target) if total_target > 0 else Decimal("0.0"),
        "goals": [goal_out(g, today) for g in goals],
    }


def _log(db: Session, goal: SavingsGoal, amount: Decimal, on: date, note: str | None) -> None:
    if amount != 0:
        db.add(SavingsContribution(user_id=goal.user_id, goal_id=goal.id, amount=amount, date=on, note=note))


def create_goal(db: Session, user_id: uuid.UUID, data: dict[str, Any], today: date) -> SavingsGoal:
    goal = SavingsGoal(
        user_id=user_id,
        name=data["name"],
        target_amount=data["target_amount"],
        current_amount=data["current_amount"],
        currency=get_settings().default_currency,
        target_date=data["target_date"],
        description=data["description"],
    )
    db.add(goal)
    db.flush()
    _log(db, goal, data["current_amount"], today, "Starting balance")
    db.commit()
    db.refresh(goal)
    return goal


def update_goal(db: Session, user_id: uuid.UUID, goal_id: uuid.UUID, data: dict[str, Any], today: date) -> SavingsGoal:
    goal = get_goal(db, user_id, goal_id)
    difference = data["current_amount"] - goal.current_amount
    for field in ("name", "target_amount", "current_amount", "target_date", "description"):
        setattr(goal, field, data[field])
    _log(db, goal, difference, today, "Balance adjusted")
    db.commit()
    db.refresh(goal)
    return goal


def delete_goal(db: Session, user_id: uuid.UUID, goal_id: uuid.UUID) -> None:
    db.delete(get_goal(db, user_id, goal_id))
    db.commit()


def contribute(db: Session, user_id: uuid.UUID, goal_id: uuid.UUID, kind: str, amount: Decimal, on: date, note: str | None) -> SavingsGoal:
    goal = get_goal(db, user_id, goal_id)
    signed = amount if kind == "deposit" else -amount
    if goal.current_amount + signed < 0:
        raise SavingsError("You can't withdraw more than this goal's balance.", 422)
    goal.current_amount += signed
    _log(db, goal, signed, on, note)
    db.commit()
    db.refresh(goal)
    return goal


def list_contributions(db: Session, user_id: uuid.UUID, goal_id: uuid.UUID) -> list[SavingsContribution]:
    get_goal(db, user_id, goal_id)
    return list(
        db.scalars(
            select(SavingsContribution)
            .where(SavingsContribution.goal_id == goal_id, SavingsContribution.user_id == user_id)
            .order_by(SavingsContribution.date.desc(), SavingsContribution.created_at.desc())
        )
    )


def total_saved(db: Session, user_id: uuid.UUID) -> tuple[Decimal, int]:
    row = db.execute(
        select(func.coalesce(func.sum(SavingsGoal.current_amount), ZERO), func.count(SavingsGoal.id)).where(SavingsGoal.user_id == user_id)
    ).one()
    return row[0], int(row[1])


def balance_history(db: Session, user_id: uuid.UUID, months: list[str]) -> list[tuple[str, Decimal]]:
    """Total saved at the end of each month in `months` (chronological), from contributions."""
    first_start = ledger.month_bounds(months[0])[0]
    opening = db.scalar(
        select(func.coalesce(func.sum(SavingsContribution.amount), ZERO)).where(
            SavingsContribution.user_id == user_id, SavingsContribution.date < first_start
        )
    )
    month_key = func.to_char(SavingsContribution.date, "YYYY-MM")
    changes = dict(
        db.execute(
            select(month_key, func.sum(SavingsContribution.amount))
            .where(
                SavingsContribution.user_id == user_id,
                SavingsContribution.date >= first_start,
                SavingsContribution.date <= ledger.month_bounds(months[-1])[1],
            )
            .group_by(month_key)
        ).all()
    )
    history, running = [], opening
    for month in months:
        running += changes.get(month, ZERO)
        history.append((month, running))
    return history
