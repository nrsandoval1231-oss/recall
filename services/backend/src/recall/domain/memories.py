"""RCL-002 commands: AI consent settings, memories, search, Ask, and processing retry."""

from __future__ import annotations

import uuid
from typing import Any

from ..config import Settings
from ..db.database import Database, Row, Tx
from ..errors import ApiError, forbidden, not_found, validation
from ..ingestion.provider import Provider
from ..retrieval import ask as ask_module
from ..retrieval.search import search
from . import processing
from .tokens import TokenError, decode_cursor, encode_cursor

AI_EXPLANATION = (
    "When on, Recall sends a processed copy of each saved page (orientation fixed, metadata removed) to "
    "the configured AI provider to transcribe and organise it, and sends matching excerpts when you ask a "
    "question. Originals stay in Recall's private storage. Turning this off stops new processing."
)


class MemoryService:
    def __init__(self, db: Database, settings: Settings, provider: Provider | None) -> None:
        self.db = db
        self.settings = settings
        self.provider = provider

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
            "ai_configured": self.settings.ai_configured,
            "provider": self.settings.ai_provider,
            "policy_version": self.settings.ai_policy_version,
            "enabled": active,
            "consent_outdated": bool(row and row["enabled"] and not active),
            "decided_at": row["decided_at"].isoformat() if row else None,
            "version": row["version"] if row else 0,
            "explanation": AI_EXPLANATION,
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
        if enabled and not self.settings.ai_configured:
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
            provider = self.settings.ai_provider or "none"
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
                for cap in tx.all(
                    "select id from captures where workspace_id=%s and status='stored'", (tx.workspace_id,)
                ):
                    processing.enqueue_capture(tx, self.settings, cap["id"])
            else:
                tx.run(
                    "update processing_jobs set status='cancelled', last_error_code='CONSENT_REVOKED', "
                    "finished_at=now(), "
                    "updated_at=now() where workspace_id=%s and status='queued'",
                    (tx.workspace_id,),
                )
            return self._settings_view(tx)

        return self._guard(user_id, run)  # type: ignore[no-any-return]

    # ------------------------------------------------------------------ processing retry
    def retry_processing(self, user_id: uuid.UUID, capture_id: uuid.UUID) -> dict[str, Any]:
        def run(tx: Tx) -> dict[str, Any]:
            cap = tx.one(
                "select id, status from captures where workspace_id=%s and id=%s", (tx.workspace_id, capture_id)
            )
            if cap is None:
                raise not_found("Capture not found.")
            job = tx.one(
                "select * from processing_jobs where workspace_id=%s and capture_id=%s order by created_at desc "
                "limit 1 for update",
                (tx.workspace_id, capture_id),
            )
            if job is not None and job["status"] in ("queued", "leased"):
                return {"capture_id": str(capture_id), "processing": processing.processing_view(job)}  # replay
            if not processing.consent_active(tx, self.settings) or not self.settings.ai_configured:
                raise ApiError("AI_NOT_CONFIGURED", "Turn on AI processing to read this capture.", 409)
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
            latest = tx.one(
                "select * from processing_jobs where workspace_id=%s and capture_id=%s order by created_at desc "
                "limit 1",
                (tx.workspace_id, capture_id),
            )
            return {"capture_id": str(capture_id), "processing": processing.processing_view(latest)}

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

    def get_memory(self, user_id: uuid.UUID, memory_id: uuid.UUID) -> dict[str, Any]:
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
            ex = row["extraction"]
            ex.pop("_derivatives", None)
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
                "labels": {
                    "transcription": "Machine reading of the original. Check the original for anything important.",
                    "action_suggestions": "Suggestions only. Nothing has been scheduled or sent.",
                },
            }

        return self._guard(user_id, run)  # type: ignore[no-any-return]

    def search(self, user_id: uuid.UUID, q: str, limit: int) -> dict[str, Any]:
        if not q.strip():
            raise validation("q must not be empty.")
        hits = self._guard(user_id, lambda tx: search(tx, q, limit))
        return {"query": q, "results": [{k: v for k, v in h.items() if k != "text"} for h in hits]}

    # ------------------------------------------------------------------ ask
    def ask(self, user_id: uuid.UUID, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {"question", "conversation_id", "entity_ids", "as_of"}:
            raise validation("Unknown fields in the ask request.")
        question = body.get("question")
        if not isinstance(question, str) or not 1 <= len(question.strip()) <= 1000:
            raise validation("question must be 1-1000 characters.")
        if body.get("conversation_id") is not None or body.get("entity_ids") or body.get("as_of") is not None:
            raise validation("conversation_id, entity_ids and as_of are not supported yet.")

        def retrieve(tx: Tx) -> tuple[list[dict[str, Any]], bool, bool, str | None]:
            hits = search(tx, question, 20)
            consent = processing.consent_active(tx, self.settings)
            budget = self.settings.ai_configured and processing.budget_available(self.settings, *processing.spend(tx))
            latest = tx.one(
                "select max(created_at) as t from memory_revisions where workspace_id=%s", (tx.workspace_id,)
            )
            index_as_of = latest["t"].isoformat() if latest and latest["t"] else None
            return hits, consent, bool(budget), index_as_of

        hits, consent, budget_ok, index_as_of = self._guard(user_id, retrieve)
        base = {
            "question": question,
            "index_as_of": index_as_of,
            "mode": "online_grounded",
            "sources": ask_module.sources_of(hits[: ask_module.PACKET_SIZE]),
        }
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
        if result is not None:

            def record(tx: Tx) -> None:
                tx.run(
                    "insert into ai_usage (id, workspace_id, job_id, purpose, model_id, input_tokens, output_tokens, "
                    "estimated_cost_usd) values (%s,%s,null,'answer',%s,%s,%s,%s)",
                    (
                        uuid.uuid4(),
                        tx.workspace_id,
                        result.model_id,
                        result.input_tokens,
                        result.output_tokens,
                        processing.estimate_cost(self.settings, result.input_tokens, result.output_tokens),
                    ),
                )

            self._guard(user_id, record)
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
