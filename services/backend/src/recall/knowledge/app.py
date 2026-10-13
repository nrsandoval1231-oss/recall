from __future__ import annotations

import asyncio
import hmac
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .graph import GraphAdapter, GraphCapacityError, GraphIndexMissing
from .models import MAX_SNAPSHOT, SearchRequest, SearchResponse, Snapshot, Status
from .store import SnapshotStore, StaleGeneration


class BodyLimitMiddleware:
    """Bound the ASGI body before JSON decoding; private source text is never echoed."""

    def __init__(self, app: Any, limit: int = MAX_SNAPSHOT) -> None:
        self.app = app
        self.limit = limit

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        size = headers.get(b"content-length")
        if size:
            try:
                if int(size) > self.limit:
                    await self._too_large(send)
                    return
            except ValueError:
                await self._too_large(send)
                return
        chunks: list[bytes] = []
        length = 0
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            length += len(chunk)
            if length > self.limit:
                await self._too_large(send)
                return
            chunks.append(chunk)
            more = message.get("more_body", False)
        body = b"".join(chunks)
        sent = False

        async def replay() -> dict[str, Any]:
            nonlocal sent
            if sent:
                return {"type": "http.request", "body": b"", "more_body": False}
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay, send)

    @staticmethod
    async def _too_large(send: Any) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")],
            }
        )
        await send({"type": "http.response.body", "body": b'{"detail":"Request exceeds service limit."}'})


class ScopeMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        client = scope.get("client")
        remote = client[0] if client else ""
        host = headers.get(b"host", b"").decode("latin-1").lower()
        origin = headers.get(b"origin")
        fetch_site = headers.get(b"sec-fetch-site", b"").lower()
        allowed_host = host == "127.0.0.1" or host.startswith("127.0.0.1:")
        if (
            remote not in {"127.0.0.1", "::1", "testclient"}
            or not allowed_host
            or origin
            or fetch_site in {b"cross-site", b"same-site"}
        ):
            await send(
                {
                    "type": "http.response.start",
                    "status": 403,
                    "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")],
                }
            )
            await send({"type": "http.response.body", "body": b'{"detail":"Local requests only."}'})
            return
        await self.app(scope, receive, send)


