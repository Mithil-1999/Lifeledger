"""Middleware that adds conservative security headers to every API response."""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import get_settings

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    # The API only returns JSON, so nothing should ever be rendered from it.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}

# Web pages (only when the API also serves the built frontend, see core/static_site.py).
# Same policy as frontend/nginx.conf: scripts only from this site, no inline scripts.
WEB_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self'; manifest-src 'self'; "
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)

# The interactive docs load their own scripts/styles from a CDN, so they get a relaxed policy.
DOCS_PATHS = ("/api/docs", "/api/redoc", "/api/openapi.json")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        path = request.url.path
        is_docs = path.startswith(DOCS_PATHS)
        is_web_page = not path.startswith("/api/") and path != "/api"
        for name, value in SECURITY_HEADERS.items():
            if name == "Content-Security-Policy":
                if is_docs:
                    continue
                if is_web_page:
                    value = WEB_CSP
            response.headers.setdefault(name, value)
        # HSTS only makes sense (and is only honoured) over HTTPS, which COOKIE_SECURE=true implies.
        if get_settings().cookie_secure:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response
