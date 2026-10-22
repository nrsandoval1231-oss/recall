"""Bounded, separately authorized local-vault Ask receipts."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import psycopg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from jsonschema import Draft202012Validator
from psycopg.types.json import Jsonb

from ..config import Settings
from ..db.database import Database, Row, Tx
from ..domain import processing
from ..errors import ApiError, forbidden, idempotency_conflict, not_found, validation
from ..pairing import digest as pairing_digest
from ..retrieval.ask import (
    ANSWER_SCHEMA,
    MAX_ANSWER_OUTPUT_TOKENS,
    answer_max_input_tokens,
    build_packet,
    verify_answer,
)
from .provider import AnswerRequest, Provider, ProviderError, ProviderResult

MAX_BODY_BYTES = 32 * 1024
MAX_QUESTION_BYTES = 2000
MAX_EXCERPT_BYTES = 1500
MAX_RECEIPT_SECONDS = 24 * 60 * 60
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_SHA = re.compile(r"^[0-9a-f]{64}$")
_DATE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})$"
)
_EVIDENCE_KINDS = {"text_source", "human_note", "human_reading_correction", "machine_reading"}
_EPISTEMIC_STATES = {"reported", "uncertain", "question", "unreviewed"}


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate key")
        value[key] = item
    return value


def _reject_number(value: str) -> None:
    raise ValueError(f"invalid JSON number {value}")


def _valid_unicode(value: Any) -> None:
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError("NUL is unsupported")
        value.encode("utf-8", errors="strict")
    elif isinstance(value, dict):
        for key, item in value.items():
            _valid_unicode(key)
            _valid_unicode(item)
    elif isinstance(value, list):
        for item in value:
            _valid_unicode(item)


def _canonical(value: dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode(
        "utf-8", errors="strict"
    )


def _canonical_uuid(value: Any) -> bool:
    return isinstance(value, str) and _UUID.fullmatch(value) is not None and str(uuid.UUID(value)) == value


def _byte_length(value: Any, minimum: int, maximum: int) -> bool:
    if not isinstance(value, str):
        return False
    try:
        size = len(value.encode("utf-8", errors="strict"))
    except UnicodeEncodeError:
        return False
    return minimum <= size <= maximum


def parse_request(raw: bytes) -> tuple[dict[str, Any], str]:
    """Strictly parse v1/current or v2/historical requests and bind the canonical digest."""
    if len(raw) > MAX_BODY_BYTES:
        raise validation("Ask request is too large.")
    try:
        text = raw.decode("utf-8", errors="strict")
        value = json.loads(text, object_pairs_hook=_object, parse_float=_reject_number, parse_constant=_reject_number)
        _valid_unicode(value)
    except (UnicodeDecodeError, UnicodeEncodeError, ValueError, TypeError):
        raise validation("Ask request must be strict UTF-8 JSON without duplicate keys.") from None
    if not isinstance(value, dict):
        raise validation("Ask request fields are invalid.")
    version = value.get("schema_version")
    common = {
        "schema_version",
        "operation_id",
        "vault_id",
        "question",
        "coverage",
        "evidence",
    }
    if version == "1.0":
        if set(value) != common:
            raise validation("Ask request fields are invalid.")
    elif version == "2.0":
        if set(value) != common | {"temporal"}:
            raise validation("Ask request fields are invalid.")
    else:
        raise validation("Ask request fields are invalid.")
    if not _canonical_uuid(value["operation_id"]) or not _canonical_uuid(value["vault_id"]):
        raise validation("Ask request identity is invalid.")
    if not _byte_length(value["question"], 1, MAX_QUESTION_BYTES):
        raise validation("Ask question must be 1 to 2000 UTF-8 bytes.")
    coverage = value["coverage"]
    if not isinstance(coverage, dict) or set(coverage) != {
        "eligible_count",
        "selected_count",
        "limited",
        "truncated_count",
    }:
        raise validation("Ask coverage is invalid.")
    eligible, selected, limited, truncated = (
        coverage[k] for k in ("eligible_count", "selected_count", "limited", "truncated_count")
    )
    if (
        type(eligible) is not int
        or type(selected) is not int
        or type(truncated) is not int
        or type(limited) is not bool
        or not 0 <= selected <= 8
        or not selected <= eligible <= 1_000_000
        or limited != (eligible > selected)
        or not 0 <= truncated <= selected
    ):
        raise validation("Ask coverage values are invalid.")
    evidence = value["evidence"]
    if not isinstance(evidence, list) or len(evidence) != selected:
        raise validation("Ask evidence count does not match coverage.")
    memory_ids: set[str] = set()
    evidence_keys = {
        "citation_id",
        "memory_id",
        "memory_revision",
        "source_sha256",
        "captured_at",
        "evidence_kind",
        "epistemic_state",
        "excerpt",
    }
    temporal: dict[str, Any] | None = None
    if version == "2.0":
        temporal = _validate_temporal(value["temporal"])
        evidence_keys |= {"event_sha256", "recorded_at", "current_revision", "history_status"}
    histories: dict[str, list[dict[str, Any]]] = {}
    for index, item in enumerate(evidence, 1):
        if not isinstance(item, dict) or set(item) != evidence_keys:
            raise validation("Ask evidence fields are invalid.")
        if item["citation_id"] != f"c{index}" or not _canonical_uuid(item["memory_id"]):
            raise validation("Ask evidence identifiers are invalid.")
        if version == "1.0":
            if item["memory_id"] in memory_ids:
                raise validation("Ask memory identifiers must be distinct.")
            memory_ids.add(item["memory_id"])
        else:
            histories.setdefault(item["memory_id"], []).append(item)
        if (
            type(item["memory_revision"]) is not int
            or not 1 <= item["memory_revision"] <= 2**53 - 1
            or not isinstance(item["source_sha256"], str)
            or _SHA.fullmatch(item["source_sha256"]) is None
        ):
            raise validation("Ask evidence version or source hash is invalid.")
        captured = item["captured_at"]
        if not isinstance(captured, str) or len(captured) > 40 or _DATE.fullmatch(captured) is None:
            raise validation("Ask evidence timestamp is invalid.")
        try:
            if datetime.fromisoformat(captured.replace("Z", "+00:00")).tzinfo is None:
                raise ValueError
        except ValueError:
            raise validation("Ask evidence timestamp is invalid.") from None
        if (
            not isinstance(item["evidence_kind"], str)
            or item["evidence_kind"] not in _EVIDENCE_KINDS
            or not isinstance(item["epistemic_state"], str)
            or item["epistemic_state"] not in _EPISTEMIC_STATES
        ):
            raise validation("Ask evidence labels are invalid.")
        if not _byte_length(item["excerpt"], 1, MAX_EXCERPT_BYTES):
            raise validation("Ask excerpts must be 1 to 1500 UTF-8 bytes.")
        if version == "2.0":
            if (
                not isinstance(item["event_sha256"], str)
                or _SHA.fullmatch(item["event_sha256"]) is None
                or type(item["current_revision"]) is not int
                or not item["memory_revision"] <= item["current_revision"] <= 2**53 - 1
                or item["history_status"] not in {"as_of", "as_of_later_corrected", "current_counterpart"}
            ):
                raise validation("Ask historical evidence metadata is invalid.")
            _validate_timestamp(item["recorded_at"], strict=True)
    if version == "2.0":
        assert temporal is not None
        _validate_history_pairs(histories, temporal["mode"])
    canonical = _canonical(value)
    return value, hashlib.sha256(canonical).hexdigest()


def _validate_timestamp(value: Any, *, strict: bool = False) -> datetime:
    pattern = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$" if strict else None
    if not isinstance(value, str) or len(value) > 40 or (pattern and re.fullmatch(pattern, value) is None):
        raise validation("Ask evidence timestamp is invalid.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed
    except ValueError:
        raise validation("Ask evidence timestamp is invalid.") from None


def _validate_temporal(value: Any) -> dict[str, Any]:
    keys = {"mode", "start_utc", "end_exclusive_utc", "display_date", "display_timezone"}
    if (
        not isinstance(value, dict)
        or set(value) != keys
        or not isinstance(value["mode"], str)
        or value["mode"] not in {"as_of", "compare_to_current"}
        or not isinstance(value["display_date"], str)
        or not isinstance(value["display_timezone"], str)
    ):
        raise validation("Ask temporal selection is invalid.")
    start = _validate_timestamp(value["start_utc"], strict=True)
    end = _validate_timestamp(value["end_exclusive_utc"], strict=True)
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value["display_date"]):
        raise validation("Ask display date is invalid.")
    try:
        display_date = datetime.strptime(value["display_date"], "%Y-%m-%d").date()
        zone = ZoneInfo(value["display_timezone"])
    except (ValueError, TypeError, ZoneInfoNotFoundError):
        raise validation("Ask display timezone or date is invalid.") from None
    if start >= end or not 23 * 3600 <= (end - start).total_seconds() <= 25 * 3600:
        raise validation("Ask historical interval must cover one local calendar day.")
    local_start, local_end = start.astimezone(zone), end.astimezone(zone)
    if (
        local_start.date() != display_date
        or local_start.timetz().replace(tzinfo=None) != datetime.min.time()
        or local_end.date() != display_date + timedelta(days=1)
        or local_end.timetz().replace(tzinfo=None) != datetime.min.time()
    ):
        raise validation("Ask interval does not match its displayed local date.")
    return value


def _validate_history_pairs(histories: dict[str, list[dict[str, Any]]], mode: str) -> None:
    for items in histories.values():
        roles = [x["history_status"] for x in items]
        if (
            len(items) > 2
            or len(set(roles)) != len(items)
            or len({(x["memory_revision"], x["evidence_kind"]) for x in items}) != len(items)
            or len({x["current_revision"] for x in items}) != 1
            or len({x["source_sha256"] for x in items}) != 1
        ):
            raise validation("Ask historical evidence has duplicate or excessive revisions.")
        if any(
            x["history_status"] == "current_counterpart" and x["memory_revision"] != x["current_revision"]
            for x in items
        ):
            raise validation("Current counterpart must identify the current revision.")
        if mode == "compare_to_current":
            if (
                len(items) != 2
                or "current_counterpart" not in roles
                or not set(roles) & {"as_of", "as_of_later_corrected"}
            ):
                raise validation("Historical comparison evidence must be paired.")
        elif "as_of_later_corrected" in roles and "current_counterpart" not in roles:
            raise validation("Later-corrected evidence requires its current counterpart.")
        elif "current_counterpart" in roles and "as_of_later_corrected" not in roles:
            raise validation("Current counterpart requires later-corrected evidence.")


@dataclass(frozen=True)
class IntelligenceGrant:
    user_id: uuid.UUID
    workspace_id: uuid.UUID
    device_id: uuid.UUID
    vault_id: uuid.UUID


class IntelligenceAuthorizer:
    """Independently resolve a revocable vault_intelligence bearer on each request."""

    def __init__(self, db: Database):
        self.db = db

    def verify(self, authorization: str | None) -> IntelligenceGrant:
        from ..pairing import digest, validate_secret

        if not authorization or not authorization.startswith("Bearer "):
            raise forbidden("A private vault intelligence connection is not configured.")
        secret = authorization[7:]
        try:
            validate_secret(secret)
        except ValueError:
            raise forbidden("A private vault intelligence connection is not configured.") from None
        with self.db.pool.connection() as conn:
            row = conn.execute("select * from recall_vault_intelligence_auth(%s)", (digest(secret),)).fetchone()
            conn.rollback()
        if row is None:
            raise forbidden("A private vault intelligence connection is not configured.")
        return IntelligenceGrant(row["user_id"], row["workspace_id"], row["device_id"], row["vault_id"])


def create_intelligence_invitation(
    conn: psycopg.Connection[Any],
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    device_id: uuid.UUID,
    vault_id: uuid.UUID,
    fingerprint: str,
    ttl_seconds: int = 600,
) -> tuple[str, datetime]:
    if _SHA.fullmatch(fingerprint) is None or not 30 <= ttl_seconds <= 900:
        raise ValueError("invalid fingerprint or invitation lifetime")
    row = conn.execute(
        "select * from recall_vault_intelligence_invite(%s,%s,%s,%s,%s,%s)",
        (user_id, workspace_id, device_id, vault_id, fingerprint, ttl_seconds),
    ).fetchone()
    if row is None:
        raise ValueError("invitation was not created")
    return str(row[0]), row[1]


def set_ask_consent(
    conn: psycopg.Connection[Any], *, user_id: uuid.UUID, workspace_id: uuid.UUID, enabled: bool, policy_version: str
) -> None:
    if not policy_version or len(policy_version) > 160:
        raise ValueError("invalid Ask policy version")
    owner = conn.execute(
        "select 1 from workspace_members where workspace_id=%s and user_id=%s and role='owner'",
        (workspace_id, user_id),
    ).fetchone()
    first = conn.execute(
        "select workspace_id from workspace_members where user_id=%s order by created_at,workspace_id limit 1",
        (user_id,),
    ).fetchone()
    if owner is None or first is None or first[0] != workspace_id:
        raise ValueError("owner workspace binding invalid")
    conn.execute(
        "insert into vault_intelligence_ask_consents(workspace_id,enabled,policy_version,decided_by) "
        "values(%s,%s,%s,%s) on conflict(workspace_id) do update set enabled=excluded.enabled, "
        "policy_version=excluded.policy_version,decided_by=excluded.decided_by,decided_at=now(), "
        "version=vault_intelligence_ask_consents.version+1",
        (workspace_id, enabled, policy_version, user_id),
    )


def revoke_lost_intelligence_device(
    conn: psycopg.Connection[Any],
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    device_id: uuid.UUID,
    vault_id: uuid.UUID,
) -> bool:
    row = conn.execute(
        "select recall_vault_intelligence_owner_revoke(%s,%s,%s,%s)",
        (user_id, workspace_id, device_id, vault_id),
    ).fetchone()
    return bool(row and row[0])


def vault_intelligence_pairing_routes(app: FastAPI, db: Database) -> None:
    """Separate invitation claim and protected status/revoke routes for Ask scope."""
    from ..pairing import digest

    authorizer = IntelligenceAuthorizer(db)

    @app.post("/v1/vault-intelligence/device-pairings/{invitation_id}/claim")
    async def claim(invitation_id: str, request: Request) -> JSONResponse:
        if not _canonical_uuid(invitation_id):
            raise validation("Invalid pairing invitation.")
        declared = request.headers.get("content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > 4096):
            raise validation("Pairing request is too large.")
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > 4096:
                raise validation("Pairing request is too large.")
            raw.extend(chunk)
        try:
            body = json.loads(bytes(raw).decode("utf-8"), object_pairs_hook=_object)
            _valid_unicode(body)
        except (UnicodeDecodeError, UnicodeEncodeError, ValueError, TypeError):
            raise validation("Invalid pairing request.") from None
        if not isinstance(body, dict) or set(body) != {"secret"} or not isinstance(body["secret"], str):
            raise validation("Invalid pairing request.")
        from ..pairing import validate_secret

        try:
            validate_secret(body["secret"])
            with db.pool.connection() as conn:
                row = conn.execute(
                    "select * from recall_vault_intelligence_claim(%s,%s)",
                    (uuid.UUID(invitation_id), digest(body["secret"])),
                ).fetchone()
                conn.commit()
        except (ValueError, psycopg.Error):
            raise forbidden("Pairing invitation is unavailable or does not match this device.") from None
        if row is None:
            raise forbidden("Pairing invitation is unavailable or does not match this device.")
        return JSONResponse(
            {"device_id": str(row["device_id"]), "vault_id": str(row["vault_id"]), "scope": row["scope"]},
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/v1/vault-intelligence/device-pairings/status")
    def status(request: Request) -> JSONResponse:
        grant = authorizer.verify(request.headers.get("authorization"))
        authorizer.verify(request.headers.get("authorization"))
        return JSONResponse(
            {"device_id": str(grant.device_id), "vault_id": str(grant.vault_id), "scope": "vault_intelligence"},
            headers={"Cache-Control": "no-store"},
        )

    @app.delete("/v1/vault-intelligence/device-pairings")
    def disconnect(request: Request) -> JSONResponse:
        authorization = request.headers.get("authorization")
        grant = authorizer.verify(authorization)
        secret = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
        with db.pool.connection() as conn:
            row = conn.execute("select recall_vault_intelligence_revoke(%s) as revoked", (digest(secret),)).fetchone()
            conn.commit()
        return JSONResponse(
            {
                "confirmed": True,
                "revoked": bool(row and row["revoked"]),
                "device_id": str(grant.device_id),
                "vault_id": str(grant.vault_id),
                "scope": "vault_intelligence",
            },
            headers={"Cache-Control": "no-store"},
        )


class LocalIntelligenceService:
    def __init__(self, db: Database, settings: Settings, authorizer: IntelligenceAuthorizer, provider: Provider | None):
        self.db, self.settings, self.authorizer, self.provider = db, settings, authorizer, provider
        self.answer_schema = copy.deepcopy(ANSWER_SCHEMA)
        self.answer_schema["properties"]["sentences"]["items"]["properties"]["citation_ids"]["uniqueItems"] = True

    @contextmanager
    def tx(self, grant: IntelligenceGrant) -> Iterator[Tx]:
        try:
            with self.db.tx(grant.user_id) as tx:
                if tx.workspace_id != grant.workspace_id:
                    raise forbidden("Device workspace is unavailable.")
                yield tx
        except LookupError:
            raise forbidden("Device workspace is unavailable.") from None

    def authorize(self, authorization: str | None, prior: IntelligenceGrant | None = None) -> IntelligenceGrant:
        grant = self.authorizer.verify(authorization)
        if prior is not None and grant != prior:
            raise forbidden("Device connection changed.")
        with self.tx(grant):
            pass
        return grant

    def consent_active(self, tx: Tx) -> bool:
        active, _, _ = self.consent_decision(tx)
        return active

    def consent_decision(self, tx: Tx, *, lock: bool = False) -> tuple[bool, str | None, int | None]:
        if lock:
            row = tx.one(
                "select enabled,policy_version,version from vault_intelligence_ask_consents "
                "where workspace_id=%s for update",
                (tx.workspace_id,),
            )
        else:
            row = tx.one(
                "select enabled,policy_version,version from vault_intelligence_ask_consents where workspace_id=%s",
                (tx.workspace_id,),
            )
        if row is None:
            return False, None, None
        return (
            bool(
                row["enabled"]
                and row["policy_version"] in {self.settings.ai_policy_version, self.history_policy_version}
            ),
            row["policy_version"],
            row["version"],
        )

    @property
    def history_policy_version(self) -> str:
        return f"ask-history-v1|{self.settings.ai_policy_version}"

    @staticmethod
    def receipt_consent_matches(row: Row, decision: tuple[bool, str | None, int | None]) -> bool:
        active, policy_version, consent_version = decision
        return bool(
            active and row["consent_policy_version"] == policy_version and row["consent_version"] == consent_version
        )

    @staticmethod
    def grant_active(tx: Tx, authorization: str | None, grant: IntelligenceGrant) -> bool:
        if not authorization or not authorization.startswith("Bearer "):
            return False
        secret = authorization[7:]
        row = tx.one("select * from recall_vault_intelligence_auth(%s)", (pairing_digest(secret),))
        return bool(
            row
            and row["user_id"] == grant.user_id
            and row["workspace_id"] == grant.workspace_id
            and row["device_id"] == grant.device_id
            and row["vault_id"] == grant.vault_id
        )

    def capability(self, grant: IntelligenceGrant) -> dict[str, Any]:
        with self.tx(grant) as tx:
            active, _, _ = self.consent_decision(tx)
        enabled = bool(
            self.settings.local_intelligence_enabled
            and self.settings.ai_configured
            and self.provider is not None
            and active
        )
        return {"scope": "vault_intelligence", "consent": "active" if active else "missing", "enabled": enabled}

    def history_capability(self, grant: IntelligenceGrant) -> dict[str, Any]:
        with self.tx(grant) as tx:
            active, policy, version = self.consent_decision(tx)
        provider_enabled = bool(
            self.settings.local_intelligence_enabled and self.settings.ai_configured and self.provider is not None
        )
        history_active = bool(active and policy == self.history_policy_version)
        history_consent = "active" if history_active else ("outdated" if active else "missing")
        return {
            "scope": "vault_intelligence",
            "history_consent": history_consent,
            "history_enabled": bool(provider_enabled and history_active),
            "consent_version": version or 0,
            "history_policy_version": self.history_policy_version,
        }

    def require_history_consent_owner(self, grant: IntelligenceGrant) -> None:
        with self.tx(grant) as tx:
            owner = tx.one(
                "select 1 from workspace_members where workspace_id=%s and user_id=%s and role='owner'",
                (grant.workspace_id, grant.user_id),
            )
            first = tx.one(
                "select workspace_id from workspace_members where user_id=%s order by created_at,workspace_id limit 1",
                (grant.user_id,),
            )
        if owner is None or first is None or first["workspace_id"] != grant.workspace_id:
            raise forbidden("Only the owner of the first workspace can change Ask consent.")

    def set_history_consent(
        self,
        grant: IntelligenceGrant,
        authorization: str | None,
        *,
        enable_history: bool,
        expected_version: int,
    ) -> dict[str, Any]:
        with self.tx(grant) as tx:
            if not self.grant_active(tx, authorization, grant):
                raise forbidden("Device connection changed.")
            owner = tx.one(
                "select 1 from workspace_members where workspace_id=%s and user_id=%s and role='owner'",
                (grant.workspace_id, grant.user_id),
            )
            first = tx.one(
                "select workspace_id from workspace_members where user_id=%s order by created_at,workspace_id limit 1",
                (grant.user_id,),
            )
            if owner is None or first is None or first["workspace_id"] != grant.workspace_id:
                raise forbidden("Only the owner of the first workspace can change Ask consent.")
            row = tx.one(
                "select enabled,policy_version,version from vault_intelligence_ask_consents "
                "where workspace_id=%s for update",
                (grant.workspace_id,),
            )
            current_version = int(row["version"]) if row is not None else 0
            if current_version != expected_version:
                raise ApiError("CONSENT_VERSION_CONFLICT", "Ask consent changed; refresh capability.", 409)
            if (
                row is None
                or not row["enabled"]
                or row["policy_version"]
                not in {
                    self.settings.ai_policy_version,
                    self.history_policy_version,
                }
            ):
                raise ApiError("CONSENT_REQUIRED", "Enable current Ask before changing history consent.", 409)
            policy = self.history_policy_version if enable_history else self.settings.ai_policy_version
            if row["policy_version"] != policy:
                tx.run(
                    "update vault_intelligence_ask_consents set policy_version=%s,version=version+1,"
                    "decided_at=now() where workspace_id=%s and version=%s",
                    (policy, grant.workspace_id, expected_version),
                )
        return self.history_capability(grant)

    @staticmethod
    def _view(row: Row, grant: IntelligenceGrant) -> dict[str, Any]:
        return {
            "schema_version": "1.0",
            "operation_id": str(row["operation_id"]),
            "vault_id": str(grant.vault_id),
            "payload_sha256": row["payload_sha256"],
            "state": row["state"],
            "result": row["result"],
            "error_code": row["error_code"],
        }

    def expire(self) -> None:
        with self.db.pool.connection() as conn:
            conn.execute("select recall_expire_local_intelligence()")
            conn.commit()

    def recover(self, grant: IntelligenceGrant, operation_id: str) -> dict[str, Any]:
        self.expire()
        unavailable = False
        result: dict[str, Any] | None = None
        with self.tx(grant) as tx:
            row = tx.one(
                "select * from local_intelligence_receipts where workspace_id=%s and device_id=%s "
                "and vault_id=%s and operation_id=%s",
                (grant.workspace_id, grant.device_id, grant.vault_id, operation_id),
            )
            if row is None:
                raise not_found()
            if row["consent_required"] and not self.receipt_consent_matches(row, self.consent_decision(tx, lock=True)):
                if row["state"] == "complete" and row["result"] is not None:
                    tx.run(
                        "update local_intelligence_receipts set state='failed',result=null,"
                        "error_code='AUTHORIZATION_CHANGED' where workspace_id=%s and device_id=%s "
                        "and vault_id=%s and operation_id=%s and state='complete'",
                        (grant.workspace_id, grant.device_id, grant.vault_id, operation_id),
                    )
                unavailable = True
            else:
                result = self._view(row, grant)
        if unavailable:
            raise forbidden("Ask consent decision has changed.")
        assert result is not None
        return result

    @staticmethod
    def _request_hits(request: dict[str, Any]) -> list[dict[str, Any]]:
        hits: list[dict[str, Any]] = []
        for item in request["evidence"]:
            hits.append(
                {
                    "memory_id": item["memory_id"],
                    "memory_revision": item["memory_revision"],
                    "source_sha256": item["source_sha256"],
                    "evidence_kind": item["evidence_kind"],
                    "kind": item["evidence_kind"],
                    "epistemic_state": item["epistemic_state"],
                    "captured_at": item["captured_at"],
                    "page": None,
                    "capture_id": item["memory_id"],
                    "source_id": item["memory_id"],
                    "text": item["excerpt"],
                    "excerpt": item["excerpt"],
                    **(
                        {
                            "recorded_at": item["recorded_at"],
                            "history_status": item["history_status"],
                            "event_sha256": item["event_sha256"],
                            "current_revision": item["current_revision"],
                            "history_mode": request["temporal"]["mode"],
                        }
                        if request["schema_version"] == "2.0"
                        else {}
                    ),
                }
            )
        return hits

    def _reserve(
        self,
        tx: Tx,
        settings: Settings,
        *,
        consent_policy_version: str,
        consent_version: int,
        **kwargs: Any,
    ) -> uuid.UUID:
        return processing.reserve_provider_budget(
            tx,
            settings,
            **kwargs,
            consent_check=lambda scoped_tx, _settings: (
                self.consent_decision(scoped_tx) == (True, consent_policy_version, consent_version)
            ),
        )

    def ask(
        self, authorization: str | None, grant: IntelligenceGrant, request: dict[str, Any], digest: str
    ) -> dict[str, Any]:
        if request["vault_id"] != str(grant.vault_id):
            raise forbidden("Device vault scope does not match.")
        if request["schema_version"] == "2.0":
            with self.tx(grant) as tx:
                active, policy, _ = self.consent_decision(tx)
            if not active or policy != self.history_policy_version:
                raise ApiError("HISTORY_CONSENT_REQUIRED", "Explicit historical Ask consent is required.", 409)
        operation = request["operation_id"]
        consent_version: int | None = None
        consent_policy_version: str | None = None
        prior_result: dict[str, Any] | None = None
        prior_unavailable = False
        self.expire()
        with self.tx(grant) as tx:
            prior = tx.one(
                "select * from local_intelligence_receipts where workspace_id=%s and device_id=%s "
                "and vault_id=%s and operation_id=%s",
                (grant.workspace_id, grant.device_id, grant.vault_id, operation),
            )
            if prior is not None:
                if prior["payload_sha256"] != digest:
                    raise idempotency_conflict()
                if prior["consent_required"] and not self.receipt_consent_matches(
                    prior, self.consent_decision(tx, lock=True)
                ):
                    if prior["state"] == "complete" and prior["result"] is not None:
                        tx.run(
                            "update local_intelligence_receipts set state='failed',result=null,"
                            "error_code='AUTHORIZATION_CHANGED' where workspace_id=%s and device_id=%s "
                            "and vault_id=%s and operation_id=%s and state='complete'",
                            (grant.workspace_id, grant.device_id, grant.vault_id, operation),
                        )
                    prior_unavailable = True
                else:
                    prior_result = self._view(prior, grant)
            elif not request["evidence"]:
                result = {
                    "status": "insufficient_evidence",
                    "sentences": [],
                    "limitations": ["No eligible evidence was selected."],
                }
                tx.run(
                    "insert into local_intelligence_receipts(workspace_id,device_id,vault_id,operation_id,"
                    "payload_sha256,state,result,consent_required) "
                    "values(%s,%s,%s,%s,%s,'complete',%s,false)",
                    (grant.workspace_id, grant.device_id, grant.vault_id, operation, digest, Jsonb(result)),
                )
                row = tx.one(
                    "select * from local_intelligence_receipts where workspace_id=%s and device_id=%s "
                    "and vault_id=%s and operation_id=%s",
                    (grant.workspace_id, grant.device_id, grant.vault_id, operation),
                )
                assert row is not None
                prior_result = self._view(row, grant)
            elif (
                not self.settings.local_intelligence_enabled or not self.settings.ai_configured or self.provider is None
            ):
                raise ApiError("AI_NOT_CONFIGURED", "Local Ask is not currently enabled.", 409)
            else:
                try:
                    active_consent, consent_policy_version, consent_version = self.consent_decision(tx, lock=True)
                    if not active_consent or consent_policy_version is None or consent_version is None:
                        raise processing.BudgetReservationError("CONSENT_REQUIRED")
                    hits = self._request_hits(request)
                    reservation = self._reserve(
                        tx,
                        self.settings,
                        consent_policy_version=consent_policy_version,
                        consent_version=consent_version,
                        purpose="answer",
                        model_id=self.settings.ai_model_id or "",
                        max_input_tokens=answer_max_input_tokens(request["question"], hits),
                        max_output_tokens=MAX_ANSWER_OUTPUT_TOKENS,
                    )
                except processing.BudgetReservationError as exc:
                    raise ApiError(str(exc), "Local Ask is not currently permitted.", 409) from None
                tx.run(
                    "insert into local_intelligence_receipts(workspace_id,device_id,vault_id,operation_id,"
                    "payload_sha256,state,reservation_id,consent_policy_version,consent_version) "
                    "values(%s,%s,%s,%s,%s,'in_flight',%s,%s,%s)",
                    (
                        grant.workspace_id,
                        grant.device_id,
                        grant.vault_id,
                        operation,
                        digest,
                        reservation,
                        consent_policy_version,
                        consent_version,
                    ),
                )
        if prior_unavailable:
            raise forbidden("Ask consent decision has changed.")
        if prior_result is not None:
            return prior_result
        state, error_code, uncertain = "complete", None, False
        result_body: dict[str, Any] | None = None
        usage: ProviderResult | None = None
        assert consent_version is not None
        assert self.provider is not None
        try:
            self.authorize(authorization, grant)
            with self.tx(grant) as tx:
                if not self.grant_active(tx, authorization, grant) or self.consent_decision(tx) != (
                    True,
                    consent_policy_version,
                    consent_version,
                ):
                    raise forbidden("Ask consent is unavailable.")
            provider_result = self.provider.answer(
                AnswerRequest(request["question"], build_packet(hits), self.answer_schema)
            )
            expected_input = answer_max_input_tokens(request["question"], hits)
            if (
                provider_result.model_id != self.settings.ai_model_id
                or type(provider_result.input_tokens) is not int
                or type(provider_result.output_tokens) is not int
                or not 0 <= provider_result.input_tokens <= expected_input
                or not 0 <= provider_result.output_tokens <= MAX_ANSWER_OUTPUT_TOKENS
            ):
                raise RuntimeError("provider accounting did not match the reservation")
            usage = provider_result
            try:
                parsed_output = json.loads(
                    provider_result.text,
                    object_pairs_hook=_object,
                    parse_float=_reject_number,
                    parse_constant=_reject_number,
                )
                _valid_unicode(parsed_output)
            except (ValueError, TypeError, UnicodeEncodeError):
                parsed_output = None
            schema_valid = parsed_output is not None and Draft202012Validator(self.answer_schema).is_valid(
                parsed_output
            )
            verified = verify_answer(provider_result.text, hits) if schema_valid else None
            if verified is None:
                result_body = {
                    "status": "insufficient_evidence",
                    "sentences": [],
                    "limitations": ["The answer could not be verified against the selected evidence."],
                }
            else:
                result_body = {
                    "status": verified["status"],
                    "sentences": verified["sentences"],
                    "limitations": verified["limitations"],
                }
                if request["schema_version"] == "2.0":
                    result_body = self._enforce_history_answer(request, hits, result_body)
        except ApiError:
            state, error_code = "failed", "AUTHORIZATION_CHANGED"
        except ProviderError as exc:
            if (
                exc.model_id == self.settings.ai_model_id
                and exc.model_id is not None
                and type(exc.usage[0]) is int
                and type(exc.usage[1]) is int
                and 0 <= exc.usage[0] <= answer_max_input_tokens(request["question"], hits)
                and 0 <= exc.usage[1] <= MAX_ANSWER_OUTPUT_TOKENS
            ) and any(exc.usage):
                usage = ProviderResult("", exc.model_id, *exc.usage)
                state, error_code = "failed", "PROVIDER_FAILED"
            elif not exc.retryable and not any(exc.usage):
                state, error_code = "failed", "PROVIDER_REJECTED"
            else:
                state, error_code, uncertain = "unknown", "PROVIDER_OUTCOME_UNKNOWN", True
        except Exception:
            state, error_code, uncertain = "unknown", "PROVIDER_OUTCOME_UNKNOWN", True
        with self.tx(grant) as tx:
            processing.finalize_provider_reservation(
                tx, self.settings, reservation, purpose="answer", job_id=None, result=usage, uncertain=uncertain
            )
            current_consent = self.consent_decision(tx, lock=True)
            current_grant = self.grant_active(tx, authorization, grant)
            if (
                state == "complete"
                and result_body is not None
                and (current_consent != (True, consent_policy_version, consent_version) or not current_grant)
            ):
                state, error_code, result_body = "failed", "AUTHORIZATION_CHANGED", None
            tx.run(
                "update local_intelligence_receipts set state=%s,result=%s,error_code=%s "
                "where workspace_id=%s and device_id=%s and vault_id=%s and operation_id=%s "
                "and state='in_flight' and expires_at>now()",
                (
                    state,
                    Jsonb(result_body) if result_body is not None and state == "complete" else None,
                    error_code,
                    grant.workspace_id,
                    grant.device_id,
                    grant.vault_id,
                    operation,
                ),
            )
        self.authorize(authorization, grant)
        if result_body is not None:
            with self.tx(grant) as tx:
                if self.consent_decision(tx) != (True, consent_policy_version, consent_version):
                    raise forbidden("Ask consent is unavailable.")
        return self.recover(grant, operation)

    @staticmethod
    def _enforce_history_answer(
        request: dict[str, Any], hits: list[dict[str, Any]], result: dict[str, Any]
    ) -> dict[str, Any]:
        if result["status"] == "answered":
            by_id = {f"c{i}": hit for i, hit in enumerate(hits, 1)}
            valid = True
            for sentence in result["sentences"]:
                cited = [by_id[cid] for cid in sentence["citation_ids"]]
                roles = {item["history_status"] for item in cited}
                if request["temporal"]["mode"] == "compare_to_current":
                    valid = valid and any(x in {"as_of", "as_of_later_corrected"} for x in roles)
                    valid = valid and "current_counterpart" in roles
                    memories: dict[str, set[str]] = {}
                    for item in cited:
                        memories.setdefault(item["memory_id"], set()).add(item["history_status"])
                    valid = valid and any(
                        "current_counterpart" in pair and ("as_of" in pair or "as_of_later_corrected" in pair)
                        for pair in memories.values()
                    )
                else:
                    valid = valid and any(x in {"as_of", "as_of_later_corrected"} for x in roles)
                    for item in cited:
                        if item["history_status"] == "as_of_later_corrected":
                            valid = valid and any(
                                other["memory_id"] == item["memory_id"]
                                and other["history_status"] == "current_counterpart"
                                for other in cited
                            )
            if not valid:
                result = {
                    "status": "insufficient_evidence",
                    "sentences": [],
                    "limitations": ["The answer could not be verified against paired historical evidence."],
                }
        mandatory: list[str] = []
        coverage = request["coverage"]
        if coverage["limited"]:
            mandatory.append("The selected evidence window is limited; additional eligible history was not sent.")
        if coverage["truncated_count"]:
            mandatory.append("One or more selected historical excerpts were truncated.")
        mandatory.append(
            "Recorded time identifies when Recall stored a revision; it does not prove when an event occurred."
        )
        existing = [x for x in result["limitations"] if x not in mandatory]
        return {**result, "limitations": mandatory + existing[: 6 - len(mandatory)]}
