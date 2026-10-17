"""Revision-safe native Markdown records; originals never depend on a desktop process."""

from __future__ import annotations

import base64
import builtins
import hashlib
import re
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field

from ..config import Settings
from ..db.database import Database, Tx
from ..domain import processing
from ..domain.content import validate_content
from ..errors import ApiError, not_found, validation
from ..ingestion.provider import Provider
from ..retrieval import ask as grounded_ask
from ..storage import ObjectStore


class ImportedRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1, le=10000)
    note: str = Field(max_length=262144)
    recorded_at: datetime
    origin: Literal["human:recall", "human:obsidian", "model:claude"]
    kind: Literal["capture", "correct", "external", "restore", "remove", "organize", "restore_deleted"]


class Mutation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_vault_id: uuid.UUID | None = None
    operation_id: uuid.UUID
    memory_id: uuid.UUID
    expected_revision: int = Field(ge=0, le=9007199254740990)
    action: Literal["capture", "correct", "remove", "restore", "import"]
    note: str = Field(default="", max_length=262144)
    source_base64: str | None = Field(default=None, max_length=35_000_000)
    source_name: str = Field(default="note.txt", min_length=1, max_length=255)
    mime_type: Literal["text/plain", "text/markdown", "image/png", "image/jpeg", "image/heic", "image/heif"] = (
        "text/plain"
    )
    source_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    captured_at: datetime | None = None
    note_path: str | None = Field(default=None, max_length=255)
    history: list[ImportedRevision] | None = Field(default=None, max_length=10000)
    processing_consent: bool = False


