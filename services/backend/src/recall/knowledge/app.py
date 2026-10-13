from __future__ import annotations

import asyncio
import hmac
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .graph import GraphAdapter, GraphCapacityError, GraphIndexMissing
from .models import (
    MAX_SNAPSHOT,
    AnswerCancelRequest,
    AnswerRequest,
    AnswerResponse,
    SearchRequest,
    SearchResponse,
    Snapshot,
    Status,
)
from .store import (
    AnswerAttemptError,
    AnswerRequestLedgerFull,
    DuplicateAnswerRequest,
    SnapshotStore,
    StaleGeneration,
)

_LOGGER = logging.getLogger(__name__)


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
    answer_client: Any | None = None,
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
    from .providers import configure_budget_path

    configure_budget_path(path.with_suffix(path.suffix + ".budget.sqlite"))
    queue_store = store or SnapshotStore(path.with_suffix(path.suffix + ".queue.sqlite"))
    graph = adapter or GraphAdapter(path)
    active_jobs: dict[str, tuple[int, asyncio.Task[None]]] = {}
    active_answers: dict[str, tuple[str, asyncio.Task[AnswerResponse]]] = {}
    answer_clients: dict[str, Any] = {}
    retired_answer_clients: list[Any] = []
    answer_semaphore = asyncio.Semaphore(2)
    worker_failed = False
    worker_task: asyncio.Task[None] | None = None

    def mark_worker_failed() -> None:
        nonlocal worker_failed
        worker_failed = True

    def worker_failure_status(scope: str | None = None) -> Status:
        try:
            status = (
                queue_store.status(scope)
                if scope is not None
                else Status(state="failed", providers=_provider_disclosures())
            )
            return status.model_copy(
                update={
                    "state": "failed",
                    "failed": max(1, status.failed),
                    "message": "Knowledge worker stopped; restart the local service to resume processing.",
                }
            )
        except Exception:
            return Status(
                state="failed",
                failed=1,
                message="Knowledge worker stopped; restart the local service to resume processing.",
                providers=_provider_disclosures(),
            )

    def answer_client_for(provider_identity: str) -> Any:
        client = answer_clients.get(provider_identity)
        if client is not None:
            return client
        from .providers import configured_clients, configured_extraction_identity

        if configured_extraction_identity() != provider_identity:
            raise RuntimeError("Answer provider disclosure changed before client construction.")
        client, _embedder = configured_clients()
        if configured_extraction_identity() != provider_identity:
            retired_answer_clients.append(client)
            raise RuntimeError("Answer provider disclosure changed during client construction.")
        answer_clients[provider_identity] = client
        return client

    async def process_job(snapshot: Snapshot, generation: int, kind: str, work_ids: set[str]) -> None:
        try:
            if kind == "append" and hasattr(graph, "append"):
                selected = [s for s in snapshot.sources if s.id in work_ids]
                await graph.append(snapshot.scope, selected)
            else:
                await graph.rebuild(snapshot)
            flush = getattr(graph, "flush", None)
            if flush is None:
                raise RuntimeError("Graph adapter cannot confirm durable persistence.")
            await flush()
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
        nonlocal worker_failed
        while True:
            try:
                job = queue_store.next_job()
            except asyncio.CancelledError:
                raise
            except Exception:
                # Queue state and possible prior graph effects are uncertain. Do not replay.
                worker_failed = True
                return
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
            except Exception:
                # A storage failure may have happened after graph mutation. Require restart recovery.
                worker_failed = True
                return
            finally:
                active_jobs.pop(snapshot.scope, None)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        nonlocal worker_task
        os.environ["GRAPHITI_TELEMETRY_ENABLED"] = "false"
        worker_task = asyncio.create_task(process_queue(), name="recall-knowledge-worker")
        try:
            yield
        finally:
            task = worker_task
            if task is not None and not task.done():
                task.cancel()
            if task is not None:
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    mark_worker_failed()
            answer_tasks = [entry[1] for entry in active_answers.values()]
            for answer_task in answer_tasks:
                answer_task.cancel()
            if answer_tasks:
                await asyncio.gather(*answer_tasks, return_exceptions=True)
            closers = []
            for client in [*answer_clients.values(), *retired_answer_clients]:
                close = getattr(client, "aclose", None)
                if close is not None:
                    closers.append(close())
            if closers:
                outcomes = await asyncio.gather(*closers, return_exceptions=True)
                if any(isinstance(result, BaseException) for result in outcomes):
                    _LOGGER.error("Knowledge service provider-client cleanup failed.")
            close = getattr(graph, "close", None)
            if close:
                # Keep shutdown cleanup best-effort and never mask worker status.
                graph_outcomes = await asyncio.gather(close(), return_exceptions=True)
                if any(isinstance(result, BaseException) for result in graph_outcomes):
                    _LOGGER.error("Knowledge service graph cleanup failed.")

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
        if worker_failed:
            return worker_failure_status()
        try:
            statuses = [queue_store.status(scope) for scope in queue_store.all_scopes()]
        except Exception:
            mark_worker_failed()
            return worker_failure_status()
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
        if worker_failed:
            return worker_failure_status()
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
            active_answer = active_answers.get(value.scope)
            if active_answer is not None:
                active_answer[1].cancel()
            return status
        except StaleGeneration:
            raise HTTPException(409, "Snapshot generation is stale or conflicts with persisted content.") from None
        except ValidationError:
            raise HTTPException(422, "Invalid request.") from None
        except HTTPException:
            raise
        except Exception:
            mark_worker_failed()
            return worker_failure_status()

    @app.post("/v1/search", response_model=SearchResponse)
    async def search(body: SearchRequest, request: Request) -> SearchResponse:
        authorize(request)
        if worker_failed:
            return SearchResponse(status=worker_failure_status(body.scope), relationships=[])
        try:
            current = queue_store.generation(body.scope)
        except Exception:
            mark_worker_failed()
            return SearchResponse(status=worker_failure_status(body.scope), relationships=[])
        if current is None or current[0] != body.generation:
            raise HTTPException(409, "Search generation does not match the current snapshot.")
        try:
            status = queue_store.status(body.scope)
        except Exception:
            mark_worker_failed()
            return SearchResponse(status=worker_failure_status(body.scope), relationships=[])
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
            try:
                rebuilt = queue_store.requeue_rebuild(body.scope, body.generation)
            except Exception:
                mark_worker_failed()
                return SearchResponse(status=worker_failure_status(body.scope), relationships=[])
            return SearchResponse(status=rebuilt, relationships=[])
        except Exception:
            return SearchResponse(
                status=Status(
                    **{**status.model_dump(), "state": "unavailable", "message": "Local graph search is unavailable."}
                ),
                relationships=[],
            )
        if worker_failed:
            return SearchResponse(status=worker_failure_status(body.scope), relationships=[])
        # A new snapshot can arrive while FalkorDB is serving this query. Never return
        # results from the generation that was fenced during the await.
        try:
            latest = queue_store.generation(body.scope)
        except Exception:
            mark_worker_failed()
            return SearchResponse(status=worker_failure_status(body.scope), relationships=[])
        if latest is None or latest[0] != body.generation or not latest[1]:
            try:
                return SearchResponse(status=queue_store.status(body.scope), relationships=[])
            except Exception:
                mark_worker_failed()
                return SearchResponse(status=worker_failure_status(body.scope), relationships=[])
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

    @app.post("/v1/answer", response_model=AnswerResponse)
    async def answer(body: AnswerRequest, request: Request) -> AnswerResponse:
        authorize(request)
        from .answers import InvalidAnswerOutput, request_quoted_answer, select_candidate_windows
        from .providers import configured_extraction_identity

        provider_identity = configured_extraction_identity()
        if not provider_identity:
            return _answer_unavailable("Quoted answers are not configured for this service.")
        try:
            sources, fingerprint = queue_store.begin_answer(body, provider_identity)
        except DuplicateAnswerRequest:
            if queue_store.answer_state(body.scope, body.request_id) == "cancelled":
                return AnswerResponse(status="cancelled", selections=[], message="This request was cancelled.")
            return _answer_unavailable("This answer request has already been used.")
        except StaleGeneration:
            return AnswerResponse(status="stale", selections=[], message="The notes changed; ask again.")
        except (AnswerAttemptError, AnswerRequestLedgerFull):
            return _answer_unavailable("Quoted answers are unavailable for the selected notes.")

        if body.scope in active_answers:
            queue_store.finish_answer(body.scope, body.request_id, "unavailable")
            return _answer_unavailable("Another answer request is active for this scope.")

        async def run_answer() -> AnswerResponse:
            async with answer_semaphore:
                current_provider = configured_extraction_identity()
                if current_provider != provider_identity or not queue_store.answer_context_matches(
                    body, current_provider, fingerprint
                ):
                    queue_store.finish_answer(body.scope, body.request_id, "stale")
                    return AnswerResponse(
                        status="stale", selections=[], message="The notes or consent changed; ask again."
                    )
                windows, limited = select_candidate_windows(body.question, sources)
                try:
                    client = answer_client
                    if client is None:
                        client = answer_client_for(provider_identity)
                    current_provider = configured_extraction_identity()
                    if current_provider != provider_identity or not queue_store.answer_context_matches(
                        body, current_provider, fingerprint
                    ):
                        queue_store.finish_answer(body.scope, body.request_id, "stale")
                        return AnswerResponse(
                            status="stale", selections=[], message="The notes or consent changed; ask again."
                        )
                    result = await request_quoted_answer(body, windows, client)
                except asyncio.CancelledError:
                    queue_store.finish_answer(body.scope, body.request_id, "cancelled")
                    return AnswerResponse(status="cancelled", selections=[], message="This answer was cancelled.")
                except InvalidAnswerOutput as exc:
                    # The reason is a fixed allow-listed code; never log provider output or note data.
                    _LOGGER.warning("Quoted answer output rejected (%s).", exc.reason)
                    result = _answer_unavailable("The answer could not be validated against the selected notes.")
                except Exception:
                    result = _answer_unavailable("Quoted answers are temporarily unavailable.")
                current_provider = configured_extraction_identity()
                if current_provider != provider_identity or not queue_store.answer_context_matches(
                    body, current_provider, fingerprint
                ):
                    queue_store.finish_answer(body.scope, body.request_id, "stale")
                    return AnswerResponse(
                        status="stale", selections=[], message="The notes or consent changed; ask again."
                    )
                if limited:
                    result.message = "Some long or ambiguous notes were limited. " + result.message
                queue_store.finish_answer(body.scope, body.request_id, result.status)
                return result

        operation = asyncio.create_task(run_answer(), name="recall-quoted-answer")
        active_answers[body.scope] = (body.request_id, operation)
        try:
            return await asyncio.wait_for(operation, timeout=60)
        except TimeoutError:
            operation.cancel()
            await asyncio.gather(operation, return_exceptions=True)
            queue_store.finish_answer(body.scope, body.request_id, "unknown")
            return _answer_unavailable("The answer request timed out; retry with a new request ID.")
        except asyncio.CancelledError:
            operation.cancel()
            await asyncio.gather(operation, return_exceptions=True)
            queue_store.finish_answer(body.scope, body.request_id, "cancelled")
            return AnswerResponse(status="cancelled", selections=[], message="This answer was cancelled.")
        finally:
            current = active_answers.get(body.scope)
            if current is not None and current[0] == body.request_id:
                active_answers.pop(body.scope, None)

    @app.post("/v1/answer/cancel")
    async def cancel_answer(body: AnswerCancelRequest, request: Request) -> dict[str, bool]:
        authorize(request)
        cancelled = queue_store.cancel_answer(body.scope, body.generation, body.request_id)
        active = active_answers.get(body.scope)
        if cancelled and active is not None and active[0] == body.request_id:
            active[1].cancel()
        return {"cancelled": cancelled}

    return app


def _provider_disclosures() -> dict[str, str]:
    from .providers import provider_disclosures

    return provider_disclosures()


def _answer_unavailable(message: str) -> AnswerResponse:
    return AnswerResponse(status="unavailable", selections=[], message=message)
