from fastapi import APIRouter, Response

from app.api.deps import CurrentUser, DbSession
from app.schemas.dashboard import DashboardSummary
from app.services.dashboard import build_dashboard_summary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def dashboard_summary(user: CurrentUser, db: DbSession, response: Response) -> DashboardSummary:
    """Everything the dashboard needs in one request, scoped to the signed-in user."""
    response.headers["Cache-Control"] = "no-store"  # Personal financial data.
    return build_dashboard_summary(db, user)
