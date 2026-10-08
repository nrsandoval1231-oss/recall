"""Durable interpretation worker. `python -m recall.ingestion.worker`

Claims one job at a time with FOR UPDATE SKIP LOCKED and a lease. The provider call happens outside
any transaction. A result commits only if this worker still holds the lease (token match), consent is
still active, and the job is still leased: a crashed or expired worker can never commit late.
At-least-once execution may repeat a billed provider call; it never duplicates a memory.
"""
# ruff: noqa: E501

from __future__ import annotations

import copy
import hashlib
import json
import logging
import signal
import socket
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from typing import Any

import httpx
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
from .corrections import apply_claim_overrides
from .embeddings import (
    EmbeddingProviderError,
    EmbeddingResult,
    VoyageEmbeddingProvider,
    configured_embedding,
    finalize_embedding_reservation,
    mark_oversize_chunk,
    pending_chunks,
    request_embeddings,
    reserve_embedding_budget,
    vector_index_available,
    write_embeddings,
)
from .images import REQUEST_IMAGE_BUDGET, TRANSFORM_VERSION, DerivativeError, make_derivative
from .projection import (
    claim_identity_key,
    duplicate_claim_identity_keys,
    mention_evidence_keys,
    mention_identity_key,
    write_search_chunks,
)
from .provider import InterpretRequest, PageImage, Provider, ProviderError, ProviderResult
from .validate import InvalidExtraction, Validated, validate_extraction

log = logging.getLogger("recall.worker")

# Sonnet 5.5 can consume at most 4,784 visual tokens per high-resolution image.  The static
# allowance covers the stable system prompt, output schema, envelope and bounded repair note.
# It is deliberately conservative because the API does not expose a free exact token-count call.
MAX_VISUAL_TOKENS_PER_PAGE = 4_784
MAX_INTERPRET_TEXT_INPUT_TOKENS = 20_000
MAX_INTERPRET_OUTPUT_TOKENS = 64_000


