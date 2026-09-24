from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.api.routes import auth, dashboard, finance, health, planning, productivity

api_router = APIRouter(prefix="/api")

# Public routes.
api_router.include_router(health.router)
api_router.include_router(auth.router)

# Every router attached here requires an authenticated, active user.
# Feature modules from later phases (finance, tasks, vault, ...) are included on this router.
protected_router = APIRouter(dependencies=[Depends(get_current_user)])
protected_router.include_router(dashboard.router)
protected_router.include_router(finance.router)
protected_router.include_router(planning.router)
protected_router.include_router(productivity.router)

api_router.include_router(protected_router)
