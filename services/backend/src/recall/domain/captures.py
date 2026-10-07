"""RCL-001 application commands: devices, captures, uploads, finalization, original access.

State machine (server side): awaiting_upload -> stored, then (RCL-002, only with consent)
processing -> ready | needs_review | failed. Originals stay available in every state after stored.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import psycopg.errors

from ..config import Settings
from ..db.database import Database, Row, Tx
from ..errors import (
    ApiError,
    forbidden,
    hash_mismatch,
    idempotency_conflict,
    not_found,
    payload_too_large,
    source_unavailable,
    upload_incomplete,
    validation,
)
from ..storage import ObjectNotFound, ObjectStore, StoredObjectConflict, hash_stream
from . import processing
from .content import validate_content
from .manifest import request_digest
from .tokens import (
    TokenError,
    TokenExpired,
    UploadClaims,
    decode_cursor,
    encode_cursor,
    issue_upload_token,
    verify_upload_token,
)

PLATFORMS = ("ios", "android", "windows", "macos", "linux", "web")


@dataclass(frozen=True)
class UploadTarget:
    source_id: uuid.UUID
    capture_id: uuid.UUID
    media_type: str
    declared_byte_size: int
    declared_sha256: str
    storage_key: str


def _page_view(row: Row) -> dict[str, Any]:
    state = "verified" if row["verified_at"] else "received" if row["received_at"] else "pending"
    return {
        "source_id": str(row["id"]),
        "client_page_id": str(row["client_page_id"]),
        "ordinal": row["ordinal"],
        "media_type": row["media_type"],
        "byte_size": row["declared_byte_size"],
        "declared_sha256": row["declared_sha256"],
        "server_sha256": row["server_sha256"],
        "upload_state": state,
        "original_filename": row["original_filename"],
    }


def _capture_view(
    row: Row, pages: list[Row], job: Row | None = None, memory_id: uuid.UUID | None = None
) -> dict[str, Any]:
    def iso(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    return {
        "capture_id": str(row["id"]),
        "client_capture_id": str(row["client_capture_id"]),
        "status": row["status"],
        "source_kind": row["source_kind"],
        "captured_at": iso(row["captured_at"]),
        "timezone": row["timezone"],
        "context_hint": row["context_hint"],
        "created_at": iso(row["created_at"]),
        "stored_at": iso(row["stored_at"]),
        "version": row["version"],
        "memory_id": str(memory_id) if memory_id else None,
        "processing": processing.processing_view(job),
        "pages": [_page_view(p) for p in sorted(pages, key=lambda p: p["ordinal"])],
    }


class CaptureService:
    def __init__(self, db: Database, store: ObjectStore, settings: Settings) -> None:
        self.db = db
        self.store = store
        self.settings = settings

    # ------------------------------------------------------------------ identity
    def me(self, user_id: uuid.UUID, email: str | None) -> dict[str, Any]:
        rows: list[Row] = self._guard(
            user_id,
            lambda tx: tx.all(
                "select w.id, w.name, m.role from workspace_members m "
                "join workspaces w on w.id = m.workspace_id where m.user_id = %s order by m.created_at",
                (user_id,),
            ),
        )
        return {
            "user_id": str(user_id),
            "email": email,
            "workspaces": [{"id": str(r["id"]), "name": r["name"], "role": r["role"]} for r in rows],
            "active_workspace_id": str(rows[0]["id"]),
            "capabilities": {
                "capture": True,
                "ai_processing": self.settings.ai_configured,
                "accepted_media_types": ["image/jpeg", "image/png", "image/heic", "image/heif"],
                "max_pages_per_capture": self.settings.max_pages_per_capture,
                "max_page_bytes": self.settings.max_page_bytes,
                "max_capture_bytes": self.settings.max_capture_bytes,
            },
            "config": self._ai_config(user_id),
        }

    def _ai_config(self, user_id: uuid.UUID) -> dict[str, Any]:
        consent = self._guard(user_id, lambda tx: processing.consent_active(tx, self.settings))
        return {
            "ai_configured": self.settings.ai_configured,
            "ai_enabled": bool(consent and self.settings.ai_configured),
            "consent_required": self.settings.ai_configured and not consent,
        }

    def _guard(self, user_id: uuid.UUID, fn: Callable[[Tx], Any]) -> Any:
        try:
            with self.db.tx(user_id, provision=self.settings.auto_provision_workspaces) as tx:
                return fn(tx)
        except LookupError:
            raise forbidden("This account has no workspace.") from None

    # ------------------------------------------------------------------ devices
    def register_device(self, user_id: uuid.UUID, body: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        extra = set(body) - {"device_id", "platform", "name", "app_version"}
        try:
            device_id = uuid.UUID(str(body["device_id"]))
        except (KeyError, ValueError):
            raise validation("device_id must be a UUID.") from None
        platform = body.get("platform")
        name, version = body.get("name"), body.get("app_version")
        if extra or platform not in PLATFORMS:
            raise validation(f"platform must be one of {', '.join(PLATFORMS)}; no extra fields.")
        if not (name is None or isinstance(name, str) and len(name) <= 200) or not (
            version is None or isinstance(version, str) and len(version) <= 50
        ):
            raise validation("name/app_version are too long.")

        def attempt(tx: Tx) -> tuple[dict[str, Any], bool]:
            row = tx.one("select * from devices where id = %s and workspace_id = %s", (device_id, tx.workspace_id))
            created = row is None
            if row is None:
                row = tx.one(
                    "insert into devices (workspace_id, id, user_id, platform, name, app_version) "
                    "values (%s,%s,%s,%s,%s,%s) returning *",
                    (tx.workspace_id, device_id, tx.user_id, platform, name, version),
                )
            elif row["user_id"] != tx.user_id or row["platform"] != platform:
                raise ApiError("IDEMPOTENCY_CONFLICT", "This device ID is registered differently.", 409)
            else:
                row = tx.one(
                    "update devices set last_seen_at = now(), name = coalesce(%s, name), "
                    "app_version = coalesce(%s, app_version) where workspace_id=%s and id=%s returning *",
                    (name, version, tx.workspace_id, device_id),
                )
            assert row is not None
            return {
                "device_id": str(row["id"]),
                "platform": row["platform"],
                "name": row["name"],
                "app_version": row["app_version"],
                "registered_at": row["created_at"].isoformat(),
            }, created

        for _ in range(3):
            try:
                return self._guard(user_id, attempt)  # type: ignore[no-any-return]
            except psycopg.errors.UniqueViolation:
                continue
        raise ApiError("INTERNAL", "Could not register the device.", 500, retryable=True)

    # ------------------------------------------------------------------ create
    def create_capture(
        self, user_id: uuid.UUID, idempotency_key: str, manifest: dict[str, Any]
    ) -> tuple[dict[str, Any], bool]:
        digest = request_digest(manifest)

        def attempt(tx: Tx) -> tuple[dict[str, Any], bool]:
            ws = tx.workspace_id
            device = tx.one(
                "select 1 from devices where workspace_id=%s and id=%s and user_id=%s",
                (ws, uuid.UUID(manifest["device_id"]), user_id),
            )
            if device is None:
                raise ApiError("DEVICE_NOT_REGISTERED", "Register this device before creating captures.", 422)
            record = tx.one(
                "select request_digest, resource_id from idempotency_records where workspace_id=%s "
                "and actor_id=%s and operation_family='capture.create' and idempotency_key=%s",
                (ws, user_id, idempotency_key),
            )
            if record is not None:
                if record["request_digest"] != digest:
                    raise idempotency_conflict()
                return self._load_view(tx, record["resource_id"]), False
            existing = tx.one(
                "select id, request_digest from captures where workspace_id=%s and client_capture_id=%s",
                (ws, uuid.UUID(manifest["client_capture_id"])),
            )
            if existing is not None:
                if existing["request_digest"] != digest:
                    raise idempotency_conflict()
                self._record_idempotency(tx, "capture.create", idempotency_key, digest, existing["id"])
                return self._load_view(tx, existing["id"]), False

            capture_id = uuid.uuid4()
            tx.run(
                "insert into captures (id, workspace_id, client_capture_id, device_id, created_by, source_kind,"
                " captured_at, timezone, context_hint, page_count, request_digest) "
                "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    capture_id,
                    ws,
                    manifest["client_capture_id"],
                    manifest["device_id"],
                    user_id,
                    manifest["source_kind"],
                    manifest["captured_at"],
                    manifest["timezone"],
                    manifest["context_hint"],
                    len(manifest["pages"]),
                    digest,
                ),
            )
            for page in sorted(manifest["pages"], key=lambda p: p["ordinal"]):
                source_id = uuid.uuid4()
                key = f"workspaces/{ws}/captures/{capture_id}/sources/{source_id}/original"
                tx.run(
                    "insert into source_objects (id, workspace_id, capture_id, client_page_id, ordinal,"
                    " media_type, declared_byte_size, declared_sha256, original_filename, storage_key) "
                    "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        source_id,
                        ws,
                        capture_id,
                        page["client_page_id"],
                        page["ordinal"],
                        page["media_type"],
                        page["byte_size"],
                        page["sha256"],
                        page["original_filename"],
                        key,
                    ),
                )
            self._record_idempotency(tx, "capture.create", idempotency_key, digest, capture_id)
            return self._load_view(tx, capture_id), True

        for _ in range(3):
            try:
                return self._guard(user_id, attempt)  # type: ignore[no-any-return]
            except psycopg.errors.UniqueViolation:
                continue  # lost a race with a concurrent identical request; it has committed now
        raise ApiError("INTERNAL", "Could not create the capture.", 500, retryable=True)

    @staticmethod
    def _record_idempotency(tx: Tx, family: str, key: str, digest: str, resource_id: uuid.UUID) -> None:
        inserted = tx.one(
            "insert into idempotency_records (workspace_id, actor_id, operation_family, idempotency_key,"
            " request_digest, resource_id) values (%s,%s,%s,%s,%s,%s) "
            "on conflict do nothing returning 1 as ok",
            (tx.workspace_id, tx.user_id, family, key, digest, resource_id),
        )
        if inserted is None:
            row = tx.one(
                "select request_digest from idempotency_records where workspace_id=%s and actor_id=%s "
                "and operation_family=%s and idempotency_key=%s",
                (tx.workspace_id, tx.user_id, family, key),
            )
            if row is None or row["request_digest"] != digest:
                raise idempotency_conflict()

    @staticmethod
    def _load_view(tx: Tx, capture_id: uuid.UUID) -> dict[str, Any]:
        row = tx.one(
            "select * from captures where workspace_id=%s and id=%s and deleted_at is null",
            (tx.workspace_id, capture_id),
        )  # noqa: E501
        if row is None:
            raise not_found("Capture not found.")
        pages = tx.all(
            "select * from source_objects where workspace_id=%s and capture_id=%s", (tx.workspace_id, capture_id)
        )
        job, memory_id = _processing_state(tx, [capture_id]).get(capture_id, (None, None))
        return _capture_view(row, pages, job, memory_id)

    # ------------------------------------------------------------------ read
    def get_capture(self, user_id: uuid.UUID, capture_id: uuid.UUID) -> dict[str, Any]:
        return self._guard(user_id, lambda tx: self._load_view(tx, capture_id))  # type: ignore[no-any-return]

    def list_captures(self, user_id: uuid.UUID, limit: int, cursor: str | None) -> dict[str, Any]:
        def run(tx: Tx) -> dict[str, Any]:
            params: list[Any] = [tx.workspace_id]
            clause = ""
            if cursor:
                try:
                    created_at, last_id = decode_cursor(self.settings.signing_secret, tx.workspace_id, cursor)
                except TokenError:
                    raise validation("Invalid cursor.") from None
                clause = "and (created_at, id) < (%s, %s)"
                params += [created_at, last_id]
            rows = tx.all(
                f"select * from captures where workspace_id=%s and deleted_at is null {clause} "  # noqa: S608 - clause is a constant
                "order by created_at desc, id desc limit %s",
                (*params, limit + 1),
            )
            more = len(rows) > limit
            rows = rows[:limit]
            pages = tx.all(
                "select * from source_objects where workspace_id=%s and capture_id = any(%s)",
                (tx.workspace_id, [r["id"] for r in rows]),
            )
            by_capture: dict[uuid.UUID, list[Row]] = {}
            for page in pages:
                by_capture.setdefault(page["capture_id"], []).append(page)
            next_cursor = (
                encode_cursor(self.settings.signing_secret, tx.workspace_id, rows[-1]["created_at"], rows[-1]["id"])
                if more
                else None
            )
            state = _processing_state(tx, [r["id"] for r in rows])
            return {
                "items": [
                    _capture_view(r, by_capture.get(r["id"], []), *state.get(r["id"], (None, None))) for r in rows
                ],
                "next_cursor": next_cursor,
            }

        return self._guard(user_id, run)  # type: ignore[no-any-return]

    # ------------------------------------------------------------------ upload
    def authorize_uploads(
        self, user_id: uuid.UUID, capture_id: uuid.UUID, source_ids: list[uuid.UUID] | None
    ) -> dict[str, Any]:
        def run(tx: Tx) -> dict[str, Any]:
            view = self._load_view(tx, capture_id)
            pending = [p for p in view["pages"] if p["upload_state"] != "verified"]
            if source_ids is not None:
                known = {p["source_id"] for p in view["pages"]}
                if any(str(s) not in known for s in source_ids):
                    raise not_found("Source not found.")
                pending = [p for p in pending if uuid.UUID(p["source_id"]) in set(source_ids)]
            auths = []
            for page in pending:
                token, expires = issue_upload_token(
                    self.settings.signing_secret,
                    workspace_id=tx.workspace_id,
                    actor_id=user_id,
                    capture_id=capture_id,
                    source_id=uuid.UUID(page["source_id"]),
                    ttl_seconds=self.settings.upload_token_ttl_seconds,
                )
                auths.append(
                    {
                        "source_id": page["source_id"],
                        "method": "PUT",
                        "url": f"/v1/uploads/{token}",
                        "expires_at": expires.isoformat(),
                        "required_headers": {"Content-Type": page["media_type"]},
                        "max_bytes": page["byte_size"],
                    }
                )
            return {"capture_id": str(capture_id), "authorizations": auths}

        return self._guard(user_id, run)  # type: ignore[no-any-return]

    def verify_upload_claims(self, user_id: uuid.UUID, token: str) -> UploadClaims:
        try:
            claims = verify_upload_token(self.settings.signing_secret, token)
        except TokenExpired:
            raise ApiError(
                "UPLOAD_AUTHORIZATION_EXPIRED",
                "Upload authorization expired; request a new one.",
                403,
                retryable=True,
            ) from None
        except TokenError:
            raise ApiError("UPLOAD_AUTHORIZATION_INVALID", "Invalid upload authorization.", 403) from None
        if claims.actor_id != user_id:
            raise ApiError("UPLOAD_AUTHORIZATION_INVALID", "Invalid upload authorization.", 403)
        return claims

    def prepare_upload(self, user_id: uuid.UUID, claims: UploadClaims) -> UploadTarget:
        def run(tx: Tx) -> UploadTarget:
            if tx.workspace_id != claims.workspace_id:
                raise ApiError("UPLOAD_AUTHORIZATION_INVALID", "Invalid upload authorization.", 403)
            row = tx.one(
                "select * from source_objects where workspace_id=%s and id=%s and capture_id=%s",
                (tx.workspace_id, claims.source_id, claims.capture_id),
            )
            if row is None:
                raise not_found("Source not found.")
            return UploadTarget(
                source_id=row["id"],
                capture_id=row["capture_id"],
                media_type=row["media_type"],
                declared_byte_size=row["declared_byte_size"],
                declared_sha256=row["declared_sha256"],
                storage_key=row["storage_key"],
            )

        return self._guard(user_id, run)  # type: ignore[no-any-return]

    def complete_upload(
        self, user_id: uuid.UUID, target: UploadTarget, spool: Path, size: int, sha256: str
    ) -> dict[str, Any]:
        """Validate received bytes, store them write-once, then record the server-computed hash."""
        if size < target.declared_byte_size:
            raise upload_incomplete("The upload ended before all declared bytes arrived.")
        if size > target.declared_byte_size:
            raise payload_too_large("The upload is larger than the declared size.")
        if sha256 != target.declared_sha256:
            raise hash_mismatch("The received bytes do not match the declared SHA-256.")
        validate_content(spool, target.media_type, max_pixels=self.settings.max_image_pixels)
        try:
            self.store.put_if_absent(target.storage_key, spool, content_type=target.media_type, sha256=sha256)
        except StoredObjectConflict:
            # The incoming bytes already match the declared hash, so the stored object is the corrupt one.
            self.store.replace_corrupt(target.storage_key, spool, content_type=target.media_type)

        def run(tx: Tx) -> None:
            updated = tx.run(
                "update source_objects set received_at = now(), received_byte_size = %s, server_sha256 = %s "
                "where workspace_id=%s and id=%s and received_at is null",
                (size, sha256, tx.workspace_id, target.source_id),
            )
            if updated == 0:
                row = tx.one(
                    "select server_sha256 from source_objects where workspace_id=%s and id=%s",
                    (tx.workspace_id, target.source_id),
                )
                if row is None or row["server_sha256"] != sha256:
                    raise ApiError("SOURCE_CONFLICT", "A different original is already stored.", 409)

        self._guard(user_id, run)
        return {"source_id": str(target.source_id), "upload_state": "received", "byte_size": size, "sha256": sha256}

    # ------------------------------------------------------------------ finalize
    def finalize(
        self, user_id: uuid.UUID, capture_id: uuid.UUID, idempotency_key: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        expected = self._parse_expected(body)
        digest = request_digest(
            {
                "capture_id": str(capture_id),
                "expected_pages": sorted(
                    [{"source_id": k, "sha256": v} for k, v in expected.items()], key=lambda e: e["source_id"]
                ),
            }
        )

        def check_expected(pages: list[Row]) -> None:
            if set(expected) != {str(p["id"]) for p in pages}:
                raise validation("expected_pages must list exactly the capture's pages.")
            for page in pages:
                if page["server_sha256"] is not None and page["server_sha256"] != expected[str(page["id"])]:
                    raise hash_mismatch("A page's server SHA-256 differs from what the client expects.")

        def stage(tx: Tx) -> tuple[dict[str, Any] | None, list[Row]]:
            cap = tx.one("select * from captures where workspace_id=%s and id=%s", (tx.workspace_id, capture_id))
            if cap is None:
                raise not_found("Capture not found.")
            pages = tx.all(
                "select * from source_objects where workspace_id=%s and capture_id=%s order by ordinal",
                (tx.workspace_id, capture_id),
            )
            record = tx.one(
                "select request_digest from idempotency_records where workspace_id=%s and actor_id=%s "
                "and operation_family='capture.finalize' and idempotency_key=%s",
                (tx.workspace_id, user_id, idempotency_key),
            )
            if record is not None:
                if record["request_digest"] != digest:
                    raise idempotency_conflict()
                return self._load_view(tx, capture_id), pages
            if cap["status"] != "awaiting_upload":  # stored or any later processing state
                check_expected(pages)
                self._record_idempotency(tx, "capture.finalize", idempotency_key, digest, capture_id)
                return self._load_view(tx, capture_id), pages
            return None, pages

        done, pages = self._guard(user_id, stage)
        if done is not None:
            return done  # type: ignore[no-any-return]

        missing = [str(p["id"]) for p in pages if p["received_at"] is None]
        if missing:
            raise upload_incomplete("Some pages have not been uploaded.", {"missing_source_ids": missing})
        check_expected(pages)

        # Verify the stored bytes themselves, outside any database transaction.
        lost: list[str] = []
        for page in pages:
            info = self.store.stat(page["storage_key"])
            if info is None:
                lost.append(str(page["id"]))
                continue
            try:
                actual, size = hash_stream(self.store.iter_bytes(page["storage_key"]))
            except ObjectNotFound:
                lost.append(str(page["id"]))
                continue
            if actual != page["server_sha256"] or size != page["received_byte_size"]:
                lost.append(str(page["id"]))  # corrupt in storage: ask the client to re-send the verified bytes
        if lost:
            raise upload_incomplete(
                "Some stored originals are missing or damaged; upload them again.", {"missing_source_ids": lost}
            )

        def commit(tx: Tx) -> dict[str, Any]:
            cap = tx.one(
                "select * from captures where workspace_id=%s and id=%s for update", (tx.workspace_id, capture_id)
            )
            if cap is None:
                raise not_found("Capture not found.")
            if cap["status"] == "awaiting_upload":
                tx.run(
                    "update source_objects set verified_at = now() where workspace_id=%s and capture_id=%s "
                    "and verified_at is null",
                    (tx.workspace_id, capture_id),
                )
                tx.run(
                    "update captures set status='stored', stored_at=now(), version=version+1 "
                    "where workspace_id=%s and id=%s",
                    (tx.workspace_id, capture_id),
                )
                # Same transaction: a stored capture and its interpretation job exist together or not at all.
                processing.enqueue_capture(tx, self.settings, capture_id)
            self._record_idempotency(tx, "capture.finalize", idempotency_key, digest, capture_id)
            return self._load_view(tx, capture_id)

        return self._guard(user_id, commit)  # type: ignore[no-any-return]

    @staticmethod
    def _parse_expected(body: Any) -> dict[str, str]:
        if (
            not isinstance(body, dict)
            or set(body) != {"expected_pages"}
            or not isinstance(body["expected_pages"], list)
        ):
            raise validation('Body must be {"expected_pages": [{"source_id", "sha256"}...]}.')
        expected: dict[str, str] = {}
        for item in body["expected_pages"]:
            try:
                if set(item) != {"source_id", "sha256"}:
                    raise ValueError
                source_id = str(uuid.UUID(str(item["source_id"])))
                sha = item["sha256"]
                if not (isinstance(sha, str) and len(sha) == 64 and all(c in "0123456789abcdef" for c in sha)):
                    raise ValueError
            except (ValueError, TypeError):
                raise validation("Invalid expected_pages entry.") from None
            expected[source_id] = sha
        if not expected or len(expected) != len(body["expected_pages"]):
            raise validation("expected_pages must be non-empty and unique.")
        return expected

    # ------------------------------------------------------------------ original access
    def open_source(self, user_id: uuid.UUID, source_id: uuid.UUID) -> tuple[Row, Iterator[bytes]]:
        def run(tx: Tx) -> Row:
            row = tx.one(
                "select s.*, c.status as capture_status from source_objects s "
                "join captures c on c.workspace_id = s.workspace_id and c.id = s.capture_id "
                "where s.workspace_id=%s and s.id=%s and c.deleted_at is null",
                (tx.workspace_id, source_id),
            )
            if row is None:
                raise not_found("Source not found.")
            if row["capture_status"] == "awaiting_upload" or row["verified_at"] is None:
                raise source_unavailable()
            return row

        row = self._guard(user_id, run)
        if self.store.stat(row["storage_key"]) is None:
            raise ApiError("SOURCE_UNAVAILABLE", "The stored original is missing.", 503, retryable=True)
        return row, self.store.iter_bytes(row["storage_key"])


def _processing_state(tx: Tx, capture_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[Row | None, uuid.UUID | None]]:
    """Latest processing job and memory id per capture (one query each)."""
    if not capture_ids:
        return {}
    jobs = tx.all(
        "select distinct on (capture_id) * from processing_jobs where workspace_id=%s and capture_id = any(%s) "
        "order by capture_id, created_at desc",
        (tx.workspace_id, capture_ids),
    )
    memories = tx.all(
        "select capture_id, id from memories where workspace_id=%s and capture_id = any(%s)",
        (tx.workspace_id, capture_ids),
    )
    by_job = {j["capture_id"]: j for j in jobs}
    by_memory = {m["capture_id"]: m["id"] for m in memories}
    return {cid: (by_job.get(cid), by_memory.get(cid)) for cid in capture_ids}
