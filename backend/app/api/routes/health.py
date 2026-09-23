from typing import Literal

from fastapi import APIRouter, Response, status
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app import __version__
from app.core.config import get_settings
from app.db.session import check_database_connection

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    version: str
    environment: str
    database: Literal["ok", "unavailable"]


@router.get("/health", response_model=HealthResponse)
async def health(response: Response) -> HealthResponse:
    """Liveness plus database reachability. Returns 503 when PostgreSQL is unreachable."""
    settings = get_settings()
    db_ok = await run_in_threadpool(check_database_connection)
    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthResponse(
        status="ok" if db_ok else "degraded",
        service=settings.app_name,
        version=__version__,
        environment=settings.environment,
        database="ok" if db_ok else "unavailable",
    )
