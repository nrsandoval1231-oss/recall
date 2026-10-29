"""Explicit canonical deletion and durable, recoverable private-object purge."""

from __future__ import annotations

import uuid
from typing import Any

import psycopg
from psycopg.rows import dict_row

from ..db.database import Database
from ..errors import ApiError, forbidden, not_found, validation
from ..storage import ObjectStore
from .captures import CaptureService
from .manifest import request_digest


class DeletionService:
    def __init__(self, db: Database) -> None:
        self.db = db

    def preview_workspace(self, user_id: uuid.UUID) -> dict[str, Any]:
        try:
            with self.db.tx(user_id) as tx:
                row = tx.one("select id,sync_clock from workspaces where id=%s", (tx.workspace_id,))
                assert row is not None
                counts = tx.one(
                    "select (select count(*) from captures where workspace_id=%s) as captures,"
                    "(select count(*) from source_objects where workspace_id=%s) as originals,"
                    "(select count(*) from memories where workspace_id=%s) as memories",
                    (tx.workspace_id, tx.workspace_id, tx.workspace_id),
                )
                return {"workspace_id": str(tx.workspace_id), "version": row["sync_clock"], **(counts or {})}
        except LookupError:
            raise forbidden() from None

    def delete_memory(self, user_id: uuid.UUID, target: uuid.UUID, key: str, expected: int) -> dict[str, Any]:
        return self._delete_resource(user_id, "memory", target, key, expected)

    def delete_source(self, user_id: uuid.UUID, target: uuid.UUID, key: str, expected: int) -> dict[str, Any]:
        return self._delete_resource(user_id, "source", target, key, expected)

    def erase_workspace(self, user_id: uuid.UUID, key: str, expected: int) -> dict[str, Any]:
        return self._delete_resource(user_id, "workspace", None, key, expected)

    def _delete_resource(
        self, user_id: uuid.UUID, kind: str, target: uuid.UUID | None, key: str, expected: int
    ) -> dict[str, Any]:
        if type(expected) is not int or expected < (0 if kind == "workspace" else 1):
            raise validation("Expected version is invalid.")
        family = {"memory": "memory.delete", "source": "source.delete", "workspace": "workspace.erase"}[kind]
        try:
            with self.db.tx(user_id) as tx:
                resource = target or tx.workspace_id
                digest = request_digest({"kind": kind, "id": str(resource), "expected_version": expected})
                prior = tx.one(
                    "select request_digest from idempotency_records where workspace_id=%s and actor_id=%s "
                    "and operation_family=%s and idempotency_key=%s",
                    (tx.workspace_id, user_id, family, key),
                )
                if prior is not None:
                    if prior["request_digest"] != digest:
                        raise ApiError("IDEMPOTENCY_CONFLICT", "Key used for another deletion.", 409)
                    return {"id": str(resource), "deleted": True, "replayed": True}
                if kind == "memory":
                    row = tx.one(
                        "select current_revision as version from memories where workspace_id=%s and id=%s",
                        (tx.workspace_id, resource),
                    )
                elif kind == "source":
                    row = tx.one(
                        "select c.version from source_objects s join captures c "
                        "on c.workspace_id=s.workspace_id and c.id=s.capture_id where s.workspace_id=%s and s.id=%s",
                        (tx.workspace_id, resource),
                    )
                else:
                    owner = tx.one(
                        "select role from workspace_members where workspace_id=%s and user_id=%s",
                        (tx.workspace_id, user_id),
                    )
                    if owner is None or owner["role"] != "owner":
                        raise forbidden("Only the workspace owner can erase its data.")
                    row = tx.one("select sync_clock as version from workspaces where id=%s", (tx.workspace_id,))
                if row is None:
                    raise not_found("Resource not found.")
                if row["version"] != expected:
                    raise ApiError(
                        "VERSION_CONFLICT",
                        "Data changed elsewhere; review the deletion again.",
                        409,
                        details={"current_version": row["version"]},
                    )
                if kind == "memory":
                    tx.run("select recall_delete_memory(%s,%s)", (resource, expected))
                elif kind == "source":
                    tx.run("select recall_purge_source(%s,%s)", (resource, expected))
                else:
                    tx.run("select recall_erase_workspace(%s)", (expected,))
                CaptureService._record_idempotency(tx, family, key, digest, resource)
                return {"id": str(resource), "deleted": True, "replayed": False}
        except LookupError:
            raise forbidden() from None
        except psycopg.errors.FeatureNotSupported:
            raise ApiError(
                "SOURCE_DELETE_REQUIRES_CAPTURE_DELETE",
                "This page belongs to a processed memory. Delete the capture to preserve correction history.",
                409,
            ) from None

    def delete_capture(self, user_id: uuid.UUID, capture_id: uuid.UUID, key: str, expected: int) -> dict[str, Any]:
        if type(expected) is not int or expected < 1:
            raise validation("Expected version must be positive.")
        digest = request_digest({"capture_id": str(capture_id), "expected_version": expected})
        try:
            with self.db.tx(user_id) as tx:
                prior = tx.one(
                    "select request_digest from idempotency_records where workspace_id=%s and actor_id=%s "
                    "and operation_family='capture.delete' and idempotency_key=%s",
                    (tx.workspace_id, tx.user_id, key),
                )
                if prior is not None:
                    if prior["request_digest"] != digest:
                        raise ApiError("IDEMPOTENCY_CONFLICT", "Key used for another deletion.", 409)
                    return {"capture_id": str(capture_id), "deleted": True, "replayed": True}
                capture = tx.one(
                    "select version from captures where workspace_id=%s and id=%s for update",
                    (tx.workspace_id, capture_id),
                )
                if capture is None:
                    raise not_found("Capture not found.")
                if capture["version"] != expected:
                    raise ApiError(
                        "VERSION_CONFLICT",
                        "Capture changed elsewhere.",
                        409,
                        details={"current_version": capture["version"]},
                    )
                tx.run("select recall_purge_capture(%s,%s)", (capture_id, expected))
                CaptureService._record_idempotency(tx, "capture.delete", key, digest, capture_id)
                return {"capture_id": str(capture_id), "deleted": True, "replayed": False}
        except LookupError:
            raise forbidden() from None


