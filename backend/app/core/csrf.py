"""CSRF protection using the double-submit token pattern.

Authentication uses an HttpOnly session cookie, so any state-changing request must also
prove it came from our own frontend: the client reads a token from GET /api/auth/csrf
(also set as a cookie) and echoes it in the X-CSRF-Token header. A cross-site attacker
can make the browser send cookies but cannot read the token to set the header.
SameSite=Lax cookies are a second layer of defense.
"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import get_settings
from app.core.security import tokens_equal

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})
CSRF_HEADER = "X-CSRF-Token"


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method not in SAFE_METHODS and request.url.path.startswith("/api/"):
            cookie = request.cookies.get(get_settings().csrf_cookie_name, "")
            header = request.headers.get(CSRF_HEADER, "")
            if not cookie or not header or not tokens_equal(cookie, header):
                return JSONResponse(status_code=403, content={"detail": "CSRF token missing or invalid."})
        return await call_next(request)
