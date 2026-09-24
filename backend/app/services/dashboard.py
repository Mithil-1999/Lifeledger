"""Builds the dashboard summary for a user.

Phase 3 has no finance, task, bill or reminder tables yet, so each section is reported
as unavailable with no values. Each later phase replaces its `_…_section` builder with
real queries scoped to `user.id`; the response contract stays the same.
"""

import calendar
from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import User
from app.schemas.dashboard import (
    BillsSummary,
    ChartsData,
    DashboardSummary,
    FinancialSummary,
    Period,
    RemindersSummary,
    TasksSummary,
)

# Phase in which each dashboard section starts reporting real data.
FINANCE_PHASE = 4
TASKS_PHASE = 6
BILLS_PHASE = 5
REMINDERS_PHASE = 6


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


def _finance_section() -> FinancialSummary:
    return FinancialSummary(
        available=False,
        available_from_phase=FINANCE_PHASE,
        monthly_income=None,
        monthly_expenses=None,
        current_balance=None,
        savings=None,
        budget_remaining=None,
    )


def _tasks_section() -> TasksSummary:
    return TasksSummary(available=False, available_from_phase=TASKS_PHASE, today=[], pending=[], overdue=[])


def _bills_section() -> BillsSummary:
    return BillsSummary(available=False, available_from_phase=BILLS_PHASE, upcoming=[], overdue=[])


def _reminders_section() -> RemindersSummary:
    return RemindersSummary(available=False, available_from_phase=REMINDERS_PHASE, upcoming=[])


def _charts_section() -> ChartsData:
    return ChartsData(
        available=False,
        available_from_phase=FINANCE_PHASE,
        income_vs_expenses=[],
        expense_categories=[],
        monthly_spending=[],
        savings=[],
    )


def build_dashboard_summary(db: Session, user: User, now: datetime | None = None) -> DashboardSummary:
    # `db` and `user` are unused until the feature tables exist; every future query
    # must filter by user.id.
    del db, user
    return DashboardSummary(
        currency=get_settings().default_currency,
        period=current_period(now),
        generated_at=datetime.now(UTC),
        finance=_finance_section(),
        tasks=_tasks_section(),
        bills=_bills_section(),
        reminders=_reminders_section(),
        charts=_charts_section(),
    )
