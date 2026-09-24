"""Builds the dashboard summary for a user.

Income, expenses, balance, budgets, savings and bills come from the user's real records.
Tasks and reminders (Phase 6) are reported as unavailable, with no values, until those
modules exist. The response contract stays the same.
"""

import calendar
from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Expense, Income, User
from app.schemas.common import Money
from app.schemas.dashboard import (
    BillItem,
    BillsSummary,
    CategoryPoint,
    ChartsData,
    DashboardSummary,
    FinancialSummary,
    MonthlyPoint,
    Period,
    RemindersSummary,
    TasksSummary,
)
from app.services import bills as bill_service
from app.services import budgets as budget_service
from app.services import ledger
from app.services import savings as savings_service

# Phase in which each not-yet-built part starts reporting real data.
TASKS_PHASE = 6
REMINDERS_PHASE = 6

TREND_MONTHS = 6


def current_period(now: datetime | None = None) -> Period:
    settings = get_settings()
    local_now = (now or datetime.now(UTC)).astimezone(settings.timezone)
    today = local_now.date()
    last_day = calendar.monthrange(today.year, today.month)[1]
    return Period(
        label=today.strftime("%B %Y"),
        start=date(today.year, today.month, 1),
        end=date(today.year, today.month, last_day),
        today=today,
        timezone=settings.app_timezone,
    )


def _finance_section(db: Session, user: User, period: Period, currency: str) -> FinancialSummary:
    income = ledger.sum_between(db, Income, user.id, period.start, period.end)
    expenses = ledger.sum_between(db, Expense, user.id, period.start, period.end)
    # Balance = everything earned minus everything spent, up to today (future-dated entries excluded).
    balance = ledger.sum_between(db, Income, user.id, None, period.today) - ledger.sum_between(
        db, Expense, user.id, None, period.today
    )
    saved, goal_count = savings_service.total_saved(db, user.id)
    budgets = budget_service.budget_month(db, user.id, period.start.strftime("%Y-%m"))
    not_configured = []
    if goal_count == 0:
        not_configured.append("savings")
    if not budgets["budgets"]:
        not_configured.append("budget_remaining")
    return FinancialSummary(
        available=True,
        available_from_phase=None,
        monthly_income=Money(amount=income, currency=currency),
        monthly_expenses=Money(amount=expenses, currency=currency),
        current_balance=Money(amount=balance, currency=currency),
        # No goals / no budgets this month -> null (UI invites you to set them up), not a fake 0.
        savings=Money(amount=saved, currency=currency) if goal_count else None,
        budget_remaining=Money(amount=budgets["total_remaining"], currency=currency) if budgets["budgets"] else None,
        not_configured=not_configured,
    )


def _charts_section(db: Session, user: User, period: Period) -> ChartsData:
    this_month = period.start.strftime("%Y-%m")
    months = [ledger.shift_month(this_month, -offset) for offset in range(TREND_MONTHS - 1, -1, -1)]
    window_start = ledger.month_bounds(months[0])[0]

    income_by_month = ledger.monthly_totals(db, Income, user.id, window_start, period.end)
    expense_by_month = ledger.monthly_totals(db, Expense, user.id, window_start, period.end)
    has_trend_data = bool(income_by_month or expense_by_month)

    def total(by_month: dict, month: str):
        return by_month.get(month, (ledger.ZERO, 0))[0]

    income_vs_expenses = (
        [MonthlyPoint(month=m, income=total(income_by_month, m), expenses=total(expense_by_month, m)) for m in months]
        if has_trend_data
        else []
    )
    monthly_spending = (
        [MonthlyPoint(month=m, expenses=total(expense_by_month, m)) for m in months] if expense_by_month else []
    )
    categories = [
        CategoryPoint(category=name, amount=amount)
        for _, name, amount, _ in ledger.category_totals(db, Expense, user.id, period.start, period.end)
    ]
    history = savings_service.balance_history(db, user.id, months)
    savings = [MonthlyPoint(month=m, savings=total_saved) for m, total_saved in history] if any(v for _, v in history) else []
    return ChartsData(
        available=True,
        available_from_phase=None,
        income_vs_expenses=income_vs_expenses,
        expense_categories=categories,
        monthly_spending=monthly_spending,
        savings=savings,
    )


def _tasks_section() -> TasksSummary:
    return TasksSummary(available=False, available_from_phase=TASKS_PHASE, today=[], pending=[], overdue=[])


DASHBOARD_LIST_LIMIT = 5


def _bills_section(db: Session, user: User, period: Period, currency: str) -> BillsSummary:
    bills = bill_service.list_bills(db, user.id, period.today)

    def item(bill: dict) -> BillItem:
        return BillItem(id=bill["id"], name=bill["name"], amount=Money(amount=bill["amount"], currency=currency), due_date=bill["due_date"])

    overdue = [b for b in bills if b["status"] == "overdue"]
    upcoming = [b for b in bills if b["status"] == "pending" and b["days_until_due"] <= bill_service.DUE_SOON_DAYS]
    return BillsSummary(
        available=True,
        available_from_phase=None,
        upcoming=[item(b) for b in upcoming[:DASHBOARD_LIST_LIMIT]],
        overdue=[item(b) for b in overdue[:DASHBOARD_LIST_LIMIT]],
    )


def _reminders_section() -> RemindersSummary:
    return RemindersSummary(available=False, available_from_phase=REMINDERS_PHASE, upcoming=[])


def build_dashboard_summary(db: Session, user: User, now: datetime | None = None) -> DashboardSummary:
    currency = get_settings().default_currency
    period = current_period(now)
    return DashboardSummary(
        currency=currency,
        period=period,
        generated_at=datetime.now(UTC),
        finance=_finance_section(db, user, period, currency),
        tasks=_tasks_section(),
        bills=_bills_section(db, user, period, currency),
        reminders=_reminders_section(),
        charts=_charts_section(db, user, period),
    )
