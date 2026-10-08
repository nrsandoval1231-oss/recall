"""DigitalOcean selected-photo service. Exposes only health, pairing and photo-reading routes."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..config import Settings, get_settings
from ..db.database import Database
from ..errors import ApiError
from ..ingestion.local_reading import LocalReadingService
from ..ingestion.provider import Provider
from ..pairing import DatabaseDeviceAuthorizer, pairing_routes
from .app import RequestIdMiddleware
from .local_reading import register_routes as register_local_reading_routes

log = logging.getLogger("recall.inference")
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def create_inference_app(
    settings: Settings | None = None,
    *,
    database: Database | None = None,
    provider: Provider | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    if settings.service_profile != "inference":
        raise RuntimeError("inference app requires RECALL_SERVICE_PROFILE=inference")
    db = database or Database(settings.database_url)
    if provider is None and settings.ai_configured:
        from ..ingestion.anthropic_provider import AnthropicProvider

        assert settings.ai_api_key and settings.ai_model_id
        provider = AnthropicProvider(
            api_key=settings.ai_api_key,
            model_id=settings.ai_model_id,
            effort=settings.ai_effort,
            refusal_fallback=False,
            max_retries=0,
        )
    readings = LocalReadingService(db, settings, DatabaseDeviceAuthorizer(db), provider)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if database is None:
            db.open()
        db.assert_least_privilege()
        await asyncio.to_thread(readings.expire)
        stop = asyncio.Event()

        async def janitor() -> None:
            while not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), timeout=60)
                except TimeoutError:
                    try:
                        await asyncio.to_thread(readings.expire)
                    except Exception:
                        log.error("receipt retention maintenance failed")

        task = asyncio.create_task(janitor())
        try:
            yield
        finally:
            stop.set()
            await task
            if database is None:
                db.close()

    app = FastAPI(
        title="Recall Inference API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(RequestIdMiddleware)

    def error(
        request: Request, code: str, message: str, status: int, retryable: bool, details: dict[str, Any] | None = None
    ) -> JSONResponse:
        payload: dict[str, Any] = {
            "error": {
                "code": code,
                "message": message,
                "retryable": retryable,
                "request_id": getattr(request.state, "request_id", None),
            }
        }
        if details:
            payload["error"]["details"] = details
        return JSONResponse(payload, status_code=status, headers={"Cache-Control": "no-store"})

    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error(request, exc.code, exc.message, exc.status, exc.retryable, exc.details)

    @app.exception_handler(RequestValidationError)
    async def bad_request(request: Request, _: RequestValidationError) -> JSONResponse:
        return error(request, "VALIDATION_ERROR", "The request was not valid.", 422, False)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return error(
            request,
            "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR",
            "Not found." if exc.status_code == 404 else "Request failed.",
            exc.status_code,
            False,
        )

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception) -> JSONResponse:
        log.error(
            "unhandled error request_id=%s type=%s", getattr(request.state, "request_id", "-"), type(exc).__name__
        )
        return error(request, "INTERNAL", "Something went wrong.", 500, True)

    @app.get("/healthz", include_in_schema=False)
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", include_in_schema=False)
    def readyz() -> dict[str, str]:
        with db.pool.connection() as conn:
            conn.execute("select 1")
            conn.rollback()
        return {"status": "ready"}

    pairing_routes(app, db)
    register_local_reading_routes(app, readings)
    return app


def app_factory() -> FastAPI:
    return create_inference_app()
