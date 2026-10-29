"""Protected streaming transport. No FastAPI Body parameter: authentication precedes any receive."""

from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ..errors import forbidden, payload_too_large, unsupported_media, validation
from ..ingestion.local_reading import MEDIA_FORMATS, LocalReadingService, parse_binding


def register_routes(app: FastAPI, service: LocalReadingService) -> None:
    @app.post("/v1/local-readings")
    async def read(request: Request) -> JSONResponse:
        authorization = request.headers.get("authorization")
        grant = await run_in_threadpool(service.authorize, authorization)
        binding = parse_binding(request.headers.get("x-recall-reading", ""))
        if binding["vault_id"] != str(grant.vault_id):
            raise forbidden("Device vault scope does not match.")
        media_type = request.headers.get("content-type", "").lower()
        if media_type not in MEDIA_FORMATS:
            raise unsupported_media("A supported selected image type is required.")
        limit = min(service.settings.max_page_bytes, 25 * 1024 * 1024)
        declared = request.headers.get("content-length")
        if declared is not None:
            if not declared.isdigit():
                raise validation("Invalid Content-Length.")
            if int(declared) > limit:
                raise payload_too_large("The selected photo is too large.")
        original = bytearray()
        async for chunk in request.stream():
            if len(original) + len(chunk) > limit:
                raise payload_too_large("The selected photo is too large.")
            original.extend(chunk)
        result = await run_in_threadpool(service.read, authorization, grant, binding, bytes(original), media_type)
        await run_in_threadpool(service.authorize, authorization, grant)
        return JSONResponse(
            result,
            status_code=202 if result["state"] in ("in_flight", "unknown") else 200,
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/v1/local-readings/{operation_id}")
    async def recover(operation_id: uuid.UUID, request: Request) -> JSONResponse:
        authorization = request.headers.get("authorization")
        grant = await run_in_threadpool(service.authorize, authorization)
        result = await run_in_threadpool(service.recover, grant, str(operation_id))
        await run_in_threadpool(service.authorize, authorization, grant)
        return JSONResponse(
            result,
            status_code=202 if result["state"] in ("in_flight", "unknown") else 200,
            headers={"Cache-Control": "no-store"},
        )
