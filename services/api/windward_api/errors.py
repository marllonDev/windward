"""Typed platform errors and their HTTP representation.

The shell renders unhappy paths as first-class states (ADR-0002), so every
failure the API can produce has a stable machine-readable `code`. The engine's
own message is passed through verbatim rather than being rewritten: Sail is an
upstream dependency and its wording is the honest answer.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class WindwardError(Exception):
    """Base class for errors that map onto the HTTP contract."""

    code = "INTERNAL_ERROR"
    status_code = 500

    def __init__(self, message: str, *, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail or {}

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.detail:
            payload["detail"] = self.detail
        return {"error": payload}


class EngineUnavailableError(WindwardError):
    """The Sail engine is not reachable: dead, restarting, or not yet up."""

    code = "ENGINE_UNAVAILABLE"
    status_code = 503


class QueryFailedError(WindwardError):
    """The engine rejected or failed the statement. The message is Sail's."""

    code = "SQL_ERROR"
    status_code = 400


class QueryTimeoutError(WindwardError):
    """The query exceeded the platform's wall-clock budget."""

    code = "QUERY_TIMEOUT"
    status_code = 504


class InvalidRequestError(WindwardError):
    code = "INVALID_REQUEST"
    status_code = 400


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(WindwardError)
    async def _windward_error(_: Request, exc: WindwardError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_payload())

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        error = InvalidRequestError(
            "The request body is not valid.",
            detail={"errors": jsonable_encoder(exc.errors())},
        )
        return JSONResponse(status_code=error.status_code, content=error.to_payload())
