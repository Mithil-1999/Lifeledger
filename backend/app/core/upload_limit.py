"""Reject oversized uploads BEFORE the body is read or spooled to disk.

Starlette parses multipart bodies before the endpoint runs, so the size check has to
happen here, from the Content-Length header. Uploads without a length (chunked) are
refused. The endpoint re-checks the real size while reading the file.
"""

from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.responses import JSONResponse

from app.core.config import get_settings

UPLOAD_PATHS = ("/api/documents",)
# Allowance for multipart boundaries and the metadata fields.
OVERHEAD_BYTES = 64 * 1024


class UploadSizeLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] == "POST" and scope["path"].rstrip("/") in UPLOAD_PATHS:
            headers = dict(scope["headers"])
            length = headers.get(b"content-length")
            limit = get_settings().document_max_bytes + OVERHEAD_BYTES
            if length is None:
                await JSONResponse({"detail": "Upload size must be known (Content-Length required)."}, status_code=411)(scope, receive, send)
                return
            if not length.isdigit() or int(length) > limit:
                mb = get_settings().document_max_bytes / (1024 * 1024)
                await JSONResponse({"detail": f"File is too large. The limit is {mb:g} MB."}, status_code=413)(scope, receive, send)
                return
        await self.app(scope, receive, send)
