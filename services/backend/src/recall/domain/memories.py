"""RCL-002 commands: AI consent settings, memories, search, Ask, and processing retry."""
# ruff: noqa: E501

from __future__ import annotations

import copy
import json
import re
import uuid
from datetime import datetime
from typing import Any

import httpx

from ..config import Settings
from ..db.database import Database, Row, Tx
from ..errors import ApiError, forbidden, not_found, validation
from ..ingestion.embeddings import (
    EmbeddingConfig,
    EmbeddingProviderError,
    EmbeddingResult,
    VoyageEmbeddingProvider,
    configured_embedding,
    finalize_embedding_reservation,
    reserve_embedding_budget,
    vector_index_available,
)
from ..ingestion.provider import Provider
from ..retrieval import ask as ask_module
from ..retrieval.hybrid import SemanticIndexUnavailable, hybrid_search, temporal_claim_search, validate_as_of
from . import processing
from .captures import CaptureService
from .manifest import request_digest
from .tokens import TokenError, decode_cursor, encode_cursor

AI_EXPLANATION = (
    "When on, Recall sends a processed copy of each saved page (orientation fixed, metadata removed) to "
    "the configured AI provider to transcribe and organise it, and sends matching excerpts when you ask a "
    "question. Originals stay in Recall's private storage. Turning this off stops new processing."
)

_RELATIVE_TIME = re.compile(r"\b(last|this|next|yesterday|today|recently|earlier|ago|week|month|year)\b", re.I)
_TEMPORAL_MODES = {
    "original": re.compile(r"\b(original|initial|first)\b", re.I),
    "previous": re.compile(r"\b(previous|prior|before)\b", re.I),
    "changed": re.compile(r"\b(changed|change|different|difference)\b", re.I),
}
_EXPLICIT_TEMPORAL = re.compile(
    r"\b(?P<direction>before|after)\s+(?P<instant>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2}))\b",
    re.I,
)


def infer_temporal_mode(question: str) -> tuple[str | None, str | None]:
    """Infer only bounded historical language; relative dates remain ambiguous."""
    if _RELATIVE_TIME.search(question):
        return None, "Relative time references need an explicit ISO-8601 As of date before Recall can compare history."
    for mode, pattern in _TEMPORAL_MODES.items():
        if pattern.search(question):
            return mode, None
    return None, None


def infer_temporal_request(question: str) -> tuple[str | None, datetime | None, str | None]:
    """Return a strict natural-time mode and optional explicit cutoff.

    Relative expressions do not identify an instant without user context, so they
    intentionally abstain instead of guessing from server time.
    """
    mode, limitation = infer_temporal_mode(question)
    if limitation:
        return None, None, limitation
    explicit = _EXPLICIT_TEMPORAL.search(question)
    if explicit:
        try:
            return explicit["direction"].lower(), validate_as_of(explicit["instant"]), None
        except ValueError:
            return None, None, "Time references need an explicit ISO-8601 timestamp with a timezone."
    if mode == "previous":
        return "history", None, None
    if mode == "changed":
        return "history", None, None
    return mode, None, None


