"""FastAPI transport: authenticate, validate, map errors. Business rules live in `domain`."""

import logging
import re
import tempfile
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import Body, Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from ..config import Settings, get_settings
from ..db.database import Database
from ..domain.captures import CaptureService
from ..domain.manifest import find_schema_path, load_schema, validate_manifest
from ..domain.memories import MemoryService
from ..errors import ApiError, payload_too_large, unauthenticated, unsupported_media, validation
from ..ingestion.provider import Provider
from ..storage import ObjectStore
from ..storage.factory import build_object_store
from .auth import Principal, TokenVerifier

log = logging.getLogger("recall")
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
_IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9._:-]{8,200}$")
READ_CHUNK = 64 * 1024


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Any) -> Any:
        supplied = request.headers.get("x-request-id", "")
        request.state.request_id = supplied if _REQUEST_ID.match(supplied) else uuid.uuid4().hex
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response


def _error_response(
    request: Request, code: str, message: str, status: int, retryable: bool, details: dict[str, Any] | None = None
) -> JSONResponse:
    body: dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable,
            "request_id": getattr(request.state, "request_id", None),
        }
    }
    if details:
        body["error"]["details"] = details
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})


def create_app(
    settings: Settings | None = None,
    *,
    verifier: TokenVerifier | None = None,
    store: ObjectStore | None = None,
    database: Database | None = None,
    provider: Provider | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    schema = load_schema(str(find_schema_path(settings)))
    db = database or Database(settings.database_url)
    object_store = store or build_object_store(settings)
    token_verifier = verifier or TokenVerifier.from_settings(settings)
    service = CaptureService(db, object_store, settings)
    if provider is None and settings.ai_configured:
        from ..ingestion.anthropic_provider import AnthropicProvider

        assert settings.ai_api_key and settings.ai_model_id
        provider = AnthropicProvider(
            api_key=settings.ai_api_key,
            model_id=settings.ai_model_id,
            effort=settings.ai_effort,
            refusal_fallback=settings.ai_refusal_fallback,
        )
    memories = MemoryService(db, settings, provider)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if database is None:
            db.open()
        db.assert_least_privilege()
        object_store.check_ready()
        yield
        if database is None:
            db.close()

    app = FastAPI(title="Recall API", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(RequestIdMiddleware)
    if settings.cors_allow_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_allow_origins,
            allow_methods=["GET", "POST", "PUT"],
            allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
            expose_headers=["X-Request-ID", "X-Recall-Source-SHA256", "ETag"],
            allow_credentials=False,
            max_age=600,
        )

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return _error_response(request, exc.code, exc.message, exc.status, exc.retryable, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _bad_request(request: Request, exc: RequestValidationError) -> JSONResponse:
        return _error_response(request, "VALIDATION_ERROR", "The request was not valid.", 422, False)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        return _error_response(
            request, code, "Not found." if exc.status_code == 404 else "Request failed.", exc.status_code, False
        )

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        # IDs only: never log request bodies, tokens, or content.
        log.error(
            "unhandled error request_id=%s type=%s", getattr(request.state, "request_id", "-"), type(exc).__name__
        )
        return _error_response(request, "INTERNAL", "Something went wrong.", 500, True)

    def principal(authorization: Annotated[str | None, Header()] = None) -> Principal:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise unauthenticated()
        return token_verifier.verify(authorization[7:].strip())

    Auth = Annotated[Principal, Depends(principal)]

    def idempotency_key(key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> str:
        if key is None or not _IDEMPOTENCY_KEY.match(key):
            raise validation("An Idempotency-Key header (8-200 chars: letters, digits, . _ : -) is required.")
        return key

    IdemKey = Annotated[str, Depends(idempotency_key)]

    @app.get("/healthz", include_in_schema=False)
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", include_in_schema=False)
    def readyz() -> dict[str, str]:
        with db.pool.connection() as conn:
            conn.execute("select 1")
        object_store.check_ready()
        return {"status": "ready"}

    @app.get("/v1/me")
    def get_me(who: Auth) -> JSONResponse:
        return _json(service.me(who.user_id, who.email))

    @app.post("/v1/devices")
    def post_device(who: Auth, body: Annotated[Any, Body()]) -> JSONResponse:
        if not isinstance(body, dict):
            raise validation("Body must be an object.")
        device, created = service.register_device(who.user_id, body)
        return _json(device, 201 if created else 200)

    @app.post(
        "/v1/captures",
        openapi_extra={"requestBody": {"required": True, "content": {"application/json": {"schema": schema}}}},
    )
    def post_capture(who: Auth, key: IdemKey, body: Annotated[Any, Body()]) -> JSONResponse:
        manifest = validate_manifest(body, schema, settings)
        view, created = service.create_capture(who.user_id, key, manifest)
        view = {
            **view,
            "upload": {
                "authorization_endpoint": f"/v1/captures/{view['capture_id']}/upload-authorizations",
                "accepted_media_types": ["image/jpeg", "image/png", "image/heic", "image/heif"],
                "max_page_bytes": settings.max_page_bytes,
            },
        }
        return _json(view, 201 if created else 200)

    @app.get("/v1/captures")
    def list_captures(
        who: Auth, limit: Annotated[int, Query(ge=1, le=100)] = 25, cursor: str | None = None
    ) -> JSONResponse:
        return _json(service.list_captures(who.user_id, limit, cursor))

    @app.get("/v1/captures/{capture_id}")
    def get_capture(who: Auth, capture_id: uuid.UUID) -> JSONResponse:
        return _json(service.get_capture(who.user_id, capture_id))

    @app.post("/v1/captures/{capture_id}/upload-authorizations")
    def post_upload_authorizations(
        who: Auth, capture_id: uuid.UUID, body: Annotated[Any, Body()] = None
    ) -> JSONResponse:
        source_ids = None
        if body is not None:
            if not isinstance(body, dict) or set(body) - {"source_ids"}:
                raise validation("Body may only contain source_ids.")
            try:
                # absent key = every pending page; an explicit list (even empty) is honoured as given
                if "source_ids" in body:
                    if not isinstance(body["source_ids"], list):
                        raise ValueError
                    source_ids = [uuid.UUID(str(s)) for s in body["source_ids"]]
            except ValueError:
                raise validation("source_ids must be UUIDs.") from None
        return _json(service.authorize_uploads(who.user_id, capture_id, source_ids))

    @app.put("/v1/uploads/{token}", include_in_schema=False)
    async def put_upload(who: Auth, token: str, request: Request) -> JSONResponse:
        claims = service.verify_upload_claims(who.user_id, token)
        target = await run_in_threadpool(service.prepare_upload, who.user_id, claims)
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != target.media_type:
            raise unsupported_media(f"Content-Type must be {target.media_type}.")
        declared_length = request.headers.get("content-length")
        if declared_length and declared_length.isdigit() and int(declared_length) > target.declared_byte_size:
            raise payload_too_large("The upload is larger than the declared size.")

        import hashlib

        digest = hashlib.sha256()
        size = 0
        with tempfile.NamedTemporaryFile(prefix="recall-upload-", delete=False) as spool:
            spool_path = Path(spool.name)
            try:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > target.declared_byte_size:
                        raise payload_too_large("The upload is larger than the declared size.")
                    digest.update(chunk)
                    spool.write(chunk)
                spool.flush()
            except BaseException:
                spool_path.unlink(missing_ok=True)
                raise
        try:
            result = await run_in_threadpool(
                service.complete_upload, who.user_id, target, spool_path, size, digest.hexdigest()
            )
        finally:
            spool_path.unlink(missing_ok=True)
        return _json(result)

    @app.post("/v1/captures/{capture_id}/finalize")
    def post_finalize(who: Auth, capture_id: uuid.UUID, key: IdemKey, body: Annotated[Any, Body()]) -> JSONResponse:
        return _json(service.finalize(who.user_id, capture_id, key, body))

    @app.get("/v1/sources/{source_id}/content")
    def get_source_content(who: Auth, source_id: uuid.UUID) -> StreamingResponse:
        row, chunks = service.open_source(who.user_id, source_id)
        return StreamingResponse(
            chunks,
            media_type=row["media_type"],
            headers={
                "Content-Length": str(row["received_byte_size"]),
                "ETag": f'"{row["server_sha256"]}"',
                "X-Recall-Source-SHA256": row["server_sha256"],
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": "inline",
                "Cache-Control": "private, no-store",
            },
        )

    # ------------------------------------------------------------------ RCL-002
    @app.get("/v1/settings/ai")
    def get_ai_settings(who: Auth) -> JSONResponse:
        return _json(memories.get_ai_settings(who.user_id))

    @app.put("/v1/settings/ai")
    def put_ai_settings(who: Auth, body: Annotated[Any, Body()]) -> JSONResponse:
        return _json(memories.put_ai_settings(who.user_id, body))

    @app.post("/v1/captures/{capture_id}/retry-processing")
    def post_retry_processing(who: Auth, capture_id: uuid.UUID, key: IdemKey) -> JSONResponse:
        # Naturally idempotent on job state: repeating the request never queues a second job.
        return _json(memories.retry_processing(who.user_id, capture_id, key))

    @app.get("/v1/memories")
    def list_memories(
        who: Auth, limit: Annotated[int, Query(ge=1, le=100)] = 25, cursor: str | None = None
    ) -> JSONResponse:
        return _json(memories.list_memories(who.user_id, limit, cursor))

    @app.get("/v1/memories/{memory_id}")
    def get_memory(who: Auth, memory_id: uuid.UUID) -> JSONResponse:
        return _json(memories.get_memory(who.user_id, memory_id))

    @app.get("/v1/search")
    def get_search(
        who: Auth, q: Annotated[str, Query(max_length=1000)], limit: Annotated[int, Query(ge=1, le=50)] = 20
    ) -> JSONResponse:
        return _json(memories.search(who.user_id, q, limit))

    @app.post("/v1/ask")
    def post_ask(who: Auth, body: Annotated[Any, Body()]) -> JSONResponse:
        return _json(memories.ask(who.user_id, body))

    return app


def _json(payload: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(payload, status_code=status, headers={"Cache-Control": "no-store"})


def app_factory() -> FastAPI:
    """uvicorn entrypoint: `uvicorn recall.api.app:app_factory --factory`."""
    return create_app()
