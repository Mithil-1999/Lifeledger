"""Financial reports and CSV exports. All routes require a signed-in user and only read that user's data."""

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.api.deps import CurrentUser, DbSession
from app.models import BillCategory
from app.schemas.planning import _check_year_month
from app.schemas.reports import BillsReport, BudgetReport, ExpenseReport, FinanceReport, SavingsReport
from app.services import reports as report_service
from app.services.dashboard import current_period

router = APIRouter(prefix="/reports", tags=["reports"])


@dataclass
class PeriodQuery:
    period: report_service.ReportPeriod
    today: date


def period_query(
    year: Annotated[int | None, Query(ge=2000, le=2100)] = None,
    month: Annotated[str | None, Query(description="YYYY-MM")] = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> PeriodQuery:
    """Custom dates win over month, month over year; with nothing, the current month (APP_TIMEZONE)."""
    today = current_period().today
    try:
        if month is not None:
            _check_year_month(month)
        return PeriodQuery(report_service.resolve_period(today, year=year, month=month, date_from=date_from, date_to=date_to), today)
    except (ValueError, report_service.ReportError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


Period = Annotated[PeriodQuery, Depends(period_query)]


@router.get("/finance", response_model=FinanceReport)
def finance_report(user: CurrentUser, db: DbSession, q: Period) -> Any:
    return report_service.finance_report(db, user.id, q.period, q.today)


@router.get("/expenses", response_model=ExpenseReport)
def expense_report(user: CurrentUser, db: DbSession, q: Period, category_id: uuid.UUID | None = None) -> Any:
    return report_service.expense_report(db, user.id, q.period, category_id)


@router.get("/budget", response_model=BudgetReport)
def budget_report(user: CurrentUser, db: DbSession, q: Period, category_id: uuid.UUID | None = None) -> Any:
    return report_service.budget_report(db, user.id, q.period, category_id)


@router.get("/savings", response_model=SavingsReport)
def savings_report(user: CurrentUser, db: DbSession, q: Period) -> Any:
    return report_service.savings_report(db, user.id, q.period, q.today)


@router.get("/bills", response_model=BillsReport)
def bills_report(user: CurrentUser, db: DbSession, q: Period, category: BillCategory | None = None) -> Any:
    return report_service.bills_report(db, user.id, q.period, q.today, category.value if category else None)


@router.get("/{report}/export.csv", response_class=Response)
def export_csv(
    report: Literal["finance", "expenses", "budget", "savings", "bills"],
    user: CurrentUser,
    db: DbSession,
    q: Period,
    category_id: uuid.UUID | None = None,
    category: BillCategory | None = None,
) -> Response:
    content = report_service.export_csv(
        db, user.id, report, q.period, q.today, category_id=category_id, bill_category=category.value if category else None
    )
    filename = f"lifevault-{report}-{q.period.start.isoformat()}-to-{q.period.end.isoformat()}.csv"
    return Response(
        content=content.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "private, no-store"},
    )
