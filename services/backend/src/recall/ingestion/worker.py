"""Durable interpretation worker. `python -m recall.ingestion.worker`

Claims one job at a time with FOR UPDATE SKIP LOCKED and a lease. The provider call happens outside
any transaction. A result commits only if this worker still holds the lease (token match), consent is
still active, and the job is still leased: a crashed or expired worker can never commit late.
At-least-once execution may repeat a billed provider call; it never duplicates a memory.
"""

from __future__ import annotations

import json
import logging
import signal
import socket
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from ..config import Settings, get_settings
from ..db.database import Row, Tx
from ..domain import processing
from ..domain.manifest import find_schema_path, load_schema
from ..storage import ObjectStore, hash_stream
from ..storage.factory import build_object_store
from . import PROCESSOR_VERSION
from .images import REQUEST_IMAGE_BUDGET, TRANSFORM_VERSION, DerivativeError, make_derivative
from .provider import InterpretRequest, PageImage, Provider, ProviderError
from .validate import InvalidExtraction, Validated, validate_extraction

log = logging.getLogger("recall.worker")


class JobFailure(Exception):
    def __init__(self, code: str, *, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


def extraction_schema_path(settings: Settings) -> str:
    return str(find_schema_path(settings).with_name("extraction.schema.json"))


class Worker:
    def __init__(
        self, dsn: str, store: ObjectStore, settings: Settings, provider: Provider, *, owner: str | None = None
    ) -> None:
        self.pool: ConnectionPool[psycopg.Connection[Row]] = ConnectionPool(
            dsn, min_size=1, max_size=2, kwargs={"row_factory": dict_row}, open=False
        )
        self.store = store
        self.settings = settings
        self.provider = provider
        self.owner = owner or f"{socket.gethostname()}:{uuid.uuid4().hex[:8]}"
        self.schema = load_schema(extraction_schema_path(settings))

    def open(self) -> None:
        self.pool.open(wait=True, timeout=15)
        with self.pool.connection() as conn:
            row = conn.execute(
                "select r.rolsuper, r.rolbypassrls, pg_has_role(current_user, 'recall_worker', 'USAGE') as is_worker, "
                "(select pg_get_userbyid(c.relowner) = current_user from pg_class c"
                " where c.oid='public.captures'::regclass) as owns "
                "from pg_roles r where r.rolname = current_user"
            ).fetchone()
            conn.rollback()
        assert row is not None
        if row["rolsuper"] or row["rolbypassrls"] or row["owns"] or not row["is_worker"]:
            raise RuntimeError("worker role must inherit recall_worker and must not be superuser/BYPASSRLS/owner")

    def close(self) -> None:
        self.pool.close()

    @contextmanager
    def _tx(self, workspace_id: uuid.UUID | None = None) -> Iterator[Tx]:
        """Worker transaction. RLS scopes every content table to `workspace_id` (the claimed job's)."""
        with self.pool.connection() as conn, conn.transaction():
            conn.execute(
                "select set_config('app.workspace_id', %s, true)", (str(workspace_id) if workspace_id else "",)
            )
            yield Tx(conn=conn, user_id=uuid.UUID(int=0), workspace_id=workspace_id or uuid.UUID(int=0))

    # ------------------------------------------------------------------ claim
    def claim(self) -> Row | None:
        with self._tx() as tx:
            day, month = processing.spend(tx)
            if not processing.budget_available(self.settings, day, month):
                tx.run(
                    "update processing_jobs set blocked_reason='budget_exhausted', updated_at=now() "
                    "where status='queued' and blocked_reason is distinct from 'budget_exhausted'"
                )
                return None
            job = tx.one(
                """
                with next as (
                  select id from processing_jobs
                  where (status = 'queued' and not_before <= now())
                     or (status = 'leased' and lease_expires_at < now())
                  order by not_before, created_at
                  for update skip locked limit 1)
                update processing_jobs j
                   set status='leased', lease_token=%s, lease_owner=%s, attempts=j.attempts+1,
                       lease_expires_at = now() + %s, blocked_reason=null, updated_at=now()
                  from next where j.id = next.id
                returning j.*
                """,
                (uuid.uuid4(), self.owner, timedelta(seconds=self.settings.worker_lease_seconds)),
            )
        if job is None:
            return None
        with self._tx(job["workspace_id"]) as tx:
            if job["attempts"] > job["max_attempts"]:
                self._finish_failed(tx, job, "ATTEMPTS_EXHAUSTED")
                return None
            if not processing.consent_active(tx, self.settings):
                self._cancel(tx, job, "CONSENT_REVOKED")
                return None
            cap = tx.one("select status from captures where id=%s", (job["capture_id"],))
            assert cap is not None
            if cap["status"] in ("stored", "failed"):
                tx.run("update captures set status='processing', version=version+1 where id=%s", (job["capture_id"],))
        return job

    # ------------------------------------------------------------------ run
    def run_once(self) -> str | None:
        job = self.claim()
        if job is None:
            return None
        try:
            validated, model_id = self._interpret(job)
        except JobFailure as failure:
            self._fail(job, failure.code, failure.retryable)
            return str(job["id"])
        self._commit(job, validated, model_id)
        return str(job["id"])

    def _load(self, job: Row) -> tuple[Row, list[Row]]:
        with self._tx(job["workspace_id"]) as tx:
            cap = tx.one("select * from captures where id=%s", (job["capture_id"],))
            pages = tx.all("select * from source_objects where capture_id=%s order by ordinal", (job["capture_id"],))
        assert cap is not None
        return cap, pages

    def _interpret(self, job: Row) -> tuple[Validated, str]:
        cap, pages = self._load(job)
        if processing.input_fingerprint(pages, cap["context_hint"], cap["timezone"]) != job["input_fingerprint"]:
            raise JobFailure("INPUT_CHANGED", retryable=False)
        per_page = min(3_500_000, REQUEST_IMAGE_BUDGET // max(1, len(pages)))
        images: list[PageImage] = []
        derivatives: list[dict[str, Any]] = []
        for page in pages:
            data = b"".join(self.store.iter_bytes(page["storage_key"]))
            actual, _ = hash_stream(iter([data]))
            if actual != page["server_sha256"]:
                raise JobFailure("SOURCE_INTEGRITY", retryable=False)  # never send altered bytes
            try:
                jpeg, digest = make_derivative(data, max_edge=self.settings.ai_image_max_edge, max_bytes=per_page)
            except DerivativeError:
                raise JobFailure("PAGE_NOT_DECODABLE", retryable=False) from None
            images.append(PageImage(source_id=str(page["id"]), ordinal=page["ordinal"], jpeg=jpeg))
            derivatives.append(
                {
                    "source_id": str(page["id"]),
                    "parent_sha256": page["server_sha256"],
                    "derivative_sha256": digest,
                    "transform": TRANSFORM_VERSION,
                }
            )
        envelope = {
            "capture_id": str(cap["id"]),
            "input_manifest_sha256": job["input_fingerprint"],
            "timezone": cap["timezone"],
            "captured_at": cap["captured_at"].isoformat(),
            "context_hint": cap["context_hint"],
            "pages": [{"page_id": str(p["id"]), "ordinal": p["ordinal"]} for p in pages],
        }
        page_map = {str(p["id"]): p["ordinal"] for p in pages}
        repair: str | None = None
        for purpose in ("interpret", "repair"):
            if not self._budget_ok(job):
                raise JobFailure("BUDGET_EXHAUSTED", retryable=True)
            try:
                result = self.provider.interpret(
                    InterpretRequest(envelope=envelope, pages=images, schema=self.schema, repair_note=repair)
                )
            except ProviderError as err:
                self._record_usage(job, purpose, self.settings.ai_model_id or "unknown", *err.usage)
                raise JobFailure(err.code, retryable=err.retryable) from None
            self._record_usage(job, purpose, result.model_id, result.input_tokens, result.output_tokens)
            try:
                validated = validate_extraction(
                    result.text,
                    schema=self.schema,
                    capture_id=str(cap["id"]),
                    fingerprint=job["input_fingerprint"],
                    pages=page_map,
                )
            except InvalidExtraction as bad:
                repair = "\n".join(f"- {p}" for p in bad.problems)
                continue
            validated.extraction["_derivatives"] = derivatives
            return validated, result.model_id
        raise JobFailure("EXTRACTION_INVALID", retryable=True)

    def _budget_ok(self, job: Row) -> bool:
        with self._tx(job["workspace_id"]) as tx:
            return processing.budget_available(self.settings, *processing.spend(tx))

    def _record_usage(self, job: Row, purpose: str, model_id: str, input_tokens: int, output_tokens: int) -> None:
        with self._tx(job["workspace_id"]) as tx:
            tx.run(
                "insert into ai_usage (id, workspace_id, job_id, purpose, model_id, input_tokens, output_tokens, "
                "estimated_cost_usd) values (%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    uuid.uuid4(),
                    job["workspace_id"],
                    job["id"],
                    purpose,
                    model_id,
                    input_tokens,
                    output_tokens,
                    processing.estimate_cost(self.settings, input_tokens, output_tokens),
                ),
            )

    # ------------------------------------------------------------------ commit
    def _holds_lease(self, tx: Tx, job: Row) -> bool:
        row = tx.one(
            "select 1 as ok from processing_jobs where id=%s and status='leased' and lease_token=%s for update",
            (job["id"], job["lease_token"]),
        )
        return row is not None

    def _commit(self, job: Row, validated: Validated, model_id: str) -> None:
        cap, pages = self._load(job)
        source_by_page = {str(p["id"]): p for p in pages}
        ex = validated.extraction
        with self._tx(job["workspace_id"]) as tx:
            if not self._holds_lease(tx, job):
                log.warning("stale lease; discarding result job=%s", job["id"])
                return
            if not processing.consent_active(tx, self.settings):
                self._cancel(tx, job, "CONSENT_REVOKED")
                return
            memory = tx.one("select id, current_revision from memories where capture_id=%s for update", (cap["id"],))
            if memory is None:
                memory_id, revision = uuid.uuid4(), 1
                tx.run(
                    "insert into memories (id, workspace_id, capture_id, current_revision) values (%s,%s,%s,1)",
                    (memory_id, job["workspace_id"], cap["id"]),
                )
            else:
                memory_id, revision = memory["id"], memory["current_revision"] + 1
                tx.run("update search_chunks set eligible=false where memory_id=%s", (memory_id,))
                tx.run("update memories set current_revision=%s, updated_at=now() where id=%s", (revision, memory_id))
            tx.run(
                "insert into memory_revisions (workspace_id, memory_id, revision, origin, job_id, processor_version, "
                "model_id, summary, extraction, validation) values (%s,%s,%s,'model',%s,%s,%s,%s,%s,%s)",
                (
                    job["workspace_id"],
                    memory_id,
                    revision,
                    job["id"],
                    PROCESSOR_VERSION,
                    model_id,
                    ex["summary"],
                    json.dumps(ex),
                    json.dumps({"notes": validated.notes, "needs_review": validated.needs_review}),
                ),
            )
            for kind, source_id, ordinal, text, state in _chunks(cap, ex, source_by_page):
                tx.run(
                    "insert into search_chunks (id, workspace_id, memory_id, revision, source_id, kind, ordinal, text, "
                    "epistemic_state) values (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        uuid.uuid4(),
                        job["workspace_id"],
                        memory_id,
                        revision,
                        source_id,
                        kind,
                        ordinal,
                        text[:40000],
                        state,
                    ),
                )
            status = "needs_review" if validated.needs_review else "ready"
            tx.run(
                "update captures set status=%s, version=version+1 where id=%s and status='processing'",
                (status, cap["id"]),
            )
            tx.run(
                "update processing_jobs set status='succeeded', lease_token=null, lease_expires_at=null, "
                "last_error_code=null, finished_at=now(), updated_at=now() where id=%s",
                (job["id"],),
            )

    # ------------------------------------------------------------------ failure
    def _fail(self, job: Row, code: str, retryable: bool) -> None:
        with self._tx(job["workspace_id"]) as tx:
            if not self._holds_lease(tx, job):
                return
            if retryable and job["attempts"] < job["max_attempts"]:
                backoff = timedelta(seconds=30 * job["attempts"] ** 2)
                tx.run(
                    "update processing_jobs set status='queued', lease_token=null, lease_expires_at=null, "
                    "not_before=now()+%s, last_error_code=%s, last_error_retryable=true, updated_at=now() where id=%s",
                    (backoff, code, job["id"]),
                )
                return
            self._finish_failed(tx, job, code, retryable=retryable)

    def _finish_failed(self, tx: Tx, job: Row, code: str, *, retryable: bool = False) -> None:
        tx.run(
            "update processing_jobs set status='failed', lease_token=null, lease_expires_at=null, last_error_code=%s, "
            "last_error_retryable=%s, finished_at=now(), updated_at=now() where id=%s",
            (code, retryable, job["id"]),
        )
        tx.run(
            "update captures set status='failed', version=version+1 where id=%s and status='processing'",
            (job["capture_id"],),
        )

    def _cancel(self, tx: Tx, job: Row, code: str) -> None:
        tx.run(
            "update processing_jobs set status='cancelled', lease_token=null, lease_expires_at=null,"
            " last_error_code=%s, "
            "finished_at=now(), updated_at=now() where id=%s",
            (code, job["id"]),
        )
        tx.run(
            "update captures set status='stored', version=version+1 where id=%s and status='processing'",
            (job["capture_id"],),
        )


