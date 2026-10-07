"""Explicit, workspace-scoped universal entities; a name is never identity proof."""

from __future__ import annotations

import json
import uuid
from typing import Any, cast

from fastapi.encoders import jsonable_encoder

from ..config import Settings
from ..db.database import Database, Tx
from ..errors import ApiError, not_found, validation
from .captures import CaptureService
from .manifest import request_digest
from .memories import _memory_summary

KINDS = ("person", "organization", "place", "thing", "event", "project", "topic")


class EntityService:
    def __init__(self, db: Database, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    def _guard(self, user_id: uuid.UUID, fn: Any) -> Any:
        with self.db.tx(user_id, provision=self.settings.auto_provision_workspaces) as tx:
            return fn(tx)

    def list(self, user_id: uuid.UUID, q: str | None, kind: str | None, limit: int) -> dict[str, Any]:
        if kind is not None and kind not in KINDS:
            raise validation("Invalid entity kind.")

        def run(tx: Tx) -> dict[str, Any]:
            rows = tx.all(
                "select distinct e.id,e.kind,e.canonical_name,e.version,e.updated_at "
                "from entities e left join entity_aliases a on a.entity_id=e.id "
                "where e.workspace_id=%s and (%s::text is null or e.kind=%s) "
                "and (%s::text is null or e.canonical_name ilike '%%'||%s||'%%' "
                "or a.alias ilike '%%'||%s||'%%') order by e.updated_at desc limit %s",
                (tx.workspace_id, kind, kind, q, q, q, limit),
            )
            return {"items": [_entity_row(row) for row in rows]}

        return cast(dict[str, Any], self._guard(user_id, run))

    def get(self, user_id: uuid.UUID, entity_id: uuid.UUID) -> dict[str, Any]:
        return cast(dict[str, Any], self._guard(user_id, lambda tx: self.view(tx, entity_id)))

    @staticmethod
    def view(tx: Tx, entity_id: uuid.UUID) -> dict[str, Any]:
        entity = tx.one("select * from entities where workspace_id=%s and id=%s", (tx.workspace_id, entity_id))
        if entity is None:
            raise not_found("Entity not found.")
        aliases = tx.all(
            "select alias from entity_aliases where workspace_id=%s and entity_id=%s", (tx.workspace_id, entity_id)
        )
        mentions = tx.all(
            "select distinct on (mn.memory_id,mn.evidence_key) mn.* from mentions mn "
            "where mn.workspace_id=%s and mn.entity_id=%s "
            "order by mn.memory_id,mn.evidence_key,mn.revision desc limit 100",
            (tx.workspace_id, entity_id),
        )
        links = tx.all(
            "select l.*,src.canonical_name as from_name,dst.canonical_name as to_name from entity_links l "
            "join entities src on src.workspace_id=l.workspace_id and src.id=l.from_entity_id "
            "join entities dst on dst.workspace_id=l.workspace_id and dst.id=l.to_entity_id "
            "where l.workspace_id=%s and (l.from_entity_id=%s or l.to_entity_id=%s) "
            "order by l.created_at desc limit 100",
            (tx.workspace_id, entity_id, entity_id),
        )
        memories = tx.all(
            "select m.id,m.capture_id,m.current_revision,m.created_at,r.summary,r.model_id,cap.status,"
            "cap.captured_at,cap.context_hint,cap.page_count from memories m "
            "join memory_revisions r on r.memory_id=m.id and r.revision=m.current_revision "
            "join captures cap on cap.workspace_id=m.workspace_id and cap.id=m.capture_id "
            "where m.workspace_id=%s and m.id=any(%s) order by cap.captured_at desc limit 100",
            (tx.workspace_id, list({row["memory_id"] for row in mentions})),
        )
        timeline = tx.all(
            "select cr.claim_id,cr.memory_id,cr.text,cr.epistemic_state,cr.origin,cr.created_at as recorded_at,"
            "cr.valid_from,cr.valid_to from claim_revisions cr where cr.workspace_id=%s and cr.memory_id=any(%s) "
            "order by cr.created_at desc limit 100",
            (tx.workspace_id, [row["id"] for row in memories]),
        )
        return {
            **_entity_row(entity),
            "mention_count": len(mentions),
            "memory_count": len(memories),
            "memories": [_memory_summary(row) for row in memories],
            "timeline": jsonable_encoder(timeline),
            "aliases": [row["alias"] for row in aliases],
            "mentions": [
                {
                    "mention_id": str(row["id"]),
                    "memory_id": str(row["memory_id"]),
                    "raw_text": row["text"],
                    "status": row["resolution_status"],
                    "evidence": row["evidence"],
                }
                for row in mentions
            ],
            "relationships": [
                {
                    "relationship_id": str(row["id"]),
                    "from_entity_id": str(row["from_entity_id"]),
                    "to_entity_id": str(row["to_entity_id"]),
                    "type": row["relation_type"],
                    "from_name": row["from_name"],
                    "to_name": row["to_name"],
                    "status": row["status"],
                    "version": row["version"],
                    "evidence": row["evidence"],
                    "valid_from": jsonable_encoder(row["valid_from"]),
                    "valid_to": jsonable_encoder(row["valid_to"]),
                }
                for row in links
            ],
        }

    def create(self, user_id: uuid.UUID, key: str, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {"kind", "canonical_name", "aliases"}:
            raise validation("Entity needs kind and canonical_name.")
        name = body.get("canonical_name")
        aliases = body.get("aliases", [])
        if body.get("kind") not in KINDS or not isinstance(name, str) or not 1 <= len(name.strip()) <= 500:
            raise validation("Entity needs kind and canonical_name.")
        if (
            not isinstance(aliases, list)
            or len(aliases) > 100
            or any(not isinstance(alias, str) or not 1 <= len(alias.strip()) <= 500 for alias in aliases)
        ):
            raise validation("aliases must be non-empty strings.")
        digest = request_digest(body)

        def run(tx: Tx) -> dict[str, Any]:
            prior = tx.one(
                "select resource_id,request_digest from idempotency_records where workspace_id=%s and actor_id=%s "
                "and operation_family='entity.create' and idempotency_key=%s",
                (tx.workspace_id, tx.user_id, key),
            )
            if prior is not None:
                if prior["request_digest"] != digest:
                    raise ApiError(
                        "IDEMPOTENCY_CONFLICT", "This idempotency key was used for a different request.", 409
                    )
                return {"entity_id": str(prior["resource_id"]), "replayed": True}
            entity_id = uuid.uuid4()
            tx.run(
                "insert into entities (id,workspace_id,kind,canonical_name,created_by) values (%s,%s,%s,%s,%s)",
                (entity_id, tx.workspace_id, body["kind"], name.strip(), tx.user_id),
            )
            for alias in dict.fromkeys([name.strip(), *[item.strip() for item in aliases]]):
                tx.run(
                    "insert into entity_aliases (id,workspace_id,entity_id,alias) values (%s,%s,%s,%s)",
                    (uuid.uuid4(), tx.workspace_id, entity_id, alias),
                )
            CaptureService._record_idempotency(tx, "entity.create", key, digest, entity_id)
            return {"entity_id": str(entity_id), "replayed": False}

        return cast(dict[str, Any], self._guard(user_id, run))

    def identity_preview(self, user_id: uuid.UUID, source_id: uuid.UUID, target_id: uuid.UUID) -> dict[str, Any]:
        def run(tx: Tx) -> dict[str, Any]:
            rows = tx.all(
                "select id from entities where workspace_id=%s and id=any(%s)",
                (tx.workspace_id, [source_id, target_id]),
            )
            if len(rows) != 2 or source_id == target_id:
                raise not_found("Entity not found.")
            count = tx.one(
                "select count(*) as n from mentions where workspace_id=%s "
                "and entity_id=%s and resolution_status='accepted'",
                (tx.workspace_id, source_id),
            )
            return {
                "source_entity_id": str(source_id),
                "target_entity_id": str(target_id),
                "accepted_mentions": count["n"] if count else 0,
            }

        return cast(dict[str, Any], self._guard(user_id, run))

    def apply_identity(
        self, user_id: uuid.UUID, key: str, source_id: uuid.UUID, target_id: uuid.UUID, body: Any
    ) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {"source_version", "target_version", "mention_ids"}:
            raise validation("Identity operation has unknown fields.")
        if type(body.get("source_version")) is not int or type(body.get("target_version")) is not int:
            raise validation("source_version and target_version are required.")
        mention_ids = body.get("mention_ids", [])
        if not isinstance(mention_ids, list) or len(mention_ids) > 100:
            raise validation("mention_ids must be a list.")
        try:
            ids = [uuid.UUID(str(value)) for value in mention_ids]
        except ValueError:
            raise validation("mention_ids must contain UUIDs.") from None
        operation = "split" if ids else "merge"
        digest = request_digest(
            {"operation": operation, "source": str(source_id), "target": str(target_id), "body": body}
        )

        def run(tx: Tx) -> dict[str, Any]:
            prior = tx.one(
                "select resource_id,request_digest from idempotency_records where workspace_id=%s "
                "and actor_id=%s and operation_family=%s and idempotency_key=%s",
                (tx.workspace_id, tx.user_id, f"entity.{operation}", key),
            )
            if prior:
                if prior["request_digest"] != digest:
                    raise ApiError(
                        "IDEMPOTENCY_CONFLICT", "This idempotency key was used for a different operation.", 409
                    )
                return {"operation_id": str(prior["resource_id"]), "replayed": True}
            entities = tx.all(
                "select id,version from entities where workspace_id=%s and id=any(%s) for update",
                (tx.workspace_id, [source_id, target_id]),
            )
            versions = {row["id"]: row["version"] for row in entities}
            if source_id == target_id or len(versions) != 2:
                raise not_found("Entity not found.")
            if versions.get(source_id) != body["source_version"] or versions.get(target_id) != body["target_version"]:
                raise ApiError(
                    "VERSION_CONFLICT",
                    "Entity changed elsewhere.",
                    409,
                    details={"source_version": versions.get(source_id), "target_version": versions.get(target_id)},
                )
            moved = tx.all(
                "select id from mentions where workspace_id=%s and entity_id=%s "
                "and resolution_status='accepted' and (%s::boolean or id=any(%s)) for update",
                (tx.workspace_id, source_id, not ids, ids),
            )
            if ids and len(moved) != len(ids):
                raise validation("Every split mention must be an accepted source identity.")
            tx.run(
                "update mentions set entity_id=%s,version=version+1 where workspace_id=%s and entity_id=%s "
                "and resolution_status='accepted' and (%s::boolean or id=any(%s))",
                (target_id, tx.workspace_id, source_id, not ids, ids),
            )
            tx.run("update entities set version=version+1,updated_at=now() where id=any(%s)", ([source_id, target_id],))
            op_id = uuid.uuid4()
            tx.run(
                "insert into identity_operations "
                "(id,workspace_id,operation,source_entity_id,target_entity_id,moved_mention_ids,actor_id) "
                "values (%s,%s,%s,%s,%s,%s,%s)",
                (
                    op_id,
                    tx.workspace_id,
                    operation,
                    source_id,
                    target_id,
                    json.dumps([str(row["id"]) for row in moved]),
                    tx.user_id,
                ),
            )
            CaptureService._record_idempotency(tx, f"entity.{operation}", key, digest, op_id)
            return {"operation_id": str(op_id), "operation": operation, "moved_mentions": len(moved), "replayed": False}

        return cast(dict[str, Any], self._guard(user_id, run))


def _entity_row(row: dict[str, Any]) -> dict[str, Any]:
    return {"entity_id": str(row["id"]), "kind": row["kind"], "name": row["canonical_name"], "version": row["version"]}