class JobFailure(Exception):
    def __init__(self, code: str, *, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


def extraction_schema_path(settings: Settings) -> str:
    return str(find_schema_path(settings).with_name("extraction.schema.json"))


class Worker:
    def __init__(
        self,
        dsn: str,
        store: ObjectStore,
        settings: Settings,
        provider: Provider,
        *,
        owner: str | None = None,
        embedding_provider: VoyageEmbeddingProvider | None = None,
    ) -> None:
        self.pool: ConnectionPool[psycopg.Connection[Row]] = ConnectionPool(
            dsn, min_size=1, max_size=2, kwargs={"row_factory": dict_row}, open=False
        )
        self.store = store
        self.settings = settings
        self.provider = provider
        self.owner = owner or f"{socket.gethostname()}:{uuid.uuid4().hex[:8]}"
        self.schema = load_schema(extraction_schema_path(settings))
        self.embedding_provider = embedding_provider
        self._embedding_retry_not_before: dict[uuid.UUID, float] = {}
        self._embedding_failures: dict[uuid.UUID, int] = {}

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
            conn.execute("select pg_advisory_xact_lock_shared(7402006)")
            conn.execute(
                "select set_config('app.workspace_id', %s, true)", (str(workspace_id) if workspace_id else "",)
            )
            if workspace_id is not None:
                conn.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"sync:{workspace_id}",))
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
            if cap is None:
                return None
            if cap["status"] in ("stored", "failed"):
                tx.run("update captures set status='processing', version=version+1 where id=%s", (job["capture_id"],))
        return job

    # ------------------------------------------------------------------ run
    def run_once(self) -> str | None:
        job = self.claim()
        if job is None:
            self._sweep_embedding_backlog()
            return None
        try:
            validated, model_id = self._interpret(job)
        except JobFailure as failure:
            self._fail(job, failure.code, failure.retryable)
            return str(job["id"])
        self._commit(job, validated, model_id)
        self._index_workspace(job["workspace_id"])
        return str(job["id"])

    def _sweep_embedding_backlog(self) -> None:
        """One idle sweep pass over enabled workspace ids only; no content is read globally."""
        with self._tx() as tx:
            workspaces = [
                row["workspace_id"] for row in tx.all("select workspace_id from recall_embedding_enabled_workspaces()")
            ]
        now = time.monotonic()
        # Rotate the bounded pass so stable early workspaces cannot starve later ones.
        workspaces.sort(key=str)
        offset = getattr(self, "_embedding_sweep_offset", 0) % max(1, len(workspaces))
        rotated = workspaces[offset:] + workspaces[:offset]
        self._embedding_sweep_offset = offset + min(8, len(workspaces))
        for workspace_id in rotated[:8]:
            if now < self._embedding_retry_not_before.get(workspace_id, 0):
                continue
            try:
                indexed = self._index_workspace(workspace_id)
            except (EmbeddingProviderError, httpx.HTTPError, ValueError):
                indexed = False
            if not indexed:
                failures = min(self._embedding_failures.get(workspace_id, 0) + 1, 6)
                self._embedding_failures[workspace_id] = failures
                self._embedding_retry_not_before[workspace_id] = now + min(300, 5 * 2**failures)
            else:
                self._embedding_failures.pop(workspace_id, None)
                self._embedding_retry_not_before.pop(workspace_id, None)

    def _index_workspace(self, workspace_id: uuid.UUID) -> bool:
        """Index at most one consented, budget-reserved batch after a durable interpretation.

        Provider I/O occurs after the reservation transaction commits; a failed or revoked
        configuration merely releases that reservation and never affects the source memory job.
        """
        with self._tx(workspace_id) as tx:
            config = configured_embedding(tx, self.settings)
            if config is None or not vector_index_available(tx) or not processing.consent_active(tx, self.settings):
                return True
            chunks = pending_chunks(
                tx, version=config.version, max_input_bytes=self.settings.embedding_max_batch_tokens
            )
            planned_tokens = 0
            bounded: list[Row] = []
            for chunk in chunks:
                tokens = max(1, len(str(chunk["text"]).encode("utf-8")))
                if tokens > self.settings.embedding_max_batch_tokens:
                    mark_oversize_chunk(tx, chunk, config)
                    continue
                if planned_tokens + tokens > self.settings.embedding_max_batch_tokens:
                    continue
                bounded.append(chunk)
                planned_tokens += tokens
            if not bounded:
                return True
            try:
                reservation = reserve_embedding_budget(
                    tx, self.settings, config, purpose="document", input_tokens=planned_tokens
                )
            except EmbeddingProviderError:
                return False
        provider = self.embedding_provider
        if provider is None or provider.config != config:
            provider = VoyageEmbeddingProvider(config)
        result: EmbeddingResult | None = None
        try:
            result = request_embeddings(provider, bounded, budget_available=True, input_type="document")
        except (EmbeddingProviderError, ValueError, httpx.HTTPError):
            result = None
        with self._tx(workspace_id) as tx:
            still_enabled = (
                processing.consent_active(tx, self.settings) and configured_embedding(tx, self.settings) == config
            )
            if result is not None and still_enabled:
                write_embeddings(tx, bounded, result, provider=provider)
            # The provider may have billed a result even if consent/config changed while it was
            # in flight. Record that cost but never persist the vector after a failed recheck.
            finalize_embedding_reservation(tx, reservation, result, config=config)
        return result is not None

    def _load(self, job: Row) -> tuple[Row, list[Row]]:
        with self._tx(job["workspace_id"]) as tx:
            cap = tx.one("select * from captures where id=%s", (job["capture_id"],))
            pages = tx.all("select * from source_objects where capture_id=%s order by ordinal", (job["capture_id"],))
        if cap is None:
            raise JobFailure("CAPTURE_DELETED", retryable=False)
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
            try:
                reservation = self._reserve_provider_budget(job, purpose, len(images))
            except processing.BudgetReservationError as exc:
                raise JobFailure(str(exc), retryable=str(exc) == "BUDGET_EXHAUSTED") from None
            try:
                result = self.provider.interpret(
                    InterpretRequest(envelope=envelope, pages=images, schema=self.schema, repair_note=repair)
                )
            except ProviderError as err:
                billed = (
                    ProviderResult(
                        text="",
                        model_id=self.settings.ai_model_id or "unknown",
                        input_tokens=err.usage[0],
                        output_tokens=err.usage[1],
                    )
                    if any(err.usage)
                    else None
                )
                self._finalize_provider_budget(job, reservation, purpose, billed, uncertain=billed is None)
                raise JobFailure(err.code, retryable=err.retryable) from None
            self._finalize_provider_budget(job, reservation, purpose, result, uncertain=False)
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

    def _reserve_provider_budget(self, job: Row, purpose: str, page_count: int) -> uuid.UUID:
        with self._tx(job["workspace_id"]) as tx:
            return processing.reserve_provider_budget(
                tx,
                self.settings,
                purpose=purpose,
                model_id=self.settings.ai_model_id or "unknown",
                max_input_tokens=page_count * MAX_VISUAL_TOKENS_PER_PAGE + MAX_INTERPRET_TEXT_INPUT_TOKENS,
                max_output_tokens=MAX_INTERPRET_OUTPUT_TOKENS,
            )

    def _finalize_provider_budget(
        self, job: Row, reservation: uuid.UUID, purpose: str, result: ProviderResult | None, *, uncertain: bool
    ) -> None:
        with self._tx(job["workspace_id"]) as tx:
            existing_job = tx.one("select id from processing_jobs where id=%s", (job["id"],))
            processing.finalize_provider_reservation(
                tx,
                self.settings,
                reservation,
                purpose=purpose,
                job_id=job["id"] if existing_job else None,
                result=result,
                uncertain=uncertain,
            )

    # ------------------------------------------------------------------ commit
    def _holds_lease(self, tx: Tx, job: Row) -> bool:
        row = tx.one(
            "select 1 as ok from processing_jobs where id=%s and status='leased' and lease_token=%s for update",
            (job["id"], job["lease_token"]),
        )
        return row is not None

    def _commit(self, job: Row, validated: Validated, model_id: str) -> None:
        try:
            cap, pages = self._load(job)
        except JobFailure as exc:
            if exc.code == "CAPTURE_DELETED":
                return
            raise
        source_by_page = {str(p["id"]): p for p in pages}
        ex = copy.deepcopy(validated.extraction)
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
            for override in tx.all(
                "select field,target_key,value from memory_overrides where workspace_id=%s and memory_id=%s "
                "and field in ('summary','transcription')",
                (tx.workspace_id, memory_id),
            ):
                if override["field"] == "summary":
                    ex["summary"], ex["summary_evidence"] = override["value"], []
                else:
                    for page in ex["pages"]:
                        if page["page_id"] == str(override["target_key"]):
                            page["transcription"] = override["value"]
            rejected_claim_keys = duplicate_claim_identity_keys(ex)
            if rejected_claim_keys:
                validated.note(
                    "AMBIGUOUS_CLAIM_IDENTITY",
                    f"{len(rejected_claim_keys)} duplicate structural claim identity set(s) were not projected",
                )
            apply_claim_overrides(tx, memory_id, ex, rejected_claim_keys=rejected_claim_keys)
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
            _project_semantics(tx, memory_id, revision, ex, rejected_claim_keys=rejected_claim_keys)
            write_search_chunks(
                tx,
                memory_id,
                revision,
                cap,
                ex,
                source_by_page,
                excluded_claim_keys=rejected_claim_keys,
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


def _evidence_key(evidence: list[dict[str, str]]) -> str:
    """Legacy mention key used only to carry existing human resolutions forward."""
    canonical = json.dumps(sorted(evidence, key=lambda item: (item["page_id"], item["quote"])), separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _project_semantics(
    tx: Tx, memory_id: uuid.UUID, revision: int, ex: dict[str, Any], *, rejected_claim_keys: set[str] | None = None
) -> None:
    """Persist model proposals as bounded projections. Mentions stay unresolved until a person accepts a link."""
    rejected_claim_keys = rejected_claim_keys or set()
    for mention in ex["mentions"]:
        evidence_key = mention_identity_key(mention)
        legacy_key = _evidence_key(mention["evidence"])
        prior_candidates = tx.all(
            "select entity_id,resolution_status,text,kind,evidence from mentions "
            "where workspace_id=%s and memory_id=%s and (evidence_key=%s or evidence_key=%s) "
            "and resolution_status in ('accepted','rejected') order by revision desc,version desc,id",
            (tx.workspace_id, memory_id, evidence_key, legacy_key),
        )
        prior = next(
            (
                row
                for row in prior_candidates
                if mention_identity_key({"evidence": row["evidence"], "kind": row["kind"], "raw_text": row["text"]})
                == evidence_key
            ),
            None,
        )
        proposed_entity = None
        if prior is None and mention["kind"] != "unknown":
            candidates = tx.all(
                "select distinct e.id from entities e join entity_aliases a "
                "on a.workspace_id=e.workspace_id and a.entity_id=e.id "
                "where e.workspace_id=%s and e.kind=%s and lower(a.alias)=lower(%s) order by e.id limit 2",
                (tx.workspace_id, mention["kind"], mention["raw_text"]),
            )
            if len(candidates) == 1:
                proposed_entity = candidates[0]["id"]
            elif not candidates:
                proposed_entity = uuid.uuid4()
                tx.run(
                    "insert into entities(id,workspace_id,kind,canonical_name) values(%s,%s,%s,%s)",
                    (proposed_entity, tx.workspace_id, mention["kind"], mention["raw_text"]),
                )
                tx.run(
                    "insert into entity_aliases(id,workspace_id,entity_id,alias) values(%s,%s,%s,%s)",
                    (uuid.uuid4(), tx.workspace_id, proposed_entity, mention["raw_text"]),
                )
        tx.run(
            "insert into mentions (id, workspace_id, memory_id, revision, local_id, text, kind, entity_id, "
            "resolution_status, evidence_key, evidence) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                uuid.uuid4(),
                tx.workspace_id,
                memory_id,
                revision,
                mention["local_id"],
                mention["raw_text"],
                mention["kind"],
                prior["entity_id"] if prior else proposed_entity,
                prior["resolution_status"] if prior else ("candidate" if proposed_entity else "unresolved"),
                evidence_key,
                json.dumps(mention["evidence"]),
            ),
        )
    claim_mention_keys = mention_evidence_keys(ex)
    for statement in ex["statements"]:
        key = claim_identity_key(statement, claim_mention_keys)
        if key in rejected_claim_keys:
            continue
        claim = tx.one(
            "select id, current_version from claims where workspace_id=%s and memory_id=%s and evidence_key=%s for update",
            (tx.workspace_id, memory_id, key),
        )
        if claim is None:
            claim_id, version = uuid.uuid4(), 1
            tx.run(
                "insert into claims (id, workspace_id, memory_id, evidence_key) values (%s,%s,%s,%s)",
                (claim_id, tx.workspace_id, memory_id, key),
            )
        else:
            claim_id, version = claim["id"], claim["current_version"] + 1
            # A human correction owns the current interpretation of this evidence span.
            locked = tx.one(
                "select 1 as ok from memory_overrides where workspace_id=%s and memory_id=%s and claim_id=%s "
                "and field in ('claim_text','claim_epistemic_state','claim_validity')",
                (tx.workspace_id, memory_id, claim_id),
            )
            if locked is not None:
                continue
            tx.run("update claims set current_version=%s, updated_at=now() where id=%s", (version, claim_id))
        tx.run(
            "insert into claim_revisions (workspace_id, claim_id, memory_id, version, memory_revision, origin, kind, text, "
            "value_text, epistemic_state, attribution_text, temporal_text, evidence, supersedes_version) "
            "values (%s,%s,%s,%s,%s,'model',%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                tx.workspace_id,
                claim_id,
                memory_id,
                version,
                revision,
                statement["kind"],
                statement["text"],
                statement["value_text"],
                statement["epistemic_state"],
                statement["attribution_text"],
                statement["temporal_text"],
                json.dumps(statement["evidence"]),
                version - 1 if version > 1 else None,
            ),
        )
    identities = {
        row["local_id"]: row["entity_id"]
        for row in tx.all(
            "select local_id,entity_id from mentions where workspace_id=%s and memory_id=%s and revision=%s",
            (tx.workspace_id, memory_id, revision),
        )
    }
    for statement in ex["statements"]:
        if claim_identity_key(statement, claim_mention_keys) in rejected_claim_keys:
            continue
        source = identities.get(statement.get("subject_mention_id"))
        destination = identities.get(statement.get("object_mention_id"))
        predicate = statement.get("predicate")
        if (
            source
            and destination
            and source != destination
            and isinstance(predicate, str)
            and 1 <= len(predicate.strip()) <= 100
        ):
            # A source-backed relation remains a proposal even when its endpoint
            # identities were accepted. A rerun cannot reverse a user's decision.
            tx.run(
                "insert into entity_links(id,workspace_id,from_entity_id,to_entity_id,relation_type,status,evidence) "
                "values(%s,%s,%s,%s,%s,'candidate',%s) on conflict (workspace_id,from_entity_id,to_entity_id,relation_type) "
                "do update set evidence=(select coalesce(jsonb_agg(item), '[]'::jsonb) from "
                "(select distinct item from jsonb_array_elements(entity_links.evidence || excluded.evidence) item) evidence_items), "
                "version=entity_links.version+1 where entity_links.status='candidate'",
                (
                    uuid.uuid4(),
                    tx.workspace_id,
                    source,
                    destination,
                    predicate.strip(),
                    json.dumps(statement["evidence"]),
                ),
            )
    for action in ex["action_suggestions"]:
        row = tx.one(
            "select status from actions where workspace_id=%s and memory_id=%s and local_id=%s for update",
            (tx.workspace_id, memory_id, action["local_id"]),
        )
        # A human-accepted action is an obligation they own; a rerun may never turn it back into a suggestion.
        if row is None:
            tx.run(
                "insert into actions (id, workspace_id, memory_id, local_id, text, status, due_text, evidence) "
                "values (%s,%s,%s,%s,%s,'suggested',%s,%s)",
                (
                    uuid.uuid4(),
                    tx.workspace_id,
                    memory_id,
                    action["local_id"],
                    action["text"],
                    action["due_text"],
                    json.dumps(action["evidence"]),
                ),
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
    if settings.service_profile != "legacy":
        log.error("the legacy ingestion worker cannot run with RECALL_SERVICE_PROFILE=inference")
        return 2
    if not settings.worker_database_url:
        log.error("RECALL_WORKER_DATABASE_URL is required")
        return 2
    from ..domain.deletion import PurgeWorker

    store = build_object_store(settings)
    purge = PurgeWorker(settings.worker_database_url, store)
    worker: Worker | None = None
    if settings.ai_configured:
        from .anthropic_provider import AnthropicProvider

        assert settings.ai_api_key and settings.ai_model_id
        provider = AnthropicProvider(
            api_key=settings.ai_api_key,
            model_id=settings.ai_model_id,
            effort=settings.ai_effort,
            refusal_fallback=settings.ai_refusal_fallback,
        )
        worker = Worker(settings.worker_database_url, store, settings, provider)
        worker.open()
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    try:
        while not stop.is_set():
            purged = purge.run_once()
            interpreted = worker.run_once() if worker else None
            if purged is None and interpreted is None:
                stop.wait(5.0)
    finally:
        if worker:
            worker.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