def _chunks(cap: Row, ex: dict[str, Any], source_by_page: dict[str, Row]) -> list[tuple[str, Any, Any, str, Any]]:
    out: list[tuple[str, Any, Any, str, Any]] = []
    if cap["context_hint"]:
        out.append(("context", None, None, cap["context_hint"], None))

    def pages_of(evidence: list[dict[str, str]]) -> list[str]:
        """Every distinct supporting page, in order: a claim is cited by each page that supports it."""
        return list(dict.fromkeys(ev["page_id"] for ev in evidence))

    if ex["summary"]:
        for page_id in pages_of(ex["summary_evidence"]):
            out.append(("summary", page_id, source_by_page[page_id]["ordinal"], ex["summary"], None))
    for page in ex["pages"]:
        if page["transcription"].strip():
            out.append(("transcription", page["page_id"], page["ordinal"], page["transcription"], None))
    for s in ex["statements"]:
        text = s["text"] if not s["value_text"] or s["value_text"] in s["text"] else f"{s['text']} ({s['value_text']})"
        for page_id in pages_of(s["evidence"]):
            out.append(("statement", page_id, source_by_page[page_id]["ordinal"], text, s["epistemic_state"]))
    return out


def main() -> int:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    if not settings.ai_configured or not settings.worker_database_url:
        log.error("AI processing is not configured (provider, model, key, prices, budgets, RECALL_WORKER_DATABASE_URL)")
        return 2
    from .anthropic_provider import AnthropicProvider

    assert settings.ai_api_key and settings.ai_model_id
    provider = AnthropicProvider(
        api_key=settings.ai_api_key,
        model_id=settings.ai_model_id,
        effort=settings.ai_effort,
        refusal_fallback=settings.ai_refusal_fallback,
    )
    worker = Worker(settings.worker_database_url, build_object_store(settings), settings, provider)
    worker.open()
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    try:
        while not stop.is_set():
            if worker.run_once() is None:
                stop.wait(5.0)
    finally:
        worker.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
