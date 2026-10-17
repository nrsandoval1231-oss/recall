"""Authenticated native-library HTTP adapter, shared by web/PWA and desktop sync."""

import uuid
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..api.auth import Principal
from ..config import Settings
from ..db.database import Database
from ..domain.enrollment import EnrollmentService
from ..errors import ApiError, unauthenticated, validation
from ..ingestion.provider import Provider
from ..storage import ObjectStore
from .service import LibraryService, Mutation

COOKIE = "megraph_session"


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=4096)


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enrollment_token: str = Field(min_length=20, max_length=150)


class ProcessingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)
    consent: bool
    expected_vault_id: uuid.UUID


def register_routes(
    app: FastAPI,
    db: Database,
    store: ObjectStore,
    settings: Settings,
    enrollment: EnrollmentService,
    principal: Callable[..., Principal],
    provider: Provider | None = None,
) -> None:
    library = LibraryService(db, store, settings, provider)
    who = Annotated[Principal, Depends(principal)]

    def same_origin(request: Request) -> None:
        origin = request.headers.get("origin", "")
        if origin not in settings.site_origins:
            raise ApiError("CSRF_BLOCKED", "Open MeGraph from its configured secure address.", 403)

    @app.post("/v1/session")
    def login(request: Request, body: Login, response: Response) -> dict[str, Any]:
        same_origin(request)
        result = enrollment.redeem(
            body.enrollment_token, device_id=None, user_agent=request.headers.get("user-agent"), client_key=None
        )
        response.set_cookie(
            COOKIE,
            result["session_token"],
            httponly=True,
            secure=settings.env != "development",
            samesite="strict",
            max_age=settings.device_session_ttl_seconds,
            path="/",
        )
        response.headers["Cache-Control"] = "no-store"
        return {key: value for key, value in result.items() if key != "session_token"}

    @app.delete("/v1/session")
    def logout(request: Request, response: Response) -> dict[str, bool]:
        same_origin(request)
        token = request.cookies.get(COOKIE)
        if not token:
            raise unauthenticated()
        enrollment.revoke_bearer(token)
        response.delete_cookie(COOKIE, path="/", secure=settings.env != "development", httponly=True, samesite="strict")
        response.headers["Cache-Control"] = "no-store"
        return {"signed_out": True}

    @app.get("/v1/library/status")
    def status(actor: who) -> dict[str, Any]:
        return library.status(actor.user_id)

    @app.get("/v1/library/memories")
    def memories(actor: who, include_deleted: bool = False) -> list[dict[str, Any]]:
        return library.list(actor.user_id, include_deleted)

    @app.post("/v1/library/mutations")
    async def mutate(request: Request, actor: who) -> dict[str, Any]:
        from starlette.concurrency import run_in_threadpool

        # Bound the stream before JSON decoding (including chunked requests).
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 36 * 1024 * 1024:
                raise ApiError("PAYLOAD_TOO_LARGE", "Upload exceeds the 25 MiB original limit.", 413)
        try:
            body = Mutation.model_validate_json(data)
        except ValidationError:
            raise validation("Invalid memory mutation.") from None
        return await run_in_threadpool(library.mutate, actor.user_id, body)

    @app.get("/v1/library/memories/{memory_id}/source")
    def source(memory_id: uuid.UUID, actor: who) -> Response:
        data, mime, sha = library.source(actor.user_id, memory_id)
        return Response(
            data,
            media_type=mime,
            headers={
                "X-Recall-Source-SHA256": sha,
                "Cache-Control": "no-store",
                "Content-Disposition": "attachment",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/v1/library/memories/{memory_id}/history")
    def history(memory_id: uuid.UUID, actor: who) -> list[dict[str, Any]]:
        return library.history(actor.user_id, memory_id)

    @app.post("/v1/library/ask")
    def ask(body: Question, actor: who) -> dict[str, Any]:
        return library.ask(actor.user_id, body.question)

    @app.post("/v1/library/memories/{memory_id}/processing")
    def process(memory_id: uuid.UUID, body: ProcessingRequest, actor: who) -> dict[str, Any]:
        from .enrichment import request_processing

        if not body.consent:
            raise validation("Explicit source permission is required.")
        return request_processing(library, actor.user_id, memory_id, body.expected_revision, body.expected_vault_id)
