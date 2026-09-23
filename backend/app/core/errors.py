"""Exception handlers that never leak internals or echo submitted values (e.g. passwords)."""

import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("lifevault")


def _clean_validation_errors(exc: RequestValidationError) -> list[dict]:
    cleaned = []
    for error in exc.errors():
        message = str(error.get("msg", "Invalid value"))
        message = message.removeprefix("Value error, ")
        # Drop "input"/"ctx": they would echo request bodies (including passwords) back.
        cleaned.append({"loc": list(error.get("loc", [])), "msg": message, "type": error.get("type")})
    return cleaned


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "Validation failed.", "errors": _clean_validation_errors(exc)},
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        # The traceback is logged server-side (it contains no local variable values);
        # the client only ever sees a generic message.
        logger.error("Unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path, exc_info=exc)
        return JSONResponse(status_code=500, content={"detail": "Internal server error."})
