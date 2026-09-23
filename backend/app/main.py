from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.router import api_router
from app.core.config import get_settings
from app.core.security_headers import SecurityHeadersMiddleware


def create_app() -> FastAPI:
    settings = get_settings()
    is_production = settings.environment == "production"

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        debug=settings.debug,
        # Interactive docs are disabled in production to reduce the exposed surface.
        docs_url=None if is_production else "/api/docs",
        redoc_url=None if is_production else "/api/redoc",
        openapi_url=None if is_production else "/api/openapi.json",
    )

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Requested-With", "X-CSRF-Token"],
    )

    app.include_router(api_router)
    return app


app = create_app()