def create_app(
    *,
    store: SnapshotStore | None = None,
    adapter: Any | None = None,
    token: str | None = None,
    db_path: str | Path | None = None,
) -> FastAPI:
    auth_token = token if token is not None else os.environ.get("RECALL_GRAPH_TOKEN", "")
    if len(auth_token.encode("utf-8")) < 32:
        raise RuntimeError("RECALL_GRAPH_TOKEN must contain at least 32 bytes.")
    if db_path is None:
        configured = os.environ.get("RECALL_GRAPH_DB_PATH")
        if not configured:
            raise RuntimeError("RECALL_GRAPH_DB_PATH must name a persistent local Graphiti database file.")
        db_path = configured
    requested_path = Path(db_path).expanduser()
    if not requested_path.is_absolute():
        raise RuntimeError("Graphiti database path must be absolute.")
    path = requested_path.resolve()
    repo_root = Path(__file__).resolve().parents[5]
    if path == repo_root or repo_root in path.parents:
        raise RuntimeError("Graphiti database must be stored outside the repository.")
    queue_store = store or SnapshotStore(path.with_suffix(path.suffix + ".queue.sqlite"))
    graph = adapter or GraphAdapter(path)
    active_jobs: dict[str, tuple[int, asyncio.Task[None]]] = {}

    async def process_job(snapshot: Snapshot, generation: int, kind: str, work_ids: set[str]) -> None:
        try:
            if kind == "append" and hasattr(graph, "append"):
                selected = [s for s in snapshot.sources if s.id in work_ids]
                await graph.append(snapshot.scope, selected)
            else:
                await graph.rebuild(snapshot)
            if not queue_store.commit(snapshot.scope, generation, snapshot.sources):
                return
        except asyncio.CancelledError:
            # Partial writes are untrusted; the next generation is forced to rebuild.
            raise
        except GraphCapacityError as exc:
            message = (
                "Indexing capacity exceeded; increase service capacity or select fewer sources."
                if "snapshot" in str(exc)
                else "Source exceeds the 32 KiB indexing limit; no sources were silently skipped."
            )
            queue_store.failed(snapshot.scope, generation, message)
        except Exception:
            # Do not echo provider errors, paths, or source content into status/logs.
            queue_store.failed(snapshot.scope, generation, "Indexing failed; review provider configuration and retry.")

    async def process_queue() -> None:
        while True:
            job = queue_store.next_job()
            if job is None:
                await asyncio.sleep(0.25)
                continue
            snapshot, generation, kind, work_ids = job
            operation = asyncio.create_task(process_job(snapshot, generation, kind, work_ids))
            active_jobs[snapshot.scope] = (generation, operation)
            try:
                await operation
            except asyncio.CancelledError:
                worker_task = asyncio.current_task()
                if worker_task is not None and worker_task.cancelling():
                    operation.cancel()
                    await asyncio.gather(operation, return_exceptions=True)
                    raise
                await asyncio.gather(operation, return_exceptions=True)
            finally:
                active_jobs.pop(snapshot.scope, None)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        os.environ["GRAPHITI_TELEMETRY_ENABLED"] = "false"
        task = asyncio.create_task(process_queue(), name="recall-knowledge-worker")
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            close = getattr(graph, "close", None)
            if close:
                await close()

    app = FastAPI(
        title="Recall local knowledge service",
        version="1",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(ScopeMiddleware)
    app.state.store = queue_store
    app.state.graph = graph

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"detail": "Invalid request."}, status_code=422, headers={"Cache-Control": "no-store"})

    def authorize(request: Request) -> None:
        supplied = request.headers.get("authorization", "")
        expected = "Bearer " + auth_token
        if not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
            raise HTTPException(status_code=401, detail="Unauthorized", headers={"Cache-Control": "no-store"})

    @app.get("/v1/health", response_model=Status)
    async def health(request: Request) -> Status:
        authorize(request)
        statuses = [queue_store.status(scope) for scope in queue_store.all_scopes()]
        if not statuses:
            return Status(state="empty", providers=_provider_disclosures())
        pending = sum(s.pending for s in statuses)
        indexed = sum(s.indexed for s in statuses)
        failed = sum(s.failed for s in statuses)
        is_pending = pending > 0 or any(s.state in {"pending", "queued", "processing", "purging"} for s in statuses)
        state = "failed" if failed else "pending" if is_pending else "ready"
        message = "Index processing has failures." if failed else "Index work is pending." if pending else ""
        return Status(
            state=state,
            pending=min(pending, 10_000),
            indexed=min(indexed, 10_000),
            failed=min(failed, 10_000),
            message=message,
            providers=_provider_disclosures(),
        )

    @app.post("/v1/snapshot", response_model=Status)
    async def snapshot(request: Request) -> Status:
        authorize(request)
        try:
            raw = await request.body()
            if len(raw) > MAX_SNAPSHOT:
                raise HTTPException(413, "Request exceeds service limit.")
            value = Snapshot.model_validate_json(raw)
            if len(value.model_dump_json().encode("utf-8")) > MAX_SNAPSHOT:
                raise HTTPException(413, "Request exceeds service limit.")
            status = queue_store.submit(value)
            active = active_jobs.get(value.scope)
            if active is not None and (active[0] != value.generation or value.rebuild):
                # The ledger is fenced before cancelling further source processing.
                active[1].cancel()
            return status
        except StaleGeneration:
            raise HTTPException(409, "Snapshot generation is stale or conflicts with persisted content.") from None
        except ValidationError:
            raise HTTPException(422, "Invalid request.") from None

    @app.post("/v1/search", response_model=SearchResponse)
    async def search(body: SearchRequest, request: Request) -> SearchResponse:
        authorize(request)
        current = queue_store.generation(body.scope)
        if current is None or current[0] != body.generation:
            raise HTTPException(409, "Search generation does not match the current snapshot.")
        status = queue_store.status(body.scope)
        if body.include_history:
            return SearchResponse(
                status=Status(
                    **{
                        **status.model_dump(),
                        "state": "history_unavailable",
                        "message": "Historical graph provenance is unavailable.",
                    }
                ),
                relationships=[],
            )
        if not current[1] or status.state != "ready":
            return SearchResponse(status=status, relationships=[])
        snapshot = current[2]
        if not hasattr(graph, "search"):
            return SearchResponse(status=status, relationships=[])
        sources = queue_store.current_sources(body.scope)
        try:
            relationships = await graph.search(body.scope, body.query, body.limit, sources)
        except GraphIndexMissing:
            rebuilt = queue_store.requeue_rebuild(body.scope, body.generation)
            return SearchResponse(status=rebuilt, relationships=[])
        except Exception:
            return SearchResponse(
                status=Status(
                    **{**status.model_dump(), "state": "unavailable", "message": "Local graph search is unavailable."}
                ),
                relationships=[],
            )
        # A new snapshot can arrive while FalkorDB is serving this query. Never return
        # results from the generation that was fenced during the await.
        latest = queue_store.generation(body.scope)
        if latest is None or latest[0] != body.generation or not latest[1]:
            return SearchResponse(status=queue_store.status(body.scope), relationships=[])
        # Recheck every support against the exact current, consented snapshot.
        eligible = {sid: sources[sid] for sid in snapshot.eligible_ids if sid in sources}
        clean = []
        for rel in relationships:
            if rel.id in snapshot.suppressed_facts:
                continue
            supports_ok = bool(rel.supports) and all(
                (source := eligible.get(sup.source_id)) is not None
                and source.revision == sup.revision
                and source.source_sha256 == sup.source_sha256
                and source.note_sha256 == sup.note_sha256
                and sup.quote == source.text
                for sup in rel.supports
            )
            primary = eligible.get(rel.source_id)
            if (
                supports_ok
                and primary
                and primary.revision == rel.revision
                and rel.quote == primary.text
                and any(s.source_id == rel.source_id and s.quote == rel.quote for s in rel.supports)
            ):
                clean.append(rel)
        return SearchResponse(status=status, relationships=clean[: body.limit])

    return app


def _provider_disclosures() -> dict[str, str]:
    from .providers import provider_disclosures

    return provider_disclosures()
