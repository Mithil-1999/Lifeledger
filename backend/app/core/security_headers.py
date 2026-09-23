"""Middleware that adds conservative security headers to every API response."""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    # The API only returns JSON, so nothing should ever be rendered from it.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}

# The interactive docs load their own scripts/styles from a CDN, so they get a relaxed policy.
DOCS_PATHS = ("/api/docs", "/api/redoc", "/api/openapi.json")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        is_docs = request.url.path.startswith(DOCS_PATHS)
        for name, value in SECURITY_HEADERS.items():
            if is_docs and name == "Content-Security-Policy":
                continue
            response.headers.setdefault(name, value)
        return response
