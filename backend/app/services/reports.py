"""Financial reports (Phase 10).

Every figure is computed from the user's stored records with exact Decimal arithmetic
(PostgreSQL SUM over NUMERIC). Rules that keep the numbers honest:

- A figure that can't be computed is None, never a made-up 0 (a savings rate with no
  income, a percentage change from nothing, a balance for a month that hasn't started).
- "Balance" is everything earned minus everything spent up to a date, and never counts
  entries dated after today (the same definition as the dashboard).
- Budgets are monthly, so the budget report always compares whole months.
- Bill status is "as of today"; paid amounts come from the payment history.
- Monthly/yearly equivalents of recurring bills are labelled averages (weekly x 52 / 12).
"""

import csv
import io
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Bill, BillFrequency, BillPayment, Category, Expense, Income, SavingsContribution
from app.services import bills as bill_service
from app.services import budgets as budget_service
from app.services import ledger
from app.services import savings as savings_service

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
MAX_RANGE_DAYS = 366 * 5
TREND_MONTHS_FOR_ONE_MONTH = 6
TOP_EXPENSES = 10
MAX_LIST = 50


class ReportError(Exception):
    def __init__(self, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


# --- Periods -----------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ReportPeriod:
    kind: str  # "month" | "year" | "range"
    start: date
    end: date
    label: str
    # Months shown in trend charts: the period's months, or the 6 months up to it for a single month.
    trend_start: date
    months: tuple[str, ...]  # months overlapping [start, end]
    trend_months: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "start": self.start,
            "end": self.end,
            "label": self.label,
            "trend_start": self.trend_start,
            "months": list(self.months),
            "trend_months": list(self.trend_months),
        }


def month_key(value: date) -> str:
    return value.strftime("%Y-%m")


def months_between(start: date, end: date) -> tuple[str, ...]:
    months, current, last = [], month_key(start), month_key(end)
    while current <= last:
        months.append(current)
        current = ledger.shift_month(current, 1)
    return tuple(months)


def _valid_year(year: int) -> None:
    if not 2000 <= year <= 2100:
        raise ReportError("Choose a year between 2000 and 2100.")