def record(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "revision": row["revision"],
        "state": row["state"],
        "note": row["note"],
        "note_path": row["note_path"],
        "source_name": row["source_name"],
        "source_sha256": row["source_sha256"],
        "captured_at": row["captured_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
        "conflict": None,
        "processing": row.get("processing")
        or {
            "state": "consent-required",
            "message": "Original saved. Choose processing to send this source to the configured AI provider.",
        },
    }


class LibraryService:
    def __init__(self, db: Database, store: ObjectStore, settings: Settings, provider: Provider | None = None):
        self.db, self.store, self.settings = db, store, settings
        self.provider = provider

    def status(self, user: uuid.UUID) -> dict[str, Any]:
        with self.db.tx(user) as tx:
            scope = str(tx.workspace_id)
            return {"root": "MeGraph cloud library", "vault_id": scope, "vault_identity": scope}

    def list(self, user: uuid.UUID, include_deleted: bool = False) -> list[dict[str, Any]]:
        with self.db.tx(user) as tx:
            rows = tx.all(
                "select d.*, (select jsonb_build_object('state',p.state,'message',p.message) from library_processing p "
                "where p.workspace_id=d.workspace_id and p.memory_id=d.id) as processing "
                "from library_documents d where workspace_id=%s and (%s or state='active') order by "
                "captured_at desc,id limit 10001",
                (tx.workspace_id, include_deleted),
            )
            if len(rows) > 10000:
                raise ApiError(
                    "LIBRARY_LIMIT", "Filter or export this library before loading more than 10,000 records.", 413
                )
            return [record(row) for row in rows]

    def _get(self, tx: Tx, memory: uuid.UUID) -> dict[str, Any]:
        row = tx.one("select * from library_documents where workspace_id=%s and id=%s", (tx.workspace_id, memory))
        if row is None:
            raise not_found("Memory not found.")
        return row

    def source(self, user: uuid.UUID, memory: uuid.UUID) -> tuple[bytes, str, str]:
        with self.db.tx(user) as tx:
            row = self._get(tx, memory)
            data = b"".join(self.store.iter_bytes(row["source_key"]))
            if hashlib.sha256(data).hexdigest() != row["source_sha256"]:
                raise ApiError("SOURCE_INTEGRITY", "The stored original failed its integrity check.", 503)
            return data, row["mime_type"], row["source_sha256"]

    def history(self, user: uuid.UUID, memory: uuid.UUID) -> builtins.list[dict[str, Any]]:
        with self.db.tx(user) as tx:
            self._get(tx, memory)
            return [
                {**row, "recorded_at": row["recorded_at"].isoformat()}
                for row in tx.all(
                    "select revision,note,origin,kind,recorded_at from library_revisions where workspace_id=%s "
                    "and memory_id=%s order by revision desc",
                    (tx.workspace_id, memory),
                )
            ]

    def mutate(self, user: uuid.UUID, change: Mutation) -> dict[str, Any]:
        if len(change.note.encode()) > 262144:
            raise validation("Note exceeds 256 KiB.")
        # Preserve pre-enrichment operation fingerprints when consent is absent.
        digest = hashlib.sha256(
            change.model_dump_json(exclude={"processing_consent"} if not change.processing_consent else set()).encode()
        ).hexdigest()
        with self.db.tx(user) as tx:
            if change.expected_vault_id is not None and change.expected_vault_id != tx.workspace_id:
                raise ApiError("SCOPE_CHANGED", "The signed-in library changed. Your local edits are retained.", 409)
            prior = tx.one(
                "select * from library_operations where workspace_id=%s and operation_id=%s",
                (tx.workspace_id, change.operation_id),
            )
            if prior:
                if prior["request_sha256"] != digest:
                    raise ApiError(
                        "IDEMPOTENCY_CONFLICT", "This operation ID was already used for different content.", 409
                    )
                return dict(prior["response"])
            current = tx.one(
                "select * from library_documents where workspace_id=%s and id=%s", (tx.workspace_id, change.memory_id)
            )
            if (current["revision"] if current else 0) != change.expected_revision:
                raise ApiError(
                    "REVISION_CONFLICT",
                    "This memory changed on another device. Your edit has not been discarded.",
                    409,
                    details={"current": record(current) if current else None},
                )
            if change.action in ("capture", "import"):
                if current or change.expected_revision != 0:
                    raise ApiError("REVISION_CONFLICT", "A memory already uses this identifier.", 409)
                if any(c in change.source_name for c in ("/", "\\", "\x00")):
                    raise validation("Source name must be a filename, not a path.")
                try:
                    data = (
                        base64.b64decode(change.source_base64, validate=True)
                        if change.source_base64 is not None
                        else change.note.encode()
                    )
                except ValueError:
                    raise validation("Invalid source encoding.") from None
                if not data or len(data) > self.settings.max_page_bytes:
                    raise validation("Original must contain 1 byte to 25 MiB.")
                sha = hashlib.sha256(data).hexdigest()
                if change.source_sha256 and sha != change.source_sha256:
                    raise validation("Original bytes do not match their declared SHA-256.")
                note_path = change.note_path or f"{change.memory_id}.md"
                if any(c in note_path for c in ("/", "\\", "\x00")) or not note_path.endswith(".md"):
                    raise validation("Note path must be a Markdown basename.")
                if change.action == "import":
                    history = change.history or []
                    if not history or [item.revision for item in history] != list(range(1, len(history) + 1)):
                        raise validation("Import requires complete contiguous revision history.")
                    if (
                        history[0].kind != "capture"
                        or history[-1].note != change.note
                        or any(item.recorded_at.tzinfo is None for item in history)
                    ):
                        raise validation("Imported history does not match the memory or lacks timezone information.")
                elif change.history is not None:
                    raise validation("Only explicit import accepts existing history.")
                key = f"{tx.workspace_id}/library/{change.memory_id}/{sha}"
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "source"
                    path.write_bytes(data)
                    if change.mime_type.startswith("image/"):
                        validate_content(path, change.mime_type, max_pixels=self.settings.max_image_pixels)
                    else:
                        try:
                            data.decode("utf-8")
                        except UnicodeDecodeError:
                            raise validation("Text originals must be UTF-8.") from None
                    # Durable bytes precede the record; failed transactions leave only a private orphan.
                    self.store.put_if_absent(key, path, content_type=change.mime_type, sha256=sha)
                captured = change.captured_at or datetime.now(UTC)
                if captured.tzinfo is None:
                    raise validation("Capture timestamp must include its timezone.")
                history = (change.history or []) if change.action == "import" else []
                revision = len(history) if history else 1
                state = "deleted" if history and history[-1].kind == "remove" else "active"
                updated = history[-1].recorded_at if history else captured
                tx.run(
                    "insert into library_documents (workspace_id,id,revision,state,note,source_name,note_path,"
                    "source_sha256,source_key,mime_type,captured_at,updated_at) "
                    "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        tx.workspace_id,
                        change.memory_id,
                        revision,
                        state,
                        change.note,
                        change.source_name,
                        note_path,
                        sha,
                        key,
                        change.mime_type,
                        captured,
                        updated,
                    ),
                )
            else:
                if current is None:
                    raise not_found("Memory not found.")
                if change.source_base64 is not None or change.source_sha256 is not None:
                    raise validation("Original sources cannot be replaced by edits.")
                if change.action == "correct" and current["state"] != "active":
                    raise ApiError("REVISION_CONFLICT", "Restore this deleted memory before editing it.", 409)
                state = "deleted" if change.action == "remove" else "active"
                note = change.note if change.action == "correct" else current["note"]
                tx.run(
                    "update library_documents set note=%s,state=%s,revision=revision+1,updated_at=now() where "
                    "workspace_id=%s and id=%s",
                    (note, state, tx.workspace_id, change.memory_id),
                )
            row = self._get(tx, change.memory_id)
            if change.processing_consent:
                if change.action != "capture":
                    raise validation("Automatic source consent applies only to a new capture.")
                from .enrichment import authorize

                authorize(tx, row)
                row["processing"] = {
                    "state": "pending",
                    "message": "Original saved. Processing queued with source permission.",
                }
            if change.action == "import" and change.history:
                for item in change.history:
                    tx.run(
                        "insert into library_revisions "
                        "(workspace_id,memory_id,revision,note,state,origin,kind,recorded_at) "
                        "values (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (
                            tx.workspace_id,
                            change.memory_id,
                            item.revision,
                            item.note,
                            "deleted" if item.kind == "remove" else "active",
                            item.origin,
                            item.kind,
                            item.recorded_at,
                        ),
                    )
            else:
                tx.run(
                    "insert into library_revisions (workspace_id,memory_id,revision,note,state,origin,kind) "
                    "values (%s,%s,%s,%s,%s,'human:recall',%s)",
                    (tx.workspace_id, change.memory_id, row["revision"], row["note"], row["state"], change.action),
                )
            result = record(row)
            tx.run(
                "insert into library_operations values (%s,%s,%s,%s)",
                (tx.workspace_id, change.operation_id, digest, Jsonb(result)),
            )
            return result

    def ask(self, user: uuid.UUID, question: str) -> dict[str, Any]:
        words = set(re.findall(r"\w+", question.casefold())) - {"the", "a", "is", "what", "when", "where", "my", "i"}
        rows = self.list(user)
        ranked = sorted(rows, key=lambda row: sum(word in row["note"].casefold() for word in words), reverse=True)
        hits = []
        for row in ranked:
            if not any(word in row["note"].casefold() for word in words):
                continue
            raw, mime, sha = self.source(user, uuid.UUID(row["id"]))
            hits.append(
                {
                    "memory_id": row["id"],
                    "revision": row["revision"],
                    "note_basename": row["note_path"],
                    "current_excerpt": row["note"][:4000],
                    "original_excerpt": raw.decode("utf-8")[:4000]
                    if mime.startswith("text/")
                    else "Original image available for inspection.",
                    "source_sha256": sha,
                    "mime_type": mime,
                    "captured_at": row["captured_at"],
                    "updated_at": row["updated_at"],
                }
            )
            if len(hits) == 8:
                break
        response: dict[str, Any] = {
            "question": question,
            "message": "Keyword-only source retrieval; no AI answer was generated.",
            "hits": hits,
        }
        if not hits or self.provider is None or not self.settings.ai_configured:
            return response
        packet = [
            {
                "kind": "note",
                "page": 1,
                "captured_at": hit["captured_at"],
                "epistemic_state": "reported",
                "text": hit["current_excerpt"],
                "excerpt": hit["current_excerpt"],
                "memory_id": hit["memory_id"],
                "memory_revision": hit["revision"],
                "capture_id": hit["memory_id"],
                "source_id": hit["memory_id"],
            }
            for hit in hits
        ]
        try:
            with self.db.tx(user) as tx:
                reservation = processing.reserve_provider_budget(
                    tx,
                    self.settings,
                    purpose="answer",
                    model_id=self.settings.ai_model_id or "",
                    max_input_tokens=grounded_ask.answer_max_input_tokens(question, packet),
                    max_output_tokens=grounded_ask.MAX_ANSWER_OUTPUT_TOKENS,
                )
        except processing.BudgetReservationError:
            return response
        answer, usage = grounded_ask.answer(self.provider, question, packet)
        with self.db.tx(user) as tx:
            processing.finalize_provider_reservation(
                tx, self.settings, reservation, purpose="answer", job_id=None, result=usage, uncertain=usage is None
            )
            if not processing.consent_active(tx, self.settings):
                return {**response, "hits": [], "message": "AI permission changed while answering. Please retry."}
            for hit in hits:
                row = self._get(tx, uuid.UUID(hit["memory_id"]))
                if row["revision"] != hit["revision"] or row["state"] != "active":
                    return {**response, "hits": [], "message": "Evidence changed while answering. Please retry."}
        if answer.get("answer"):
            response["message"] = "AI-assisted answer: " + answer["answer"]
            response["citations"] = answer["citations"]
        return response
