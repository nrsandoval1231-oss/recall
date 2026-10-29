"""Commit-ordered sync with workspace-bound cursors and explicit version conflicts.

The feed coalesces each event to the latest authorized resource projection. Its
version accompanies that projection; it is not an historical event payload.
Historical memory is carried inside each memory's versioned history instead.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from typing import Any

from psycopg import sql

from ..config import Settings
from ..db.database import Database, Tx
from ..domain.captures import CaptureService
from ..domain.entities import EntityService
from ..domain.memories import MemoryService
from ..domain.tokens import TokenError, _open, _seal
from ..errors import ApiError, forbidden, validation

KINDS = {
    "capture": "captures",
    "memory": "memories",
    "entity": "entities",
    "source": "source_objects",
    "claim": "claims",
    "relationship": "entity_links",
    "action": "actions",
}
MAX_SNAPSHOT_RECORDS = 5000
MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024


def json_value(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(v) for v in value]
    return value


class SyncService:
    def __init__(self, db: Database, settings: Settings, captures: CaptureService, memories: MemoryService) -> None:
        self.db, self.settings, self.captures, self.memories = db, settings, captures, memories

    def _cursor(self, tx: Tx, sequence: int) -> str:
        return _seal(self.settings.signing_secret, "sync.v1", {"ws": str(tx.workspace_id), "seq": sequence})

    def _sequence(self, tx: Tx, cursor: str | None) -> int:
        if not cursor:
            raise ApiError("SNAPSHOT_REQUIRED", "Download a current memory snapshot first.", 410)
        try:
            data = _open(self.settings.signing_secret, "sync.v1", cursor)
            sequence = data["seq"]
            if data["ws"] != str(tx.workspace_id) or type(sequence) is not int or sequence < 0:
                raise TokenError("invalid sync cursor")
        except (TokenError, KeyError, TypeError):
            raise validation("Invalid sync cursor.") from None
        clock = tx.one("select sync_clock, sync_floor from workspaces where id=%s", (tx.workspace_id,))
        assert clock is not None
        if sequence < clock["sync_floor"]:
            raise ApiError("SNAPSHOT_REQUIRED", "The saved sync position has expired. Refresh the cache.", 410)
        if sequence > clock["sync_clock"]:
            raise validation("Invalid sync cursor.")
        return sequence

    def _record(self, tx: Tx, kind: str, record_id: uuid.UUID) -> dict[str, Any]:
        # Table names come only from this closed server allowlist.
        table = KINDS[kind]
        query = sql.SQL("select * from {} where workspace_id=%s and id=%s").format(sql.Identifier(table))
        row = tx.one(query.as_string(tx.conn), (tx.workspace_id, record_id))
        if row is None or row.get("status") == "deleted" or row.get("deleted_at") is not None:
            return {
                "kind": kind,
                "id": str(record_id),
                "version": row.get("version", 1) if row else 1,
                "data": None,
                "deleted": True,
            }
        if kind == "capture":
            payload = self.captures._load_view(tx, record_id)
        elif kind == "memory":
            payload = self.memories._memory_view(tx, record_id)
        elif kind == "source":
            payload = {
                k: row[k]
                for k in (
                    "id",
                    "capture_id",
                    "ordinal",
                    "media_type",
                    "received_byte_size",
                    "server_sha256",
                    "verified_at",
                )
            }
            payload["source_id"] = str(record_id)
        elif kind == "claim":
            latest = tx.one(
                "select * from claim_revisions where workspace_id=%s and claim_id=%s and version=%s",
                (tx.workspace_id, record_id, row["current_version"]),
            )
            payload = {**row, **(latest or {}), "claim_id": str(record_id)}
        elif kind == "entity":
            payload = EntityService.view(tx, record_id)
        else:
            payload = dict(row)
        return {
            "kind": kind,
            "id": str(record_id),
            "version": row.get("current_revision", row.get("current_version", row.get("version", 1))),
            "data": json_value(payload),
            "deleted": False,
        }

    def snapshot(self, user_id: uuid.UUID) -> dict[str, Any]:
        try:
            with self.db.tx(user_id) as tx:
                clock = tx.one("select sync_clock from workspaces where id=%s", (tx.workspace_id,))
                assert clock is not None
                records: list[dict[str, Any]] = []
                for kind, table in KINDS.items():
                    query = sql.SQL("select id from {} where workspace_id=%s order by id limit %s").format(
                        sql.Identifier(table)
                    )
                    rows = tx.all(
                        query.as_string(tx.conn),
                        (tx.workspace_id, MAX_SNAPSHOT_RECORDS + 1),
                    )
                    if len(records) + len(rows) > MAX_SNAPSHOT_RECORDS:
                        raise ApiError("SNAPSHOT_TOO_LARGE", "This workspace exceeds the pilot cache limit.", 413)
                    records.extend(self._record(tx, kind, row["id"]) for row in rows)
                result = {
                    "workspace_id": str(tx.workspace_id),
                    "cursor": self._cursor(tx, clock["sync_clock"]),
                    "records": records,
                }
                if len(json.dumps(result).encode()) > MAX_SNAPSHOT_BYTES:
                    raise ApiError("SNAPSHOT_TOO_LARGE", "This workspace exceeds the pilot cache size limit.", 413)
                return result
        except LookupError:
            raise forbidden("This account has no workspace.") from None

    def changes(self, user_id: uuid.UUID, cursor: str | None, limit: int) -> dict[str, Any]:
        try:
            with self.db.tx(user_id) as tx:
                sequence = self._sequence(tx, cursor)
                rows = tx.all(
                    "select sequence,kind,record_id from change_events where workspace_id=%s and sequence>%s "
                    "order by sequence limit %s",
                    (tx.workspace_id, sequence, limit + 1),
                )
                more, rows = len(rows) > limit, rows[:limit]
                events = [{"sequence": r["sequence"], **self._record(tx, r["kind"], r["record_id"])} for r in rows]
                next_sequence = rows[-1]["sequence"] if rows else sequence
                return {"events": events, "next_cursor": self._cursor(tx, next_sequence), "has_more": more}
        except LookupError:
            raise forbidden("This account has no workspace.") from None

    def push(self, user_id: uuid.UUID, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) != {"operations"} or not isinstance(body["operations"], list):
            raise validation("Expected a bounded operations list.")
        if not 1 <= len(body["operations"]) <= 50:
            raise validation("Send 1-50 operations at a time.")
        results: list[dict[str, Any]] = []
        for operation in body["operations"]:
            op_id = operation.get("operation_id") if isinstance(operation, dict) else None
            try:
                if not isinstance(operation, dict) or set(operation) != {
                    "operation_id",
                    "kind",
                    "target_id",
                    "expected_version",
                    "payload",
                }:
                    raise validation("Invalid operation envelope.")
                op_id = str(uuid.UUID(operation["operation_id"]))
                target = uuid.UUID(operation["target_id"])
                version = operation["expected_version"]
                if type(version) is not int or version < 1:
                    raise validation("A current expected version is required.")
                if operation["kind"] == "memory.correction":
                    result = self.memories.correct_memory(user_id, target, op_id, version, operation["payload"])
                elif operation["kind"] == "action.update":
                    result = self.memories.update_action(user_id, target, op_id, version, operation["payload"])
                else:
                    raise validation("This operation is not supported.")
                results.append(
                    {
                        "operation_id": op_id,
                        "status": "already_applied" if result.get("replayed") else "applied",
                        "data": result,
                    }
                )
            except (ValueError, TypeError):
                results.append({"operation_id": op_id, "status": "rejected", "message": "Invalid operation."})
            except ApiError as error:
                status = (
                    "conflict"
                    if error.code == "VERSION_CONFLICT"
                    else ("retryable_failure" if error.retryable else "rejected")
                )
                results.append(
                    {
                        "operation_id": op_id,
                        "status": status,
                        "code": error.code,
                        "message": error.message,
                        "details": error.details,
                    }
                )
        return {"results": results}