def resolve_period(
    today: date,
    *,
    year: int | None = None,
    month: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> ReportPeriod:
    """Custom dates win over a month, which wins over a year. Nothing = the current month."""
    if date_from is not None or date_to is not None:
        if date_from is None or date_to is None:
            raise ReportError("Choose both a start and an end date.")
        if date_to < date_from:
            raise ReportError("The end date can't be before the start date.")
        if (date_to - date_from).days > MAX_RANGE_DAYS:
            raise ReportError("Choose a range of at most 5 years.")
        _valid_year(date_from.year)
        _valid_year(date_to.year)
        months = months_between(date_from, date_to)
        label = f"{date_from:%d %b %Y} – {date_to:%d %b %Y}"
        return ReportPeriod("range", date_from, date_to, label, date_from, months, months)
    if month is not None:
        start, end = ledger.month_bounds(month)
        _valid_year(start.year)
        first = ledger.shift_month(month, -(TREND_MONTHS_FOR_ONE_MONTH - 1))
        return ReportPeriod(
            "month", start, end, f"{start:%B %Y}", ledger.month_bounds(first)[0], (month,), months_between(ledger.month_bounds(first)[0], end)
        )
    if year is not None:
        _valid_year(year)
        start, end = date(year, 1, 1), date(year, 12, 31)
        months = months_between(start, end)
        return ReportPeriod("year", start, end, str(year), start, months, months)
    return resolve_period(today, month=month_key(today))


def previous_period(period: ReportPeriod) -> tuple[date, date]:
    """The period just before: the previous month / year, or a range of the same length."""
    if period.kind == "month":
        return ledger.month_bounds(ledger.shift_month(month_key(period.start), -1))
    if period.kind == "year":
        return date(period.start.year - 1, 1, 1), date(period.start.year - 1, 12, 31)
    length = (period.end - period.start).days
    end = period.start - timedelta(days=1)
    return end - timedelta(days=length), end


def clip(month: str, start: date, end: date) -> tuple[date, date]:
    """A month's bounds, clipped to [start, end] (custom ranges can start or end mid-month)."""
    first, last = ledger.month_bounds(month)
    return max(first, start), min(last, end)


# --- Small exact helpers ------------------------------------------------------------------------------------


def percent(part: Decimal, whole: Decimal) -> Decimal | None:
    """part / whole in percent (1 dp), or None when whole is zero (a share of nothing is undefined)."""
    if whole == 0:
        return None
    return (part * 100 / whole).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def change(current: Decimal, previous: Decimal) -> dict[str, Any]:
    return {"amount": current - previous, "percent": percent(current - previous, abs(previous)) if previous else None}


def _currency() -> str:
    return get_settings().default_currency


def _money_filter(model) -> list[Any]:
    return [model.currency == _currency()]


def balance_as_of(db: Session, user_id: uuid.UUID, on: date) -> Decimal:
    return ledger.sum_between(db, Income, user_id, None, on) - ledger.sum_between(db, Expense, user_id, None, on)


def _monthly(db: Session, model, user_id: uuid.UUID, start: date, end: date, category_id: uuid.UUID | None = None) -> dict[str, Decimal]:
    key = func.to_char(model.date, "YYYY-MM")
    stmt = (
        select(key, func.sum(model.amount))
        .where(model.user_id == user_id, *_money_filter(model), model.date >= start, model.date <= end)
        .group_by(key)
    )
    if category_id is not None:
        stmt = stmt.where(model.category_id == category_id)
    return dict(db.execute(stmt).all())


def _contributions_by_month(db: Session, user_id: uuid.UUID, start: date, end: date) -> dict[str, tuple[Decimal, Decimal]]:
    """{"2026-09": (deposits, withdrawals as a positive number)} from the savings contribution log."""
    key = func.to_char(SavingsContribution.date, "YYYY-MM")
    deposits = func.coalesce(func.sum(case((SavingsContribution.amount > 0, SavingsContribution.amount))), ZERO)
    withdrawals = func.coalesce(func.sum(case((SavingsContribution.amount < 0, -SavingsContribution.amount))), ZERO)
    rows = db.execute(
        select(key, deposits, withdrawals)
        .where(SavingsContribution.user_id == user_id, SavingsContribution.date >= start, SavingsContribution.date <= end)
        .group_by(key)
    ).all()
    return {row[0]: (row[1], row[2]) for row in rows}


# --- Monthly finance --------------------------------------------------------------------------------------------


def finance_report(db: Session, user_id: uuid.UUID, period: ReportPeriod, today: date) -> dict[str, Any]:
    income_by_month = _monthly(db, Income, user_id, period.trend_start, period.end)
    expense_by_month = _monthly(db, Expense, user_id, period.trend_start, period.end)
    savings_by_month = _contributions_by_month(db, user_id, period.trend_start, period.end)

    rows = []
    for month in period.trend_months:
        income = income_by_month.get(month, ZERO)
        expenses = expense_by_month.get(month, ZERO)
        deposits, withdrawals = savings_by_month.get(month, (ZERO, ZERO))
        start, end = clip(month, period.trend_start, period.end)
        rows.append(
            {
                "month": month,
                "income": income,
                "expenses": expenses,
                "net": income - expenses,
                "savings": deposits - withdrawals,
                # Closing balance for the month; None for months that haven't started yet.
                "balance": balance_as_of(db, user_id, min(end, today)) if start <= today else None,
            }
        )

    income = ledger.sum_between(db, Income, user_id, period.start, period.end)
    expenses = ledger.sum_between(db, Expense, user_id, period.start, period.end)
    deposits = withdrawals = ZERO
    for dep, wd in _contributions_by_month(db, user_id, period.start, period.end).values():
        deposits += dep
        withdrawals += wd
    net = income - expenses
    return {
        "currency": _currency(),
        "period": period.as_dict(),
        "totals": {
            "income": income,
            "expenses": expenses,
            "net": net,
            # Share of income left after expenses; undefined without income.
            "savings_rate": percent(net, income) if income > 0 else None,
            "savings_deposits": deposits,
            "savings_withdrawals": withdrawals,
            "savings": deposits - withdrawals,
            "closing_balance": balance_as_of(db, user_id, min(period.end, today)) if period.start <= today else None,
            "balance_as_of": min(period.end, today) if period.start <= today else None,
        },
        "months": rows,
    }


# --- Expenses ------------------------------------------------------------------------------------------------------


def _category_totals(db: Session, user_id: uuid.UUID, start: date, end: date, category_id: uuid.UUID | None) -> list[tuple[uuid.UUID, str, Decimal, int]]:
    total = func.sum(Expense.amount)
    stmt = (
        select(Category.id, Category.name, total, func.count(Expense.id))
        .join(Category, Expense.category_id == Category.id)
        .where(Expense.user_id == user_id, *_money_filter(Expense), Expense.date >= start, Expense.date <= end)
        .group_by(Category.id, Category.name)
        .order_by(total.desc(), Category.name)
    )
    if category_id is not None:
        stmt = stmt.where(Expense.category_id == category_id)
    return [(r[0], r[1], r[2], int(r[3])) for r in db.execute(stmt).all()]


def _expense_row(expense: Expense) -> dict[str, Any]:
    return {
        "id": expense.id,
        "date": expense.date,
        "category": expense.category.name,
        "description": expense.description,
        "amount": expense.amount,
        "payment_method": expense.payment_method,
        "is_recurring": expense.is_recurring,
        "recurrence_interval": expense.recurrence_interval,
    }


def expense_query(user_id: uuid.UUID, start: date, end: date, category_id: uuid.UUID | None):
    stmt = select(Expense).where(Expense.user_id == user_id, *_money_filter(Expense), Expense.date >= start, Expense.date <= end)
    if category_id is not None:
        stmt = stmt.where(Expense.category_id == category_id)
    return stmt


def expense_report(db: Session, user_id: uuid.UUID, period: ReportPeriod, category_id: uuid.UUID | None = None) -> dict[str, Any]:
    categories = _category_totals(db, user_id, period.start, period.end, category_id)
    total = sum((c[2] for c in categories), ZERO)
    count = sum(c[3] for c in categories)

    prev_start, prev_end = previous_period(period)
    previous = {cid: (name, amount) for cid, name, amount, _ in _category_totals(db, user_id, prev_start, prev_end, category_id)}
    previous_total = sum((amount for _, amount in previous.values()), ZERO)

    by_category = [
        {
            "category_id": cid,
            "category": name,
            "amount": amount,
            "count": n,
            "percent": percent(amount, total),
            "previous_amount": previous.get(cid, (name, ZERO))[1],
        }
        for cid, name, amount, n in categories
    ]
    # Categories with spending only in the previous period still belong in the comparison.
    seen = {c["category_id"] for c in by_category}
    for cid, (name, amount) in sorted(previous.items(), key=lambda kv: (-kv[1][1], kv[1][0])):
        if cid not in seen:
            by_category.append({"category_id": cid, "category": name, "amount": ZERO, "count": 0, "percent": percent(ZERO, total), "previous_amount": amount})
    for row in by_category:
        row["change"] = change(row["amount"], row["previous_amount"])

    largest = db.scalars(
        expense_query(user_id, period.start, period.end, category_id).order_by(Expense.amount.desc(), Expense.date.desc()).limit(TOP_EXPENSES)
    ).all()

    recurring_rows = db.scalars(
        expense_query(user_id, period.start, period.end, category_id)
        .where(Expense.is_recurring.is_(True))
        .order_by(Expense.date.desc())
    ).all()
    groups: dict[tuple, dict[str, Any]] = {}
    for e in recurring_rows:
        key = (e.category.name, (e.description or "").strip().lower(), e.recurrence_interval)
        group = groups.setdefault(
            key,
            {"category": e.category.name, "description": e.description, "interval": e.recurrence_interval, "count": 0, "total": ZERO, "last_amount": e.amount, "last_date": e.date},
        )
        group["count"] += 1
        group["total"] += e.amount
    recurring_total = sum((e.amount for e in recurring_rows), ZERO)

    by_month = _monthly(db, Expense, user_id, period.trend_start, period.end, category_id)
    monthly, prev_amount = [], None
    for month in period.trend_months:
        amount = by_month.get(month, ZERO)
        monthly.append({"month": month, "amount": amount, "change": change(amount, prev_amount) if prev_amount is not None else None})
        prev_amount = amount

    return {
        "currency": _currency(),
        "period": period.as_dict(),
        "category_id": category_id,
        "total": total,
        "count": count,
        "previous": {"start": prev_start, "end": prev_end, "total": previous_total, "change": change(total, previous_total)},
        "by_category": by_category,
        "largest": [_expense_row(e) for e in largest],
        "recurring": {
            "total": recurring_total,
            "count": len(recurring_rows),
            "percent_of_total": percent(recurring_total, total),
            "items": sorted(groups.values(), key=lambda g: (-g["total"], g["category"]))[:MAX_LIST],
        },
        "monthly": monthly,
    }


# --- Budget -----------------------------------------------------------------------------------------------------------


def budget_report(db: Session, user_id: uuid.UUID, period: ReportPeriod, category_id: uuid.UUID | None = None) -> dict[str, Any]:
    months, categories = [], {}
    for month in period.months:
        data = budget_service.budget_month(db, user_id, month)
        rows = [r for r in data["budgets"] if category_id is None or r["category"].id == category_id]
        budget = sum((r["amount"] for r in rows), ZERO)
        spent = sum((r["spent"] for r in rows), ZERO)
        months.append(
            {
                "month": month,
                "budget": budget,
                "spent": spent,
                "remaining": budget - spent,
                "percent_used": percent(spent, budget),
                "budgeted_categories": len(rows),
                "over_budget": sum(1 for r in rows if r["status"] == "over"),
                # Spending in categories without a budget this month (only meaningful unfiltered).
                "unbudgeted_spent": data["unbudgeted_spent"] if category_id is None else None,
            }
        )
        for r in rows:
            c = categories.setdefault(
                r["category"].id,
                {"category_id": r["category"].id, "category": r["category"].name, "budget": ZERO, "spent": ZERO, "months_budgeted": 0, "months_over": 0},
            )
            c["budget"] += r["amount"]
            c["spent"] += r["spent"]
            c["months_budgeted"] += 1
            c["months_over"] += r["status"] == "over"
    for c in categories.values():
        c["remaining"] = c["budget"] - c["spent"]
        c["percent_used"] = percent(c["spent"], c["budget"])

    budget = sum((m["budget"] for m in months), ZERO)
    spent = sum((m["spent"] for m in months), ZERO)
    return {
        "currency": _currency(),
        "period": period.as_dict(),
        "category_id": category_id,
        # Budgets are set per month, so partial months in a custom range count as whole months.
        "whole_months": True,
        "totals": {
            "budget": budget,
            "spent": spent,
            "remaining": budget - spent,
            "percent_used": percent(spent, budget),
            "unbudgeted_spent": sum((m["unbudgeted_spent"] for m in months), ZERO) if category_id is None else None,
        },
        "months": months,
        "categories": sorted(categories.values(), key=lambda c: (-(c["percent_used"] or 0), c["category"].lower())),
    }


# --- Savings ----------------------------------------------------------------------------------------------------------


def savings_report(db: Session, user_id: uuid.UUID, period: ReportPeriod, today: date) -> dict[str, Any]:
    by_month = _contributions_by_month(db, user_id, period.trend_start, period.end)
    history = dict(savings_service.balance_history(db, user_id, list(period.trend_months)))
    months = []
    for month in period.trend_months:
        deposits, withdrawals = by_month.get(month, (ZERO, ZERO))
        start, _ = clip(month, period.trend_start, period.end)
        months.append(
            {
                "month": month,
                "deposits": deposits,
                "withdrawals": withdrawals,
                "net": deposits - withdrawals,
                # Total in all goals at the end of the month (None for months that haven't started).
                "total_saved": history[month] if start <= today else None,
            }
        )

    in_period = dict(
        db.execute(
            select(SavingsContribution.goal_id, func.sum(SavingsContribution.amount))
            .where(SavingsContribution.user_id == user_id, SavingsContribution.date >= period.start, SavingsContribution.date <= period.end)
            .group_by(SavingsContribution.goal_id)
        ).all()
    )
    overview = savings_service.overview(db, user_id, today)
    goals = [{**goal, "saved_in_period": in_period.get(goal["id"], ZERO)} for goal in overview["goals"]]
    deposits = withdrawals = ZERO
    for dep, wd in _contributions_by_month(db, user_id, period.start, period.end).values():
        deposits += dep
        withdrawals += wd
    return {
        "currency": _currency(),
        "period": period.as_dict(),
        "totals": {
            "deposits": deposits,
            "withdrawals": withdrawals,
            "net": deposits - withdrawals,
            "total_saved": overview["total_saved"],
            "total_target": overview["total_target"],
            "progress_percent": overview["progress_percent"] if overview["goals"] else None,
            "goals": len(goals),
            "completed_goals": sum(1 for g in goals if g["completed"]),
        },
        "months": months,
        "goals": goals,
    }


# --- Bills ---------------------------------------------------------------------------------------------------------------

# How many times each frequency occurs per year (weekly uses 52: an average, labelled as such).
CYCLES_PER_YEAR = {BillFrequency.WEEKLY: 52, BillFrequency.MONTHLY: 12, BillFrequency.QUARTERLY: 4, BillFrequency.YEARLY: 1}


def bills_report(db: Session, user_id: uuid.UUID, period: ReportPeriod, today: date, category: str | None = None) -> dict[str, Any]:
    payment_stmt = (
        select(BillPayment, Bill)
        .join(Bill, BillPayment.bill_id == Bill.id)
        .where(BillPayment.user_id == user_id, BillPayment.paid_on >= period.start, BillPayment.paid_on <= period.end)
        .order_by(BillPayment.paid_on.desc(), Bill.name)
    )
    if category:
        payment_stmt = payment_stmt.where(Bill.category == category)
    payments = db.execute(payment_stmt).all()
    paid_total = sum((p.amount for p, _ in payments), ZERO)

    by_bill: dict[uuid.UUID, dict[str, Any]] = {}
    for payment, bill in payments:
        row = by_bill.setdefault(bill.id, {"bill_id": bill.id, "name": bill.name, "category": bill.category, "count": 0, "total": ZERO})
        row["count"] += 1
        row["total"] += payment.amount
    by_category: dict[str, Decimal] = {}
    for payment, bill in payments:
        by_category[bill.category] = by_category.get(bill.category, ZERO) + payment.amount

    paid_month = func.to_char(BillPayment.paid_on, "YYYY-MM")
    trend_stmt = (
        select(paid_month, func.sum(BillPayment.amount))
        .join(Bill, BillPayment.bill_id == Bill.id)
        .where(BillPayment.user_id == user_id, BillPayment.paid_on >= period.trend_start, BillPayment.paid_on <= period.end)
        .group_by(paid_month)
    )
    if category:
        trend_stmt = trend_stmt.where(Bill.category == category)
    paid_by_month = dict(db.execute(trend_stmt).all())

    bills = bill_service.list_bills(db, user_id, today, category=category)
    overdue = [b for b in bills if b["status"] == "overdue"]
    pending = [b for b in bills if b["status"] == "pending" and period.start <= b["due_date"] <= period.end]

    def brief(b: dict[str, Any]) -> dict[str, Any]:
        return {k: b[k] for k in ("id", "name", "category", "amount", "due_date", "frequency", "days_until_due")}

    # Recurring commitments: active (not one-time) bills, per cycle and as averages.
    recurring = [b for b in bills if b["frequency"] != BillFrequency.ONE_TIME]
    by_frequency = []
    yearly = ZERO
    for frequency, cycles in CYCLES_PER_YEAR.items():
        group = [b for b in recurring if b["frequency"] == frequency]
        if not group:
            continue
        per_cycle = sum((b["amount"] for b in group), ZERO)
        yearly += per_cycle * cycles
        by_frequency.append({"frequency": frequency, "count": len(group), "per_cycle": per_cycle, "per_year": per_cycle * cycles})

    return {
        "currency": _currency(),
        "period": period.as_dict(),
        "category": category,
        "today": today,
        "paid": {
            "total": paid_total,
            "count": len(payments),
            "by_bill": sorted(by_bill.values(), key=lambda r: (-r["total"], r["name"].lower())),
            "by_category": [{"category": c, "total": t} for c, t in sorted(by_category.items(), key=lambda kv: -kv[1])],
        },
        "pending": {"total": sum((b["amount"] for b in pending), ZERO), "count": len(pending), "items": [brief(b) for b in pending][:MAX_LIST]},
        "overdue": {"total": sum((b["amount"] for b in overdue), ZERO), "count": len(overdue), "items": [brief(b) for b in overdue][:MAX_LIST]},
        "recurring": {
            "count": len(recurring),
            "by_frequency": by_frequency,
            "yearly_total": yearly,
            "monthly_average": (yearly / 12).quantize(CENT, rounding=ROUND_HALF_UP),
        },
        "monthly_paid": [{"month": m, "amount": paid_by_month.get(m, ZERO)} for m in period.trend_months],
    }


# --- CSV export -------------------------------------------------------------------------------------------------------------

_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _cell(value: Any) -> str:
    """Text cells that a spreadsheet could run as a formula are prefixed with a quote (CSV injection)."""
    if value is None:
        return ""
    if isinstance(value, Decimal):
        return format(value, "f")  # amounts are already exact (2 dp), percentages 1 dp
    text = str(value)
    return "'" + text if text.startswith(_FORMULA_PREFIXES) else text


def to_csv(header: list[str], rows: list[list[Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(header)
    for row in rows:
        writer.writerow([_cell(v) for v in row])
    # BOM so Excel opens Nepali and other non-ASCII text correctly.
    return "﻿" + buffer.getvalue()


def export_csv(db: Session, user_id: uuid.UUID, report: str, period: ReportPeriod, today: date, *, category_id=None, bill_category=None) -> str:
    if report == "finance":
        data = finance_report(db, user_id, period, today)
        return to_csv(
            ["Month", "Income", "Expenses", "Net (income − expenses)", "Net added to savings", "Closing balance"],
            [[m["month"], m["income"], m["expenses"], m["net"], m["savings"], m["balance"]] for m in data["months"]],
        )
    if report == "expenses":
        stmt = expense_query(user_id, period.start, period.end, category_id).order_by(Expense.date, Expense.created_at)
        return to_csv(
            ["Date", "Category", "Description", "Amount", "Currency", "Payment method", "Recurring", "Interval"],
            [
                [e.date.isoformat(), e.category.name, e.description, e.amount, e.currency, e.payment_method, "yes" if e.is_recurring else "no", e.recurrence_interval]
                for e in db.scalars(stmt)
            ],
        )
    if report == "budget":
        rows = []
        for month in period.months:
            for r in budget_service.budget_month(db, user_id, month)["budgets"]:
                if category_id is None or r["category"].id == category_id:
                    rows.append([month, r["category"].name, r["amount"], r["spent"], r["remaining"], r["percent_used"], r["status"]])
        return to_csv(["Month", "Category", "Budget", "Spent", "Remaining", "Percent used", "Status"], rows)
    if report == "savings":
        data = savings_report(db, user_id, period, today)
        return to_csv(
            ["Month", "Deposits", "Withdrawals", "Net", "Total saved at month end"],
            [[m["month"], m["deposits"], m["withdrawals"], m["net"], m["total_saved"]] for m in data["months"]],
        )
    if report == "bills":
        stmt = (
            select(BillPayment, Bill)
            .join(Bill, BillPayment.bill_id == Bill.id)
            .where(BillPayment.user_id == user_id, BillPayment.paid_on >= period.start, BillPayment.paid_on <= period.end)
            .order_by(BillPayment.paid_on, Bill.name)
        )
        if bill_category:
            stmt = stmt.where(Bill.category == bill_category)
        return to_csv(
            ["Paid on", "Bill", "Category", "Amount", "Currency", "Due date", "Recorded as expense"],
            [[p.paid_on.isoformat(), b.name, b.category, p.amount, b.currency, p.due_date.isoformat(), "yes" if p.expense_id else "no"] for p, b in db.execute(stmt).all()],
        )
    raise ReportError("Unknown report.", 404)

