"""Protected v1 local-vault Ask wire routes."""

from __future__ import annotations

import json

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ..errors import payload_too_large, validation
from ..ingestion.local_intelligence import LocalIntelligenceService, _object, _valid_unicode, parse_request


def register_routes(app: FastAPI, service: LocalIntelligenceService) -> None:
    @app.get("/v1/local-intelligence/capability")
    async def capability(request: Request) -> JSONResponse:
        authorization = request.headers.get("authorization")
        grant = await run_in_threadpool(service.authorize, authorization)
        result = await run_in_threadpool(service.capability, grant)
        await run_in_threadpool(service.authorize, authorization, grant)
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    @app.get("/v1/local-intelligence/history-capability")
    async def history_capability(request: Request) -> JSONResponse:
        authorization = request.headers.get("authorization")
        grant = await run_in_threadpool(service.authorize, authorization)
        result = await run_in_threadpool(service.history_capability, grant)
        await run_in_threadpool(service.authorize, authorization, grant)
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    @app.post("/v1/local-intelligence/ask/consent")
    async def history_consent(request: Request) -> JSONResponse:
        authorization = request.headers.get("authorization")
        grant = await run_in_threadpool(service.authorize, authorization)
        await run_in_threadpool(service.require_history_consent_owner, grant)
        if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise validation("Consent requests must use application/json.")
        declared = request.headers.get("content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > 4096):
            raise payload_too_large("Consent request is too large.")
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > 4096:
                raise payload_too_large("Consent request is too large.")
            raw.extend(chunk)
        try:
            body = json.loads(bytes(raw).decode("utf-8"), object_pairs_hook=_object)
            _valid_unicode(body)
        except (UnicodeDecodeError, UnicodeEncodeError, ValueError, TypeError):
            raise validation("Consent request must be strict UTF-8 JSON without duplicate keys.") from None
        if (
            not isinstance(body, dict)
            or set(body) != {"enable_history", "expected_version"}
            or type(body["enable_history"]) is not bool
            or type(body["expected_version"]) is not int
            or body["expected_version"] < 0
        ):
            raise validation("Consent request fields are invalid.")
        result = await run_in_threadpool(
            service.set_history_consent,
            grant,
            authorization,
            enable_history=body["enable_history"],
            expected_version=body["expected_version"],
        )
        await run_in_threadpool(service.authorize, authorization, grant)
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    @app.post("/v1/local-intelligence/ask")
    async def ask(request: Request) -> JSONResponse:
        authorization = request.headers.get("authorization")
        # Do not bind a Body parameter here: scope and revocation are checked before receive().
        grant = await run_in_threadpool(service.authorize, authorization)
        if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise validation("Ask requests must use application/json.")
        declared = request.headers.get("content-length")
        if declared is not None:
            if not declared.isdigit():
                raise validation("Invalid Content-Length.")
            if int(declared) > 32 * 1024:
                raise payload_too_large("Ask request is too large.")
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > 32 * 1024:
                raise payload_too_large("Ask request is too large.")
            raw.extend(chunk)
        body, digest = parse_request(bytes(raw))
        result = await run_in_threadpool(service.ask, authorization, grant, body, digest)
        await run_in_threadpool(service.authorize, authorization, grant)
        return JSONResponse(
            result,
            status_code=202 if result["state"] in ("in_flight", "unknown") else 200,
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/v1/local-intelligence/ask/{operation_id}")
    async def recover(operation_id: str, request: Request) -> JSONResponse:
        authorization = request.headers.get("authorization")
        grant = await run_in_threadpool(service.authorize, authorization)
        from ..ingestion.local_intelligence import _canonical_uuid

        if not _canonical_uuid(operation_id):
            raise validation("Ask operation ID is invalid.")
        result = await run_in_threadpool(service.recover, grant, operation_id)
        await run_in_threadpool(service.authorize, authorization, grant)
        return JSONResponse(
            result,
            status_code=202 if result["state"] in ("in_flight", "unknown") else 200,
            headers={"Cache-Control": "no-store"},
        )
