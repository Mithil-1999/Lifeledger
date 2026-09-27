"""Exception handlers that never leak internals or echo submitted values (e.g. passwords)."""

import logging
import traceback

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
        # Log where it happened, but NOT the exception message: database errors embed the SQL
        # parameters (note text, amounts, ciphertext...) in their message. The client only ever
        # sees a generic message.
        frames = "".join(traceback.format_tb(exc.__traceback__))
        logger.error("Unhandled %s on %s %s\n%s", type(exc).__name__, request.method, request.url.path, frames)
        return JSONResponse(status_code=500, content={"detail": "Internal server error."})