class MemoryService:
    def __init__(
        self,
        db: Database,
        settings: Settings,
        provider: Provider | None,
        embedding_provider: VoyageEmbeddingProvider | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.provider = provider
        self.embedding_provider = embedding_provider

    def _guard(self, user_id: uuid.UUID, fn: Any) -> Any:
        try:
            with self.db.tx(user_id, provision=self.settings.auto_provision_workspaces) as tx:
                return fn(tx)
        except LookupError:
            raise forbidden("This account has no workspace.") from None

    # ------------------------------------------------------------------ settings
    def _settings_view(self, tx: Tx) -> dict[str, Any]:
        row = tx.one("select * from ai_consents where workspace_id=%s", (tx.workspace_id,))
        active = processing.consent_active(tx, self.settings)
        return {
            "ai_configured": self.settings.provider_processing_configured,
            "provider": self.settings.ai_provider,
            "policy_version": self.settings.ai_policy_version,
            "enabled": active,
            "consent_outdated": bool(row and row["enabled"] and not active),
            "decided_at": row["decided_at"].isoformat() if row else None,
            "version": row["version"] if row else 0,
            "explanation": AI_EXPLANATION
            + (
                " Semantic recall also sends bounded memory excerpts and questions to Voyage for embeddings."
                if self.settings.embedding_configured
                else ""
            ),
        }

    def get_ai_settings(self, user_id: uuid.UUID) -> dict[str, Any]:
        return self._guard(user_id, self._settings_view)  # type: ignore[no-any-return]

    def put_ai_settings(self, user_id: uuid.UUID, body: Any) -> dict[str, Any]:
        if (
            not isinstance(body, dict)
            or set(body) - {"enabled", "expected_version"}
            or not isinstance(body.get("enabled"), bool)
        ):
            raise validation('Body must be {"enabled": true|false, "expected_version": n}.')
        expected = body.get("expected_version")
        enabled: bool = body["enabled"]
        if enabled and not self.settings.provider_processing_configured:
            raise ApiError("AI_NOT_CONFIGURED", "AI processing is not set up on this server.", 409)

        def run(tx: Tx) -> dict[str, Any]:
            row = tx.one("select version from ai_consents where workspace_id=%s for update", (tx.workspace_id,))
            current = row["version"] if row else 0
            if expected is not None and expected != current:
                raise ApiError(
                    "VERSION_CONFLICT",
                    "AI settings changed elsewhere; reload and try again.",
                    409,
                    details={"current_version": current},
                )
            provider = self.settings.ai_provider or self.settings.embedding_provider or "none"
            if row is None:
                tx.run(
                    "insert into ai_consents (workspace_id, enabled, provider, policy_version, decided_by) "
                    "values (%s,%s,%s,%s,%s)",
                    (tx.workspace_id, enabled, provider, self.settings.ai_policy_version, tx.user_id),
                )
            else:
                tx.run(
                    "update ai_consents set enabled=%s, provider=%s, policy_version=%s, decided_by=%s, "
                    "decided_at=now(), "
                    "version=version+1 where workspace_id=%s",
                    (enabled, provider, self.settings.ai_policy_version, tx.user_id, tx.workspace_id),
                )
            if enabled:
                if self.settings.embedding_configured:
                    tx.run(
                        "insert into retrieval_index_config(workspace_id,provider,model_id,dimensions,embedding_version,enabled) "
                        "values(%s,%s,%s,%s,%s,true) on conflict(workspace_id) do update set provider=excluded.provider,"
                        "model_id=excluded.model_id,dimensions=excluded.dimensions,embedding_version=excluded.embedding_version,enabled=true",
                        (
                            tx.workspace_id,
                            self.settings.embedding_provider,
                            self.settings.embedding_model_id,
                            self.settings.embedding_dimensions,
                            self.settings.embedding_version,
                        ),
                    )
                # Resume work cancelled only because consent was off, then queue never-processed captures.
                tx.run(
                    "update processing_jobs j set status='queued', attempts=0, not_before=now(), last_error_code=null, "
                    "finished_at=null, updated_at=now() from captures c "
                    "where j.workspace_id=%s and j.status='cancelled' "
                    "and j.last_error_code='CONSENT_REVOKED' and c.id=j.capture_id and c.status='stored'",
                    (tx.workspace_id,),
                )
                for cap in tx.all(
                    "select id from captures where workspace_id=%s and status='stored'", (tx.workspace_id,)
                ):
                    processing.enqueue_capture(tx, self.settings, cap["id"])
            else:
                tx.run("update retrieval_index_config set enabled=false where workspace_id=%s", (tx.workspace_id,))
                cancelled = tx.all(
                    "update processing_jobs set status='cancelled', last_error_code='CONSENT_REVOKED', "
                    "finished_at=now(), updated_at=now() "
                    "where workspace_id=%s and status='queued' returning capture_id",
                    (tx.workspace_id,),
                )
                # A capture waiting in retry backoff is 'processing'; with nothing left to run it is just stored.
                tx.run(
                    "update captures set status='stored', version=version+1 "
                    "where workspace_id=%s and status='processing' "
                    "and id = any(%s)",
                    (tx.workspace_id, [c["capture_id"] for c in cancelled]),
                )
            return self._settings_view(tx)

        return self._guard(user_id, run)  # type: ignore[no-any-return]

    # ------------------------------------------------------------------ processing retry
    def retry_processing(self, user_id: uuid.UUID, capture_id: uuid.UUID, idempotency_key: str) -> dict[str, Any]:
        digest = request_digest({"capture_id": str(capture_id)})

        def current(tx: Tx) -> dict[str, Any]:
            latest = tx.one(
                "select * from processing_jobs where workspace_id=%s and capture_id=%s "
                "order by created_at desc limit 1",
                (tx.workspace_id, capture_id),
            )
            return {"capture_id": str(capture_id), "processing": processing.processing_view(latest)}

        def run(tx: Tx) -> dict[str, Any]:
            cap = tx.one(
                "select id, status from captures where workspace_id=%s and id=%s", (tx.workspace_id, capture_id)
            )
            if cap is None:
                raise not_found("Capture not found.")
            if tx.one(
                "select 1 as ok from memory_suppressions where workspace_id=%s and capture_id=%s",
                (tx.workspace_id, capture_id),
            ):
                raise ApiError("NOT_RETRYABLE", "This capture's memory was deleted.", 409)
            record = tx.one(
                "select request_digest from idempotency_records where workspace_id=%s and actor_id=%s "
                "and operation_family='capture.retry_processing' and idempotency_key=%s",
                (tx.workspace_id, tx.user_id, idempotency_key),
            )
            if record is not None:  # same key: report the current state of the original retry, never re-effect
                if record["request_digest"] != digest:
                    raise ApiError(
                        "IDEMPOTENCY_CONFLICT", "This idempotency key was used for a different request.", 409
                    )
                return current(tx)
            job = tx.one(
                "select * from processing_jobs where workspace_id=%s and capture_id=%s order by created_at desc "
                "limit 1 for update",
                (tx.workspace_id, capture_id),
            )
            if job is not None and job["status"] in ("queued", "leased"):
                CaptureService._record_idempotency(tx, "capture.retry_processing", idempotency_key, digest, capture_id)
                return current(tx)  # already queued/running: nothing new to do
            if not processing.consent_active(tx, self.settings) or not self.settings.ai_configured:
                raise ApiError("AI_NOT_CONFIGURED", "Turn on AI processing to read this capture.", 409)
            if job is not None and job["last_error_code"] == "SOURCE_DELETED":
                # A partial source erase changes the immutable input fingerprint.
                # Keep the old cancelled job as history; enqueue remaining pages
                # under their new fingerprint rather than replaying old evidence.
                processing.enqueue_capture(tx, self.settings, capture_id)
                CaptureService._record_idempotency(tx, "capture.retry_processing", idempotency_key, digest, capture_id)
                return current(tx)
            if job is not None and job["status"] == "succeeded":
                raise ApiError("NOT_RETRYABLE", "This capture is already processed.", 409)
            if job is not None and job["status"] == "failed":
                if job["manual_retries"] >= 3:
                    raise ApiError(
                        "NOT_RETRYABLE", "This capture has already been retried the maximum number of times.", 409
                    )
                tx.run(
                    "update processing_jobs set status='queued', attempts=0, manual_retries=manual_retries+1, "
                    "not_before=now(), last_error_code=null, finished_at=null, updated_at=now() where id=%s",
                    (job["id"],),
                )
            elif cap["status"] != "stored":
                raise ApiError("NOT_RETRYABLE", "This capture can't be processed right now.", 409)
            elif job is not None:  # cancelled earlier (e.g. consent was off): queue it again
                tx.run(
                    "update processing_jobs set status='queued', attempts=0, not_before=now(), last_error_code=null, "
                    "finished_at=null, updated_at=now() where id=%s",
                    (job["id"],),
                )
            else:
                processing.enqueue_capture(tx, self.settings, capture_id)
            CaptureService._record_idempotency(tx, "capture.retry_processing", idempotency_key, digest, capture_id)
            return current(tx)

        return self._guard(user_id, run)  # type: ignore[no-any-return]

    # ------------------------------------------------------------------ memories
    def list_memories(self, user_id: uuid.UUID, limit: int, cursor: str | None) -> dict[str, Any]:
        def run(tx: Tx) -> dict[str, Any]:
            after: tuple[Any, Any] = (None, None)
            if cursor:
                try:
                    created_at, last_id = decode_cursor(self.settings.signing_secret, tx.workspace_id, cursor)
                except TokenError:
                    raise validation("Invalid cursor.") from None
                after = (created_at, last_id)
            rows = tx.all(
                "select m.id, m.capture_id, m.current_revision, m.created_at, r.summary, r.model_id, cap.status, "
                "cap.captured_at, cap.context_hint, cap.page_count from memories m "
                "join memory_revisions r on r.memory_id = m.id and r.revision = m.current_revision "
                "join captures cap on cap.workspace_id = m.workspace_id and cap.id = m.capture_id "
                "where m.workspace_id = %s and (%s::timestamptz is null or (m.created_at, m.id) < (%s, %s::uuid)) "
                "order by m.created_at desc, m.id desc limit %s",
                (tx.workspace_id, after[0], after[0], after[1], limit + 1),
            )
            more = len(rows) > limit
            rows = rows[:limit]
            return {
                "items": [_memory_summary(r) for r in rows],
                "next_cursor": encode_cursor(
                    self.settings.signing_secret, tx.workspace_id, rows[-1]["created_at"], rows[-1]["id"]
                )
                if more
                else None,
            }

        return self._guard(user_id, run)  # type: ignore[no-any-return]

    def _memory_view(self, tx: Tx, memory_id: uuid.UUID) -> dict[str, Any]:
        def run(tx: Tx) -> dict[str, Any]:
            row = tx.one(
                "select m.id, m.capture_id, m.current_revision, m.created_at, r.summary, r.model_id, "
                "r.processor_version, "
                "r.extraction, r.validation, r.created_at as revised_at, cap.status, cap.captured_at, cap.timezone, "
                "cap.context_hint, cap.page_count from memories m "
                "join memory_revisions r on r.memory_id = m.id and r.revision = m.current_revision "
                "join captures cap on cap.workspace_id = m.workspace_id and cap.id = m.capture_id "
                "where m.workspace_id = %s and m.id = %s",
                (tx.workspace_id, memory_id),
            )
            if row is None:
                raise not_found("Memory not found.")
            ex = copy.deepcopy(row["extraction"])
            ex.pop("_derivatives", None)
            claims = tx.all(
                "select c.id,r.version,r.kind,r.text,r.value_text,r.epistemic_state,r.temporal_text,r.valid_from,r.valid_to,r.supersedes_claim_id,r.origin,r.created_at "
                "from claims c join claim_revisions r on r.claim_id=c.id and r.version=c.current_version "
                "where c.workspace_id=%s and c.memory_id=%s order by r.created_at",
                (tx.workspace_id, memory_id),
            )
            actions = tx.all(
                "select id,text,status,due_text,version,updated_at from actions where workspace_id=%s and memory_id=%s",
                (tx.workspace_id, memory_id),
            )
            history = tx.all(
                "select revision,origin,summary,created_at,validation from memory_revisions "
                "where workspace_id=%s and memory_id=%s order by revision desc limit 100",
                (tx.workspace_id, memory_id),
            )
            mentions = tx.all(
                "select distinct on (mn.evidence_key) mn.*,e.canonical_name,e.kind as entity_kind "
                "from mentions mn left join entities e on e.workspace_id=mn.workspace_id and e.id=mn.entity_id "
                "where mn.workspace_id=%s and mn.memory_id=%s "
                "order by mn.evidence_key,mn.revision desc,mn.version desc,mn.id",
                (tx.workspace_id, memory_id),
            )
            entity_ids = list({m["entity_id"] for m in mentions if m["entity_id"] is not None})
            links = tx.all(
                "select l.* from entity_links l where l.workspace_id=%s "
                "and (l.from_entity_id=any(%s) or l.to_entity_id=any(%s)) "
                "and (l.status='accepted' or exists (select 1 from jsonb_array_elements(l.evidence) ev "
                "join source_objects s on s.workspace_id=l.workspace_id and s.id::text=ev.value->>'page_id' "
                "where s.capture_id=%s)) order by l.created_at limit 100",
                (tx.workspace_id, entity_ids, entity_ids, row["capture_id"]),
            )
            entities: list[dict[str, str]] = []
            seen_entity_ids: set[object] = set()
            for mention in mentions:
                entity_id = mention["entity_id"]
                if entity_id is not None and entity_id not in seen_entity_ids:
                    seen_entity_ids.add(entity_id)
                    entities.append(
                        {
                            "entity_id": str(entity_id),
                            "canonical_name": mention["canonical_name"],
                            "kind": mention["entity_kind"],
                        }
                    )
            return {
                **_memory_summary(row),
                "timezone": row["timezone"],
                "processor_version": row["processor_version"],
                "revised_at": row["revised_at"].isoformat(),
                "interpretation": {
                    k: ex[k]
                    for k in (
                        "summary",
                        "summary_evidence",
                        "pages",
                        "mentions",
                        "statements",
                        "action_suggestions",
                        "uncertainties",
                    )
                },
                "validation_notes": row["validation"]["notes"],
                "history": [
                    {
                        "revision": h["revision"],
                        "origin": h["origin"],
                        "summary": h["summary"],
                        "changed_at": h["created_at"].isoformat(),
                        "reason": next(
                            (n.get("reason") for n in h["validation"]["notes"] if n.get("code") == "USER_CORRECTION"),
                            None,
                        ),
                    }
                    for h in history
                ],
                "mentions": [
                    {
                        "mention_id": str(m["id"]),
                        "text": m["text"],
                        "kind": m["kind"],
                        "entity_id": str(m["entity_id"]) if m["entity_id"] else None,
                        "resolution": m["resolution_status"],
                        "evidence": m["evidence"],
                        "version": m["version"],
                    }
                    for m in mentions
                ],
                "entities": entities,
                "relationships": [
                    {
                        "relationship_id": str(link["id"]),
                        "from_entity_id": str(link["from_entity_id"]),
                        "to_entity_id": str(link["to_entity_id"]),
                        "type": link["relation_type"],
                        "status": link["status"],
                        "version": link["version"],
                        "evidence": link["evidence"],
                    }
                    for link in links
                ],
                "labels": {
                    "transcription": "Machine reading of the original. Check the original for anything important.",
                    "action_suggestions": "Suggestions only. Nothing has been scheduled or sent.",
                },
                "claims": [
                    {
                        "claim_id": str(c["id"]),
                        "version": c["version"],
                        "kind": c["kind"],
                        "text": c["text"],
                        "value_text": c["value_text"],
                        "epistemic_state": c["epistemic_state"],
                        "temporal_text": c["temporal_text"],
                        "valid_from": c["valid_from"].isoformat() if c["valid_from"] else None,
                        "valid_to": c["valid_to"].isoformat() if c["valid_to"] else None,
                        "supersedes_claim_id": str(c["supersedes_claim_id"]) if c["supersedes_claim_id"] else None,
                        "origin": c["origin"],
                        "created_at": c["created_at"].isoformat(),
                    }
                    for c in claims
                ],
                "actions": [
                    {
                        "action_id": str(a["id"]),
                        "text": a["text"],
                        "status": a["status"],
                        "due_text": a["due_text"],
                        "version": a["version"],
                        "updated_at": a["updated_at"].isoformat(),
                    }
                    for a in actions
                ],
            }

        return run(tx)

    # ------------------------------------------------------------------ corrections and reviewable actions
    def correct_memory(
        self, user_id: uuid.UUID, memory_id: uuid.UUID, idempotency_key: str, expected_revision: int, body: Any
    ) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {
            "target",
            "claim_id",
            "text",
            "epistemic_state",
            "reason",
            "page_id",
            "mention_id",
            "entity_id",
            "resolution",
            "relationship_id",
            "from_entity_id",
            "to_entity_id",
            "relation_type",
            "valid_from",
            "valid_to",
            "supersedes_claim_id",
        }:
            raise validation("Correction has unknown fields.")
        target = body.get("target")
        if target not in ("summary", "transcription", "claim", "mention_identity", "relationship"):
            raise validation("Unknown correction target.")
        text = body.get("text")
        state = body.get("epistemic_state")
        if text is not None and (not isinstance(text, str) or len(text) > 40000):
            raise validation("Correction text must be at most 40000 characters.")
        reason = body.get("reason")
        if reason is not None and (not isinstance(reason, str) or len(reason) > 2000):
            raise validation("Correction reason must be at most 2000 characters.")
        if target == "summary" and (not isinstance(text, str) or not text.strip()):
            raise validation("A summary correction needs text.")
        if target == "claim":
            try:
                claim_id = uuid.UUID(str(body.get("claim_id")))
            except (TypeError, ValueError):
                raise validation("A claim correction needs claim_id.") from None
            if (
                text is None
                and state is None
                and "valid_from" not in body
                and "valid_to" not in body
                and "supersedes_claim_id" not in body
            ):
                raise validation("A claim correction needs text, epistemic_state, validity, or supersession.")
            if text is not None and (not isinstance(text, str) or not text.strip()):
                raise validation("text must be non-empty when present.")
            if state is not None and state not in (
                "reported",
                "uncertain",
                "question",
                "confirmed_by_user",
                "superseded",
                "retracted",
            ):
                raise validation("Invalid epistemic_state.")
            try:
                valid_from = _optional_time(body.get("valid_from"))
                valid_to = _optional_time(body.get("valid_to"))
            except ValueError:
                raise validation("valid_from and valid_to must be RFC 3339 timestamps or null.") from None
            if valid_from is not None and valid_to is not None and valid_from > valid_to:
                raise validation("valid_from must not be after valid_to.")
            try:
                supersedes_claim_id = _optional_uuid(body.get("supersedes_claim_id"))
            except ValueError:
                raise validation("supersedes_claim_id must be a UUID or null.") from None
        else:
            claim_id = None
            valid_from = valid_to = None
            supersedes_claim_id = None
        if target == "transcription":
            try:
                page_id = uuid.UUID(str(body.get("page_id")))
            except (TypeError, ValueError):
                raise validation("A transcription correction needs page_id.") from None
            if not isinstance(text, str) or not text.strip():
                raise validation("A transcription correction needs text.")
        else:
            page_id = None
        digest = request_digest({"memory_id": str(memory_id), "expected_revision": expected_revision, "body": body})

        def run(tx: Tx) -> dict[str, Any]:
            memory = tx.one(
                "select * from memories where workspace_id=%s and id=%s for update", (tx.workspace_id, memory_id)
            )
            if memory is None:
                raise not_found("Memory not found.")
            existing = tx.one(
                "select request_digest from idempotency_records where workspace_id=%s and actor_id=%s and "
                "operation_family='memory.correct' and idempotency_key=%s",
                (tx.workspace_id, tx.user_id, idempotency_key),
            )
            if existing is not None:
                if existing["request_digest"] != digest:
                    raise ApiError(
                        "IDEMPOTENCY_CONFLICT", "This idempotency key was used for a different request.", 409
                    )
                return {"memory_id": str(memory_id), "revision": memory["current_revision"], "replayed": True}
            if memory["current_revision"] != expected_revision:
                raise ApiError(
                    "VERSION_CONFLICT",
                    "Memory changed elsewhere; reload and try again.",
                    409,
                    details={"current_version": memory["current_revision"]},
                )
            previous = tx.one(
                "select * from memory_revisions where memory_id=%s and revision=%s", (memory_id, expected_revision)
            )
            assert previous is not None
            next_revision = expected_revision + 1
            extraction = copy.deepcopy(previous["extraction"])
            if target == "summary":
                extraction["summary"] = text
                extraction["summary_evidence"] = []
                tx.run(
                    "insert into memory_overrides (workspace_id,memory_id,claim_id,target_key,field,value,created_by) values (%s,%s,null,%s,'summary',%s,%s) "
                    "on conflict (memory_id,field,target_key) do update set value=excluded.value,created_by=excluded.created_by,created_at=now()",
                    (tx.workspace_id, memory_id, uuid.UUID(int=0), text, tx.user_id),
                )
            elif target == "transcription":
                changed = False
                for page in extraction["pages"]:
                    if page["page_id"] == str(page_id):
                        page["transcription"] = text
                        changed = True
                if not changed:
                    raise not_found("Source page not found in this memory.")
                tx.run(
                    "insert into memory_overrides (workspace_id,memory_id,claim_id,target_key,field,value,created_by) "
                    "values (%s,%s,null,%s,'transcription',%s,%s) "
                    "on conflict (memory_id,field,target_key) do update set value=excluded.value,created_by=excluded.created_by,created_at=now()",
                    (tx.workspace_id, memory_id, page_id, text, tx.user_id),
                )
            elif target == "mention_identity":
                try:
                    mention_id = uuid.UUID(str(body.get("mention_id")))
                except (TypeError, ValueError):
                    raise validation("mention_identity needs mention_id.") from None
                resolution = body.get("resolution")
                if resolution not in ("accepted", "rejected"):
                    raise validation("resolution must be accepted or rejected.")
                mention = tx.one(
                    "select * from mentions where workspace_id=%s and memory_id=%s and id=%s for update",
                    (tx.workspace_id, memory_id, mention_id),
                )
                if mention is None:
                    raise not_found("Mention not found.")
                entity_id = body.get("entity_id")
                if resolution == "accepted":
                    try:
                        entity_uuid = uuid.UUID(str(entity_id))
                    except (TypeError, ValueError):
                        raise validation("Accepted identity needs entity_id.") from None
                    entity = tx.one(
                        "select id from entities where workspace_id=%s and id=%s", (tx.workspace_id, entity_uuid)
                    )
                    if entity is None:
                        raise not_found("Entity not found.")
                else:
                    entity_uuid = None
                tx.run(
                    "update mentions set entity_id=%s,resolution_status=%s,version=version+1 where id=%s",
                    (entity_uuid, resolution, mention_id),
                )
            elif target == "relationship":
                try:
                    from_id, to_id = (
                        uuid.UUID(str(body.get("from_entity_id"))),
                        uuid.UUID(str(body.get("to_entity_id"))),
                    )
                except (TypeError, ValueError):
                    raise validation("relationship needs from_entity_id and to_entity_id.") from None
                relation = body.get("relation_type")
                resolution = body.get("resolution")
                if (
                    not isinstance(relation, str)
                    or not 1 <= len(relation.strip()) <= 100
                    or resolution not in ("accepted", "rejected")
                ):
                    raise validation("relationship needs relation_type and resolution.")
                count = tx.one(
                    "select count(*) as n from entities where workspace_id=%s and id=any(%s)",
                    (tx.workspace_id, [from_id, to_id]),
                )
                if count is None or count["n"] != 2:
                    raise not_found("Relationship entity not found.")
                prior_link = tx.one(
                    "select valid_from,valid_to from entity_links where workspace_id=%s "
                    "and from_entity_id=%s and to_entity_id=%s and relation_type=%s",
                    (tx.workspace_id, from_id, to_id, relation),
                )
                try:
                    start = (
                        _optional_time(body.get("valid_from"))
                        if "valid_from" in body
                        else (prior_link or {}).get("valid_from")
                    )
                    end = (
                        _optional_time(body.get("valid_to"))
                        if "valid_to" in body
                        else (prior_link or {}).get("valid_to")
                    )
                except ValueError:
                    raise validation("Relationship validity needs RFC 3339 timestamps.") from None
                if start and end and start > end:
                    raise validation("valid_from must not be after valid_to.")
                tx.run(
                    "insert into entity_links (id,workspace_id,from_entity_id,to_entity_id,relation_type,status,evidence,valid_from,valid_to) "
                    "values (%s,%s,%s,%s,%s,%s,'[]',%s,%s) on conflict (workspace_id,from_entity_id,to_entity_id,relation_type) "
                    "do update set status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,version=entity_links.version+1",
                    (uuid.uuid4(), tx.workspace_id, from_id, to_id, relation, resolution, start, end),
                )
            else:
                claim = tx.one(
                    "select * from claims where workspace_id=%s and memory_id=%s and id=%s for update",
                    (tx.workspace_id, memory_id, claim_id),
                )
                if claim is None:
                    raise not_found("Claim not found.")
                current = tx.one(
                    "select * from claim_revisions where claim_id=%s and version=%s",
                    (claim_id, claim["current_version"]),
                )
                assert current is not None
                effective_from = valid_from if "valid_from" in body else current["valid_from"]
                effective_to = valid_to if "valid_to" in body else current["valid_to"]
                effective_supersedes = (
                    supersedes_claim_id if "supersedes_claim_id" in body else current["supersedes_claim_id"]
                )
                if effective_from and effective_to and effective_from > effective_to:
                    raise validation("valid_from must not be after valid_to.")
                if effective_supersedes:
                    predecessor = tx.one(
                        "select id from claims where workspace_id=%s and id=%s", (tx.workspace_id, effective_supersedes)
                    )
                    if predecessor is None or effective_supersedes == claim_id:
                        raise validation("supersedes_claim_id must reference another claim in this workspace.")
                next_claim_version = claim["current_version"] + 1
                corrected_text = text if isinstance(text, str) else current["text"]
                corrected_state = state if isinstance(state, str) else current["epistemic_state"]
                for statement in extraction["statements"]:
                    if statement["evidence"] == current["evidence"]:
                        statement["text"] = corrected_text
                        statement["epistemic_state"] = corrected_state
                tx.run(
                    "update claims set current_version=%s,updated_at=now() where id=%s", (next_claim_version, claim_id)
                )
                tx.run(
                    "insert into claim_revisions (workspace_id,claim_id,memory_id,version,memory_revision,origin,kind,text,value_text,epistemic_state,attribution_text,temporal_text,valid_from,valid_to,supersedes_claim_id,evidence,supersedes_version,created_by) "
                    "values (%s,%s,%s,%s,%s,'user',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        tx.workspace_id,
                        claim_id,
                        memory_id,
                        next_claim_version,
                        next_revision,
                        current["kind"],
                        corrected_text,
                        None if isinstance(text, str) else current["value_text"],
                        corrected_state,
                        current["attribution_text"],
                        current["temporal_text"],
                        effective_from,
                        effective_to,
                        effective_supersedes,
                        json.dumps(current["evidence"]),
                        current["version"],
                        tx.user_id,
                    ),
                )
                field, value = (
                    ("claim_text", corrected_text)
                    if isinstance(text, str)
                    else ("claim_epistemic_state", corrected_state)
                )
                tx.run(
                    "insert into memory_overrides (workspace_id,memory_id,claim_id,target_key,field,value,created_by) values (%s,%s,%s,%s,%s,%s,%s) "
                    "on conflict (memory_id,field,target_key) do update set value=excluded.value,created_by=excluded.created_by,created_at=now()",
                    (tx.workspace_id, memory_id, claim_id, claim_id, field, value, tx.user_id),
                )
            tx.run(
                "update search_chunks set eligible=false where workspace_id=%s and memory_id=%s",
                (tx.workspace_id, memory_id),
            )
            tx.run("update memories set current_revision=%s,updated_at=now() where id=%s", (next_revision, memory_id))
            tx.run(
                "insert into memory_revisions (workspace_id,memory_id,revision,origin,job_id,processor_version,model_id,summary,extraction,validation) "
                "values (%s,%s,%s,'user',null,%s,%s,%s,%s,%s)",
                (
                    tx.workspace_id,
                    memory_id,
                    next_revision,
                    previous["processor_version"],
                    previous["model_id"],
                    extraction.get("summary"),
                    json.dumps(extraction),
                    json.dumps(
                        {
                            "notes": [{"code": "USER_CORRECTION", "reason": body.get("reason")}],
                            "needs_review": False,
                            "correction": {
                                "actor_id": str(tx.user_id),
                                "expected_revision": expected_revision,
                                "target": target,
                                "body": body,
                            },
                        }
                    ),
                ),
            )
            from ..ingestion.projection import write_search_chunks

            cap = tx.one(
                "select * from captures where workspace_id=%s and id=%s", (tx.workspace_id, memory["capture_id"])
            )
            assert cap is not None
            sources = tx.all(
                "select * from source_objects where workspace_id=%s and capture_id=%s", (tx.workspace_id, cap["id"])
            )
            write_search_chunks(
                tx, memory_id, next_revision, cap, extraction, {str(source["id"]): source for source in sources}
            )
            CaptureService._record_idempotency(tx, "memory.correct", idempotency_key, digest, memory_id)
            return {"memory_id": str(memory_id), "revision": next_revision, "replayed": False}

        return self._guard(user_id, run)  # type: ignore[no-any-return]

    def list_actions(self, user_id: uuid.UUID, status: str | None) -> dict[str, Any]:
        if status is not None and status not in ("suggested", "open", "done", "cancelled"):
            raise validation("Invalid action status.")

        def run(tx: Tx) -> dict[str, Any]:
            rows = tx.all(
                "select id,memory_id,text,status,due_text,version,created_at,updated_at from actions where workspace_id=%s and (%s::text is null or status=%s) order by updated_at desc",
                (tx.workspace_id, status, status),
            )
            return {
                "items": [
                    {
                        **{
                            k: (str(r[k]) if k in ("id", "memory_id") else r[k])
                            for k in ("id", "memory_id", "text", "status", "due_text", "version")
                        },
                        "created_at": r["created_at"].isoformat(),
                        "updated_at": r["updated_at"].isoformat(),
                    }
                    for r in rows
                ]
            }

        return self._guard(user_id, run)  # type: ignore[no-any-return]

    def get_memory(self, user_id: uuid.UUID, memory_id: uuid.UUID) -> dict[str, Any]:
        return self._guard(user_id, lambda tx: self._memory_view(tx, memory_id))  # type: ignore[no-any-return]

    def update_action(
        self, user_id: uuid.UUID, action_id: uuid.UUID, idempotency_key: str, expected_version: int, body: Any
    ) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {"status", "text"}:
            raise validation("Action update has unknown fields.")
        if body.get("status") not in ("suggested", "open", "done", "cancelled"):
            raise validation("Invalid action status.")
        if "text" in body and (not isinstance(body["text"], str) or not body["text"].strip()):
            raise validation("text must be non-empty when present.")
        digest = request_digest({"action_id": str(action_id), "expected_version": expected_version, "body": body})

        def run(tx: Tx) -> dict[str, Any]:
            action = tx.one(
                "select * from actions where workspace_id=%s and id=%s for update", (tx.workspace_id, action_id)
            )
            if action is None:
                raise not_found("Action not found.")
            prior = tx.one(
                "select request_digest from idempotency_records where workspace_id=%s and actor_id=%s "
                "and operation_family='action.update' and idempotency_key=%s",
                (tx.workspace_id, tx.user_id, idempotency_key),
            )
            if prior is not None:
                if prior["request_digest"] != digest:
                    raise ApiError(
                        "IDEMPOTENCY_CONFLICT", "This idempotency key was used for a different request.", 409
                    )
                return {
                    "action_id": str(action_id),
                    "version": action["version"],
                    "status": action["status"],
                    "replayed": True,
                }
            if action["version"] != expected_version:
                raise ApiError(
                    "VERSION_CONFLICT",
                    "Action changed elsewhere; reload and try again.",
                    409,
                    details={"current_version": action["version"]},
                )
            tx.run(
                "update actions set status=%s,text=%s,version=version+1,updated_at=now() where id=%s",
                (body["status"], body.get("text", action["text"]), action_id),
            )
            CaptureService._record_idempotency(tx, "action.update", idempotency_key, digest, action_id)
            return {
                "action_id": str(action_id),
                "version": expected_version + 1,
                "status": body["status"],
                "replayed": False,
            }

        return self._guard(user_id, run)  # type: ignore[no-any-return]

    def _embedding_query(self, user_id: uuid.UUID, question: str) -> tuple[list[float] | None, EmbeddingConfig | None]:
        """Reserve, call, and settle a semantic query outside database transactions.

        Keyword/entity retrieval remains the truthful fallback for every unavailable semantic
        condition.  This method intentionally never converts an unavailable provider into a
        locally fabricated query vector.
        """
        estimated_tokens = max(1, len(question.encode("utf-8")))
        if estimated_tokens > self.settings.embedding_max_batch_tokens:
            return None, None

        def reserve(tx: Tx) -> tuple[EmbeddingConfig, uuid.UUID] | None:
            config = configured_embedding(tx, self.settings)
            if config is None or not vector_index_available(tx) or not processing.consent_active(tx, self.settings):
                return None
            reservation = reserve_embedding_budget(
                tx, self.settings, config, purpose="query", input_tokens=estimated_tokens
            )
            return config, reservation

        try:
            reserved = self._guard(user_id, reserve)
        except EmbeddingProviderError:
            return None, None
        if reserved is None:
            return None, None
        config, reservation_id = reserved
        provider = self.embedding_provider
        if provider is None or provider.config != config:
            provider = VoyageEmbeddingProvider(config)
        result: EmbeddingResult | None = None
        try:
            result = provider.embed([question], input_type="query")
        except (EmbeddingProviderError, httpx.HTTPError, ValueError):
            result = None
        # The reservation is released or converted to actual usage in a fresh transaction, even
        # when the provider times out. No network work is done while a transaction is open.
        try:
            self._guard(
                user_id,
                lambda tx: finalize_embedding_reservation(tx, reservation_id, result, config=config),
            )
        except EmbeddingProviderError:
            return None, None
        if result is None:
            return None, None
        return result.vectors[0], config

    def _hybrid_hits(
        self,
        user_id: uuid.UUID,
        question: str,
        limit: int,
        *,
        entity_ids: list[str] | None = None,
        as_of: str | None = None,
        temporal_mode: str | None = None,
        temporal_cutoff: datetime | None = None,
    ) -> list[dict[str, Any]]:
        if temporal_mode is not None:
            # Canonical history has no current-vector or current-identity dependency.
            # It is deliberately a keyword/evidence lane until historical vectors exist.
            hits = self._guard(
                user_id,
                lambda tx: temporal_claim_search(tx, question, limit, mode=temporal_mode, cutoff=temporal_cutoff),
            )
            return list(hits)
        vector, config = (None, None) if as_of is not None else self._embedding_query(user_id, question)

        def retrieve(tx: Tx) -> list[dict[str, Any]]:
            active_vector = (
                vector
                if config is not None
                and processing.consent_active(tx, self.settings)
                and configured_embedding(tx, self.settings) == config
                else None
            )
            try:
                return hybrid_search(
                    tx,
                    question,
                    limit,
                    entity_ids=entity_ids or (),
                    as_of=as_of,
                    query_vector=active_vector,
                    embedding_config=config,
                )
            except SemanticIndexUnavailable:
                return hybrid_search(tx, question, limit, entity_ids=entity_ids or (), as_of=as_of)

        return self._guard(user_id, retrieve)  # type: ignore[no-any-return]

    def search(self, user_id: uuid.UUID, q: str, limit: int) -> dict[str, Any]:
        if not q.strip():
            raise validation("q must not be empty.")
        hits = self._hybrid_hits(user_id, q, limit)
        return {"query": q, "results": [{k: v for k, v in h.items() if k != "text"} for h in hits]}

    def _finalize_ask(
        self, user_id: uuid.UUID, hits: list[dict[str, Any]], result: Any, *, historical: bool
    ) -> str | None:
        """Re-authorize provider output before it can leave the service or create usage.

        The database transaction takes the same workspace lock as destructive operations.
        It therefore either observes the deletion/revocation and discards the result, or
        completes before the deletion transaction removes the just-recorded usage.
        """

        def finalize(tx: Tx) -> str | None:
            if not processing.consent_active(tx, self.settings):
                return "CONSENT_REVOKED"
            for hit in hits[: ask_module.PACKET_SIZE]:
                row = tx.one(
                    "select m.current_revision from memories m "
                    "join captures cap on cap.workspace_id=m.workspace_id and cap.id=m.capture_id "
                    "join memory_revisions mr on mr.memory_id=m.id and mr.revision=%s "
                    "where m.workspace_id=%s and m.id=%s and cap.id=%s",
                    (hit["memory_revision"], tx.workspace_id, hit["memory_id"], hit["capture_id"]),
                )
                if row is None:
                    return "EVIDENCE_DELETED"
                if not historical and row["current_revision"] != hit["memory_revision"]:
                    return "EVIDENCE_CHANGED"
                if (
                    hit.get("source_id")
                    and tx.one(
                        "select 1 from source_objects where workspace_id=%s and id=%s and capture_id=%s",
                        (tx.workspace_id, hit["source_id"], hit["capture_id"]),
                    )
                    is None
                ):
                    return "EVIDENCE_DELETED"
            if result is not None:
                tx.run(
                    "insert into ai_usage (id, workspace_id, job_id, purpose, model_id, input_tokens, output_tokens, "
                    "estimated_cost_usd) values (%s,%s,null,'answer',%s,%s,%s,%s)",
                    (
                        uuid.uuid4(),
                        tx.workspace_id,
                        result.model_id if result.model_id != "unknown" else (self.settings.ai_model_id or "unknown"),
                        result.input_tokens,
                        result.output_tokens,
                        processing.estimate_cost(self.settings, result.input_tokens, result.output_tokens),
                    ),
                )
            return None

        try:
            # Never auto-provision after a workspace erase; that could recreate state
            # solely because an old provider request happened to finish late.
            with self.db.tx(user_id, provision=False) as tx:
                return finalize(tx)
        except LookupError:
            return "WORKSPACE_ERASED"

    # ------------------------------------------------------------------ ask
    def ask(self, user_id: uuid.UUID, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {"question", "conversation_id", "entity_ids", "as_of"}:
            raise validation("Unknown fields in the ask request.")
        question = body.get("question")
        if not isinstance(question, str) or not 1 <= len(question.strip()) <= 1000:
            raise validation("question must be 1-1000 characters.")
        entity_ids = body.get("entity_ids")
        as_of = body.get("as_of")
        natural_mode, temporal_cutoff, temporal_note = infer_temporal_request(question)
        requested_mode, _ = infer_temporal_mode(question)
        if body.get("conversation_id") is not None:
            raise validation("conversation_id is not supported yet.")
        if entity_ids is not None and (
            not isinstance(entity_ids, list)
            or len(entity_ids) > 20
            or not all(isinstance(value, str) for value in entity_ids)
        ):
            raise validation("entity_ids must be an array of UUID strings.")
        if entity_ids:
            try:
                entity_ids = [str(uuid.UUID(value)) for value in entity_ids]
            except (ValueError, TypeError):
                raise validation("entity_ids must be UUID strings.") from None
        if as_of is not None and not isinstance(as_of, str):
            raise validation("as_of must be an ISO-8601 timestamp.")
        if as_of is not None:
            try:
                validate_as_of(as_of)
            except ValueError as exc:
                raise validation(str(exc)) from exc
        if as_of is not None and entity_ids:
            raise validation("entity_ids cannot be used with as_of because identity resolution is current-state only.")
        if natural_mode is not None and entity_ids:
            raise validation(
                "entity_ids cannot be used with historical questions because identity resolution is current-state only."
            )

        def retrieve(tx: Tx) -> tuple[list[dict[str, Any]], bool, bool, str | None]:
            hits: list[dict[str, Any]] = []
            consent = processing.consent_active(tx, self.settings)
            budget = self.settings.ai_configured and processing.budget_available(self.settings, *processing.spend(tx))
            latest = tx.one(
                "select max(created_at) as t from memory_revisions where workspace_id=%s", (tx.workspace_id,)
            )
            index_as_of = latest["t"].isoformat() if latest and latest["t"] else None
            return hits, consent, bool(budget), index_as_of

        _, consent, budget_ok, index_as_of = self._guard(user_id, retrieve)
        if temporal_note:
            return {
                "question": question,
                "index_as_of": index_as_of,
                "mode": "sources_only",
                "status": "insufficient_evidence",
                "answer": None,
                "sentences": [],
                "citations": [],
                "sources": [],
                "limitations": [temporal_note],
                "reason": "AMBIGUOUS_TIME",
            }
        try:
            hits = self._hybrid_hits(
                user_id,
                question,
                20,
                entity_ids=entity_ids,
                as_of=as_of,
                temporal_mode=natural_mode if as_of is None else None,
                temporal_cutoff=temporal_cutoff,
            )
        except ValueError as exc:
            raise validation(str(exc)) from exc
        # Embedding retrieval can involve external I/O; authorize synthesis
        # against fresh consent/budget state immediately before dispatch.
        _, consent, budget_ok, index_as_of = self._guard(user_id, retrieve)
        base = {
            "question": question,
            "index_as_of": index_as_of,
            "mode": "online_grounded",
            "sources": ask_module.sources_of(hits[: ask_module.PACKET_SIZE]),
        }
        if requested_mode or natural_mode:
            base["temporal_mode"] = natural_mode or requested_mode
        if not hits:
            return {
                **base,
                "status": "insufficient_evidence",
                "answer": None,
                "sentences": [],
                "citations": [],
                "limitations": ["Nothing in your saved captures matches this yet."],
                "reason": "NO_EVIDENCE",
            }
        if self.provider is None or not self.settings.ai_configured or not consent or not budget_ok:
            reason = (
                "AI_NOT_CONFIGURED"
                if (self.provider is None or not self.settings.ai_configured)
                else ("CONSENT_REQUIRED" if not consent else "BUDGET_EXHAUSTED")
            )
            return {
                **base,
                "mode": "sources_only",
                "status": "unavailable",
                "answer": None,
                "sentences": [],
                "citations": [],
                "limitations": ["Answers are off; these are the closest matching sources."],
                "reason": reason,
            }
        body_out, result = ask_module.answer(self.provider, question, hits)
        discarded = self._finalize_ask(
            user_id,
            hits,
            result,
            historical=as_of is not None or natural_mode is not None,
        )
        if discarded is not None:
            reason = "CONSENT_REQUIRED" if discarded == "CONSENT_REVOKED" else discarded
            return {
                **base,
                "mode": "sources_only",
                "status": "unavailable",
                "answer": None,
                "sentences": [],
                "citations": [],
                "sources": [],
                "limitations": ["The matching evidence changed before this answer could be returned."],
                "reason": reason,
            }
        return {**base, **body_out}


def _memory_summary(r: Row) -> dict[str, Any]:
    return {
        "memory_id": str(r["id"]),
        "capture_id": str(r["capture_id"]),
        "revision": r["current_revision"],
        "status": r["status"],
        "summary": r["summary"],
        "context_hint": r["context_hint"],
        "captured_at": r["captured_at"].isoformat(),
        "page_count": r["page_count"],
        "model_id": r["model_id"],
        "created_at": r["created_at"].isoformat(),
    }


def _optional_uuid(value: Any) -> uuid.UUID | None:
    if value is None:
        return None
    return uuid.UUID(str(value))


def _optional_time(value: Any) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("not a timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp lacks offset")
    return parsed