class PurgeWorker:
    """Only durable server-created keys; network I/O outside short lease transactions."""

    def __init__(self, dsn: str, store: ObjectStore) -> None:
        self.dsn, self.store = dsn, store

    def run_once(self) -> str | None:
        lease = uuid.uuid4()
        with psycopg.connect(self.dsn, row_factory=dict_row) as conn, conn.transaction():
            conn.execute("select pg_advisory_xact_lock_shared(7402006)")
            job = conn.execute(
                "select * from object_purge_jobs where (status='queued' and not_before<=now()) "
                "or (status='leased' and lease_expires_at<now()) order by created_at for update skip locked limit 1"
            ).fetchone()
            if job is None:
                return None
            conn.execute("select set_config('app.workspace_id',%s,true)", (str(job["workspace_id"]),))
            conn.execute(
                "update object_purge_jobs set status='leased',attempts=attempts+1,lease_token=%s,"
                "lease_expires_at=now()+interval '2 minutes',updated_at=now() where id=%s",
                (lease, job["id"]),
            )
        error: str | None = None
        try:
            # Session locks cover object I/O without holding a database
            # transaction. Backups take the exclusive global gate before their
            # snapshot, so database mappings and bytes cannot diverge mid-copy.
            with psycopg.connect(self.dsn, autocommit=True) as object_lock:
                object_lock.execute("select pg_advisory_lock_shared(7402006)")
                object_lock.execute("select pg_advisory_lock(hashtextextended(%s,0))", (f"sync:{job['workspace_id']}",))
                self.store.delete(job["storage_key"])
        except Exception as exc:
            error = type(exc).__name__
        with psycopg.connect(self.dsn, row_factory=dict_row) as conn, conn.transaction():
            conn.execute("select pg_advisory_xact_lock_shared(7402006)")
            conn.execute("select set_config('app.workspace_id',%s,true)", (str(job["workspace_id"]),))
            conn.execute(
                "update object_purge_jobs set status=%s,last_error=%s,lease_token=null,lease_expires_at=null,"
                "not_before=now()+make_interval(secs=>%s),updated_at=now() "
                "where id=%s and status='leased' and lease_token=%s",
                (
                    "failed" if error and job["attempts"] >= 9 else "queued" if error else "succeeded",
                    error,
                    min(3600, 30 * 2 ** min(job["attempts"], 7)),
                    job["id"],
                    lease,
                ),
            )
        return str(job["id"])
