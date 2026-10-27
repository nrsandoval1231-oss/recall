"""Protected v1 local-vault text, photo and audio-transcript organization routes."""

from __future__ import annotations

from functools import partial

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ..errors import payload_too_large, validation
from ..ingestion.local_organization import LocalOrganizationService, parse_binding

MAX_PHOTO_BYTES = 25 * 1024 * 1024
MAX_TEXT_BYTES = 120_000


def register_routes(app: FastAPI, service: LocalOrganizationService) -> None:
    async def read_capability(request: Request, *, audio: bool) -> JSONResponse:
        authorization = request.headers.get("authorization")
        grant = await run_in_threadpool(service.authorize, authorization)
        result = await run_in_threadpool(partial(service.capability, grant, audio=audio))
        await run_in_threadpool(service.authorize, authorization, grant)
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    async def write_consent(request: Request, *, audio: bool) -> JSONResponse:
        authorization = request.headers.get("authorization")
        grant = await run_in_threadpool(service.authorize, authorization)
        if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise validation("Organization consent must use application/json.")
        declared = request.headers.get("content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > 1024):
            raise payload_too_large("Organization consent request is too large.")
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > 1024:
                raise payload_too_large("Organization consent request is too large.")
            raw.extend(chunk)
        body = service.parse_consent(bytes(raw))
        result = await run_in_threadpool(partial(service.set_consent, authorization, grant, body, audio=audio))
        await run_in_threadpool(service.authorize, authorization, grant)
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    @app.get("/v1/local-intelligence/organization-capability")
    async def capability(request: Request) -> JSONResponse:
        return await read_capability(request, audio=False)

    @app.post("/v1/local-intelligence/organization-consent")
    async def set_consent(request: Request) -> JSONResponse:
        return await write_consent(request, audio=False)

    @app.get("/v1/local-intelligence/audio-organization-capability")
    async def audio_capability(request: Request) -> JSONResponse:
        return await read_capability(request, audio=True)

    @app.post("/v1/local-intelligence/audio-organization-consent")
    async def set_audio_consent(request: Request) -> JSONResponse:
        return await write_consent(request, audio=True)

    @app.post("/v1/local-intelligence/organizations")
    async def organize(request: Request) -> JSONResponse:
        authorization = request.headers.get("authorization")
        grant = await run_in_threadpool(service.authorize, authorization)
        binding_text = request.headers.get("x-recall-organization", "")
        binding = parse_binding(binding_text)
        await run_in_threadpool(
            partial(service.require_consent, grant, binding["consent_epoch"], audio=binding["schema_version"] == "3.0")
        )
        media_type = request.headers.get("content-type", "").strip().lower()
        limit = MAX_TEXT_BYTES if media_type == "text/plain; charset=utf-8" else MAX_PHOTO_BYTES
        declared = request.headers.get("content-length")
        if declared is not None:
            if not declared.isdigit():
                raise validation("Invalid Content-Length.")
            if int(declared) > limit:
                raise payload_too_large("Organization input is too large.")
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > limit:
                raise payload_too_large("Organization input is too large.")
            raw.extend(chunk)
        result = await run_in_threadpool(service.organize, authorization, grant, binding, bytes(raw), media_type)
        await run_in_threadpool(service.authorize, authorization, grant)
        return JSONResponse(
            result,
            status_code=202 if result["state"] in ("in_flight", "unknown") else 200,
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/v1/local-intelligence/organizations/{operation_id}")
    async def recover(operation_id: str, request: Request) -> JSONResponse:
        authorization = request.headers.get("authorization")
        grant = await run_in_threadpool(service.authorize, authorization)
        result = await run_in_threadpool(service.recover, grant, operation_id)
        await run_in_threadpool(service.authorize, authorization, grant)
        return JSONResponse(
            result,
            status_code=202 if result["state"] in ("in_flight", "unknown") else 200,
            headers={"Cache-Control": "no-store"},
        )
