"""Builds the dashboard summary for a user.

Every section comes from the user's real records: income, expenses, balance, budgets,
savings, bills, tasks and reminders. Nothing is estimated or invented; figures that aren't
set up (no budgets, no savings goals) are reported as such instead of as zero.
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
    ReminderItem,
    RemindersSummary,
    TaskItem,
    TasksSummary,
)
from app.services import bills as bill_service
from app.services import budgets as budget_service
from app.services import ledger
from app.services import reminders as reminder_service
from app.services import savings as savings_service
from app.services import tasks as task_service

TREND_MONTHS = 6
DASHBOARD_LIST_LIMIT = 5  # items per dashboard list (full counts are reported separately)


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


def _task_item(task: dict) -> TaskItem:
    return TaskItem(
        id=task["id"],
        title=task["title"],
        due_date=task["due_date"],
        due_time=task["due_time"],
        priority=task["priority"],
        status=task["status"],
    )


def _tasks_section(db: Session, user: User, now: datetime) -> TasksSummary:
    local = task_service.local_now(now)
    today = task_service.list_tasks(db, user.id, "today", now=local)
    overdue = task_service.list_tasks(db, user.id, "overdue", now=local)
    pending = task_service.pending_tasks(db, user.id, now=local)
    # "Pending" = Not Started and not overdue (overdue ones are shown under Overdue).
    not_started = pending["due_soon"] + pending["not_started"]
    return TasksSummary(
        available=True,
        available_from_phase=None,
        today=[_task_item(t) for t in today["items"][:DASHBOARD_LIST_LIMIT]],
        pending=[_task_item(t) for t in not_started[:DASHBOARD_LIST_LIMIT]],
        overdue=[_task_item(t) for t in overdue["items"][:DASHBOARD_LIST_LIMIT]],
        counts={"today": len(today["items"]), "pending": len(not_started), "overdue": len(overdue["items"])},
    )


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


def _reminders_section(db: Session, user: User, now: datetime) -> RemindersSummary:
    active = reminder_service.list_reminders(db, user.id, "due", now=now)["items"] + reminder_service.list_reminders(
        db, user.id, "upcoming", now=now
    )["items"]
    return RemindersSummary(
        available=True,
        available_from_phase=None,
        upcoming=[
            ReminderItem(id=r["id"], title=r["title"], remind_at=r["effective_at"], is_due=r["is_due"])
            for r in active[:DASHBOARD_LIST_LIMIT]
        ],
        due_count=sum(1 for r in active if r["is_due"]),
    )


def build_dashboard_summary(db: Session, user: User, now: datetime | None = None) -> DashboardSummary:
    currency = get_settings().default_currency
    moment = now or datetime.now(UTC)
    period = current_period(moment)
    return DashboardSummary(
        currency=currency,
        period=period,
        generated_at=datetime.now(UTC),
        finance=_finance_section(db, user, period, currency),
        tasks=_tasks_section(db, user, moment),
        bills=_bills_section(db, user, period, currency),
        reminders=_reminders_section(db, user, moment),
        charts=_charts_section(db, user, period),
    )
