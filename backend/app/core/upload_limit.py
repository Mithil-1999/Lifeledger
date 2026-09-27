"""Reject oversized uploads BEFORE the body is read or spooled to disk.

Starlette parses multipart bodies before the endpoint runs, so the size check has to
happen here, from the Content-Length header. Uploads without a length (chunked) are
refused. The endpoint re-checks the real size while reading the file.
"""

from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.responses import JSONResponse

from app.core.config import get_settings

# Profile pictures are small; documents use DOCUMENT_MAX_BYTES.
AVATAR_MAX_BYTES = 2 * 1024 * 1024
# Allowance for multipart boundaries and the metadata fields.
OVERHEAD_BYTES = 64 * 1024


def _limit_for(path: str) -> int | None:
    path = path.rstrip("/")
    if path == "/api/documents":
        return get_settings().document_max_bytes
    if path == "/api/account/avatar":
        return AVATAR_MAX_BYTES
    return None


class UploadSizeLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        max_bytes = _limit_for(scope["path"]) if scope["type"] == "http" and scope["method"] == "POST" else None
        if max_bytes is not None:
            headers = dict(scope["headers"])
            length = headers.get(b"content-length")
            if length is None:
                await JSONResponse({"detail": "Upload size must be known (Content-Length required)."}, status_code=411)(scope, receive, send)
                return
            if not length.isdigit() or int(length) > max_bytes + OVERHEAD_BYTES:
                await JSONResponse({"detail": f"File is too large. The limit is {max_bytes / (1024 * 1024):g} MB."}, status_code=413)(scope, receive, send)
                return
        await self.app(scope, receive, send)
