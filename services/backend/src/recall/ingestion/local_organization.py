"""Remembered-consent organization receipts for selected local-vault sources."""

from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import io
import json
import logging
import re
import warnings
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Any

from PIL import Image
from psycopg.types.json import Jsonb

from ..config import Settings
from ..db.database import Database, Row, Tx
from ..domain import processing
from ..domain.manifest import find_schema_path, load_schema
from ..errors import ApiError, forbidden, hash_mismatch, idempotency_conflict, not_found, unsupported_media, validation
from ..pairing import digest as pairing_digest
from .images import TRANSFORM_VERSION, DerivativeError, make_derivative
from .local_intelligence import (
    IntelligenceAuthorizer,
    IntelligenceGrant,
    _canonical,
    _canonical_uuid,
    _object,
    _reject_number,
    _valid_unicode,
)
from .local_reading import MAX_RESULT_BYTES, MEDIA_FORMATS, validate_selected_extraction, validate_storage_strings
from .provider import InterpretRequest, InterpretTextRequest, PageImage, Provider, ProviderError, ProviderResult
from .validate import InvalidExtraction, Validated, validate_extraction
from .worker import MAX_INTERPRET_OUTPUT_TOKENS, MAX_INTERPRET_TEXT_INPUT_TOKENS, MAX_VISUAL_TOKENS_PER_PAGE

_logger = logging.getLogger(__name__)
_SHA = re.compile(r"^[0-9a-f]{64}$")
_DATE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})$"
)
_SEMANTIC_FIELDS = (
    "summary",
    "summary_evidence",
    "mentions",
    "statements",
    "action_suggestions",
    "uncertainties",
)
MAX_V2_HEADER_BYTES = 3072
MAX_V2_BINDING_BYTES = 2300  # also bounds the decoded version 3.0 audio binding
# Text/photo (1.0/2.0) and audio-transcript (3.0) consent live in separate tables with identical shape. The two
# fixed statements per purpose keep any request data out of SQL text.
_CONSENT_SELECT = {
    False: (
        "select enabled,policy_version,consent_epoch,decided_at from vault_intelligence_organize_consents "
        "where workspace_id=%s and device_id=%s and vault_id=%s"
    ),
    True: (
        "select enabled,policy_version,consent_epoch,decided_at from vault_intelligence_audio_organize_consents "
        "where workspace_id=%s and device_id=%s and vault_id=%s"
    ),
}
_CONSENT_UPSERT_TAIL = (
    "policy_version,decided_by,consent_epoch) values(%s,%s,%s,%s,%s,%s,%s) "
    "on conflict(workspace_id,device_id,vault_id) do update set enabled=excluded.enabled,"
    "policy_version=excluded.policy_version,decided_by=excluded.decided_by,decided_at=now(),"
    "consent_epoch=excluded.consent_epoch"
)
_CONSENT_UPSERT = {
    False: "insert into vault_intelligence_organize_consents(workspace_id,device_id,vault_id,enabled,"
    + _CONSENT_UPSERT_TAIL,
    True: "insert into vault_intelligence_audio_organize_consents(workspace_id,device_id,vault_id,enabled,"
    + _CONSENT_UPSERT_TAIL,
}
_AUDIO_TRANSCRIPT_EVIDENCE = {"machine_unreviewed", "human_corrected"}
_EVIDENCE_KINDS = {"text_source", "human_note", "human_reading_correction", "machine_reading"}
_EPISTEMIC_STATES = {"reported", "uncertain", "question", "unreviewed"}


def parse_binding(raw: str) -> dict[str, Any]:
    try:
        if raw.startswith(("v2.", "v3.")):
            if not raw.isascii() or len(raw) > MAX_V2_HEADER_BYTES:
                raise ValueError
            encoded = raw[3:]
            if not encoded or "=" in encoded:
                raise ValueError
            decoded = base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True)
            if base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=") != encoded:
                raise ValueError
            if len(decoded) > MAX_V2_BINDING_BYTES:
                raise ValueError
            binding = json.loads(
                decoded.decode("utf-8", errors="strict"),
                object_pairs_hook=_object,
                parse_float=_reject_number,
                parse_constant=_reject_number,
            )
            if (
                json.dumps(binding, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
                != decoded
            ):
                raise ValueError
            if not isinstance(binding, dict):
                raise ValueError
            if raw.startswith("v3."):
                _validate_v3_binding(binding)
            else:
                _validate_v2_binding(binding)
            return binding
        if len(raw.encode("utf-8", errors="strict")) > 4096:
            raise ValueError
        binding = json.loads(raw, object_pairs_hook=_object, parse_float=_reject_number, parse_constant=_reject_number)
        _valid_unicode(binding)
        if not isinstance(binding, dict) or set(binding) != {
            "schema_version",
            "operation_id",
            "vault_id",
            "memory_id",
            "source_kind",
            "source_sha256",
            "expected_revision",
            "input_sha256",
            "consent_epoch",
            "captured_at",
        }:
            raise ValueError
        if binding["schema_version"] != "1.0" or any(
            not _canonical_uuid(binding[k]) for k in ("operation_id", "vault_id", "memory_id")
        ):
            raise ValueError
        if binding["source_kind"] not in ("text", "photo"):
            raise ValueError
        if any(
            not isinstance(binding[k], str) or _SHA.fullmatch(binding[k]) is None
            for k in ("source_sha256", "input_sha256")
        ):
            raise ValueError
        if type(binding["expected_revision"]) is not int or not 1 <= binding["expected_revision"] <= 2**53 - 1:
            raise ValueError
        if type(binding["consent_epoch"]) is not int or binding["consent_epoch"] < 1:
            raise ValueError
        captured = binding["captured_at"]
        if not isinstance(captured, str) or len(captured) > 40 or _DATE.fullmatch(captured) is None:
            raise ValueError
        if datetime.fromisoformat(captured.replace("Z", "+00:00")).tzinfo is None:
            raise ValueError
        return binding
    except (UnicodeError, ValueError, TypeError, AttributeError, binascii.Error):
        raise validation("X-Recall-Organization must contain a valid version 1.0, 2.0 or 3.0 binding.") from None


def _validate_v3_binding(binding: Any) -> None:
    """Audio-transcript binding: no related-memory context fields (a context-bearing audio binding is 3.1)."""
    keys = {
        "schema_version",
        "operation_id",
        "vault_id",
        "memory_id",
        "source_kind",
        "source_sha256",
        "expected_revision",
        "input_sha256",
        "derivative_sha256",
        "transcript_revision",
        "transcript_evidence_kind",
        "consent_epoch",
        "captured_at",
    }
    if not isinstance(binding, dict) or set(binding) != keys:
        raise ValueError
    if binding["schema_version"] != "3.0" or any(
        not _canonical_uuid(binding[k]) for k in ("operation_id", "vault_id", "memory_id")
    ):
        raise ValueError
    if binding["source_kind"] != "audio_transcript":
        raise ValueError
    if any(
        not isinstance(binding[k], str) or _SHA.fullmatch(binding[k]) is None
        for k in ("source_sha256", "input_sha256", "derivative_sha256")
    ):
        raise ValueError
    for key in ("expected_revision", "transcript_revision"):
        if type(binding[key]) is not int or not 1 <= binding[key] <= 2**53 - 1:
            raise ValueError
    if (
        not isinstance(binding["transcript_evidence_kind"], str)
        or binding["transcript_evidence_kind"] not in _AUDIO_TRANSCRIPT_EVIDENCE
    ):
        raise ValueError
    if type(binding["consent_epoch"]) is not int or binding["consent_epoch"] < 1:
        raise ValueError
    captured = binding["captured_at"]
    if not isinstance(captured, str) or len(captured) > 40 or _DATE.fullmatch(captured) is None:
        raise ValueError
    if datetime.fromisoformat(captured.replace("Z", "+00:00")).tzinfo is None:
        raise ValueError


def _validate_v2_binding(binding: Any) -> None:
    base = {
        "schema_version",
        "operation_id",
        "vault_id",
        "memory_id",
        "source_kind",
        "source_sha256",
        "expected_revision",
        "input_sha256",
        "consent_epoch",
        "captured_at",
    }
    if not isinstance(binding, dict) or set(binding) != base | {"context_coverage", "context"}:
        raise ValueError
    if binding["schema_version"] != "2.0" or any(
        not _canonical_uuid(binding[k]) for k in ("operation_id", "vault_id", "memory_id")
    ):
        raise ValueError
    if binding["source_kind"] not in ("text", "photo"):
        raise ValueError
    if any(
        not isinstance(binding[k], str) or _SHA.fullmatch(binding[k]) is None for k in ("source_sha256", "input_sha256")
    ):
        raise ValueError
    if type(binding["expected_revision"]) is not int or not 1 <= binding["expected_revision"] <= 2**53 - 1:
        raise ValueError
    if type(binding["consent_epoch"]) is not int or binding["consent_epoch"] < 1:
        raise ValueError
    captured = binding["captured_at"]
    if not isinstance(captured, str) or len(captured) > 40 or _DATE.fullmatch(captured) is None:
        raise ValueError
    if datetime.fromisoformat(captured.replace("Z", "+00:00")).tzinfo is None:
        raise ValueError
    coverage, context = binding["context_coverage"], binding["context"]
    if not isinstance(coverage, dict) or set(coverage) != {
        "eligible_count",
        "selected_count",
        "limited",
        "truncated_count",
    }:
        raise ValueError
    if any(
        type(coverage[k]) is not int or coverage[k] < 0 for k in ("eligible_count", "selected_count", "truncated_count")
    ):
        raise ValueError
    if type(coverage["limited"]) is not bool or not isinstance(context, list) or len(context) > 3:
        raise ValueError
    if coverage["selected_count"] != len(context) or coverage["eligible_count"] < len(context):
        raise ValueError
    if coverage["limited"] != (coverage["eligible_count"] > len(context)):
        raise ValueError
    ids: set[str] = set()
    for item in context:
        if not isinstance(item, dict) or set(item) != {
            "memory_id",
            "memory_revision",
            "source_sha256",
            "evidence_kind",
            "epistemic_state",
            "excerpt",
        }:
            raise ValueError
        if (
            not _canonical_uuid(item["memory_id"])
            or item["memory_id"] in ids
            or item["memory_id"] == binding["memory_id"]
        ):
            raise ValueError
        ids.add(item["memory_id"])
        if type(item["memory_revision"]) is not int or not 1 <= item["memory_revision"] <= 2**53 - 1:
            raise ValueError
        if not isinstance(item["source_sha256"], str) or _SHA.fullmatch(item["source_sha256"]) is None:
            raise ValueError
        if item["evidence_kind"] not in _EVIDENCE_KINDS or item["epistemic_state"] not in _EPISTEMIC_STATES:
            raise ValueError
        excerpt = item["excerpt"]
        if not isinstance(excerpt, str) or not excerpt.strip() or len(excerpt.encode("utf-8")) > 256:
            raise ValueError


class LocalOrganizationService:
    def __init__(
        self, db: Database, settings: Settings, authorizer: IntelligenceAuthorizer, provider: Provider | None
    ) -> None:
        self.db, self.settings, self.authorizer, self.provider = db, settings, authorizer, provider
        self.extraction_schema = load_schema(str(find_schema_path(settings).with_name("extraction.schema.json")))
        self.semantic_schema = {
            "$schema": self.extraction_schema["$schema"],
            "type": "object",
            "additionalProperties": False,
            "required": list(_SEMANTIC_FIELDS),
            "properties": {key: copy.deepcopy(self.extraction_schema["properties"][key]) for key in _SEMANTIC_FIELDS},
            "$defs": copy.deepcopy(self.extraction_schema["$defs"]),
        }

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

    def _policy_version(self, audio: bool) -> str:
        return self.settings.audio_organize_policy_version if audio else self.settings.organize_policy_version

    def _decision(
        self, tx: Tx, grant: IntelligenceGrant, *, lock: bool = False, audio: bool = False
    ) -> tuple[bool, str | None, int, datetime | None, bool]:
        query = _CONSENT_SELECT[audio] + (" for update" if lock else "")
        row = tx.one(query, (tx.workspace_id, grant.device_id, grant.vault_id))
        if row is None:
            return False, None, 0, None, False
        policy = row["policy_version"]
        active = bool(row["enabled"] and policy == self._policy_version(audio))
        return active, policy, row["consent_epoch"], row["decided_at"], bool(row["enabled"])

    def _capability(self, grant: IntelligenceGrant, tx: Tx, *, audio: bool = False) -> dict[str, Any]:
        active, policy, epoch, decided_at, saved_enabled = self._decision(tx, grant, audio=audio)
        configured = bool(self.settings.ai_configured and self.provider is not None)
        consent = "active" if active else "outdated" if saved_enabled else "missing"
        flag = self.settings.local_audio_organization_enabled if audio else self.settings.local_organization_enabled
        return {
            "schema_version": "1.0",
            "scope": "vault_intelligence",
            "purpose": "organize_audio" if audio else "organize",
            "vault_id": str(grant.vault_id),
            "policy_version": self._policy_version(audio),
            "provider": self.settings.ai_provider if configured else None,
            "consent": consent,
            "enabled": bool(active and flag and configured),
            "consent_epoch": epoch,
            "decided_at": decided_at.isoformat().replace("+00:00", "Z") if decided_at else None,
        }

    def capability(self, grant: IntelligenceGrant, *, audio: bool = False) -> dict[str, Any]:
        if len(self._policy_version(audio).encode("utf-8")) > 160:
            raise RuntimeError("organization policy version exceeds its database bound")
        with self.tx(grant) as tx:
            return self._capability(grant, tx, audio=audio)

    @staticmethod
    def parse_consent(raw: bytes) -> dict[str, Any]:
        try:
            value = json.loads(
                raw.decode("utf-8", errors="strict"),
                object_pairs_hook=_object,
                parse_float=_reject_number,
                parse_constant=_reject_number,
            )
            _valid_unicode(value)
        except (UnicodeDecodeError, UnicodeEncodeError, ValueError, TypeError):
            raise validation("Organization consent must be strict UTF-8 JSON.") from None
        if not isinstance(value, dict) or set(value) != {
            "schema_version",
            "policy_version",
            "enabled",
            "expected_consent_epoch",
        }:
            raise validation("Organization consent fields are invalid.")
        if (
            value["schema_version"] != "1.0"
            or not isinstance(value["policy_version"], str)
            or not 1 <= len(value["policy_version"].encode("utf-8")) <= 160
            or type(value["enabled"]) is not bool
            or type(value["expected_consent_epoch"]) is not int
            or value["expected_consent_epoch"] < 0
        ):
            raise validation("Organization consent values are invalid.")
        return value

    def set_consent(
        self, authorization: str | None, grant: IntelligenceGrant, body: dict[str, Any], *, audio: bool = False
    ) -> dict[str, Any]:
        policy_version = self._policy_version(audio)
        with self.tx(grant) as tx:
            if not self.grant_active(tx, authorization, grant):
                raise forbidden("Device connection changed.")
            suffix = "audio-organize-consent" if audio else "organize-consent"
            tx.run(
                "select pg_advisory_xact_lock(hashtextextended(%s,0))",
                (f"{grant.workspace_id}:{grant.device_id}:{grant.vault_id}:{suffix}",),
            )
            _, _, epoch, _, _ = self._decision(tx, grant, lock=True, audio=audio)
            if body["policy_version"] != policy_version:
                raise ApiError("POLICY_STALE", "Organization policy changed; refresh capability.", 409)
            if body["expected_consent_epoch"] != epoch:
                raise ApiError("CONSENT_STALE", "Organization consent changed; refresh capability.", 409)
            owner = tx.one(
                "select 1 as ok from workspace_members where workspace_id=%s and user_id=%s and role='owner'",
                (grant.workspace_id, grant.user_id),
            )
            if owner is None:
                raise forbidden("Organization consent requires the associated owner.")
            next_epoch = epoch + 1
            tx.run(
                _CONSENT_UPSERT[audio],
                (
                    grant.workspace_id,
                    grant.device_id,
                    grant.vault_id,
                    body["enabled"],
                    policy_version,
                    grant.user_id,
                    next_epoch,
                ),
            )
        with self.tx(grant) as tx:
            return self._capability(grant, tx, audio=audio)

    @staticmethod
    def grant_active(tx: Tx, authorization: str | None, grant: IntelligenceGrant) -> bool:
        if not authorization or not authorization.startswith("Bearer "):
            return False
        row = tx.one("select * from recall_vault_intelligence_auth(%s)", (pairing_digest(authorization[7:]),))
        return bool(
            row
            and row["user_id"] == grant.user_id
            and row["workspace_id"] == grant.workspace_id
            and row["device_id"] == grant.device_id
            and row["vault_id"] == grant.vault_id
        )

    def require_consent(self, grant: IntelligenceGrant, epoch: int, *, audio: bool = False) -> tuple[str, int]:
        with self.tx(grant) as tx:
            active, policy, current_epoch, _, _ = self._decision(tx, grant, audio=audio)
        if not active or policy != self._policy_version(audio) or current_epoch != epoch:
            raise forbidden("Organization consent is unavailable or has changed.")
        assert policy is not None
        return policy, current_epoch

    def _view(self, row: Row) -> dict[str, Any]:
        return {
            "schema_version": "1.0",
            "binding": row["binding"],
            "payload_sha256": row["payload_sha256"],
            "state": row["state"],
            "result": row["result"],
            "error_code": row["error_code"],
        }

    def expire(self) -> None:
        with self.db.pool.connection() as conn:
            conn.execute("select recall_expire_local_organizations()")
            conn.commit()

    def recover(self, grant: IntelligenceGrant, operation_id: str) -> dict[str, Any]:
        if not _canonical_uuid(operation_id):
            raise validation("Organization operation ID is invalid.")
        self.expire()
        unavailable = False
        result: dict[str, Any] | None = None
        with self.tx(grant) as tx:
            row = tx.one(
                "select * from local_organization_receipts where workspace_id=%s and device_id=%s "
                "and vault_id=%s and operation_id=%s",
                (grant.workspace_id, grant.device_id, grant.vault_id, operation_id),
            )
            if row is None:
                raise not_found()
            # A receipt is judged only against the consent purpose of the binding it was created under.
            receipt_audio = isinstance(row["binding"], dict) and row["binding"].get("schema_version") == "3.0"
            decision = self._decision(tx, grant, lock=True, audio=receipt_audio)
            if not (
                decision[0] and decision[1] == row["consent_policy_version"] and decision[2] == row["consent_epoch"]
            ):
                if row["state"] == "complete":
                    tx.run(
                        "update local_organization_receipts set state='failed',result=null,"
                        "error_code='AUTHORIZATION_CHANGED' where workspace_id=%s and device_id=%s "
                        "and vault_id=%s and operation_id=%s and state='complete'",
                        (grant.workspace_id, grant.device_id, grant.vault_id, operation_id),
                    )
                unavailable = True
            else:
                result = self._view(row)
        if unavailable:
            raise forbidden("Organization consent decision has changed.")
        assert result is not None
        return result

    @staticmethod
    def _text_result(
        raw: str,
        *,
        text: str,
        binding: dict[str, Any],
        digest: str,
        semantic_schema: dict[str, Any],
        extraction_schema: dict[str, Any],
        legibility: str = "clear",
    ) -> Validated:
        try:
            semantic = json.loads(
                raw, object_pairs_hook=_object, parse_float=_reject_number, parse_constant=_reject_number
            )
            _valid_unicode(semantic)
        except (ValueError, TypeError, UnicodeEncodeError):
            raise InvalidExtraction(["invalid semantic JSON"], "INVALID_JSON") from None
        if not isinstance(semantic, dict) or set(semantic) != set(_SEMANTIC_FIELDS):
            raise InvalidExtraction(["text organizer returned unexpected fields"], "SCHEMA_INVALID")

        def check_evidence(value: Any) -> None:
            if isinstance(value, dict):
                if "quote" in value or "page_id" in value:
                    if set(value) != {"quote", "page_id"} or value["page_id"] != binding["memory_id"]:
                        raise InvalidExtraction(["text evidence reference is invalid"], "UNKNOWN_EVIDENCE_PAGE")
                    quote = value["quote"]
                    if not isinstance(quote, str) or not quote.strip() or quote not in text:
                        raise InvalidExtraction(["text evidence quote is not exact"], "INVALID_CONTENT")
                for item in value.values():
                    check_evidence(item)
            elif isinstance(value, list):
                for item in value:
                    check_evidence(item)

        check_evidence(semantic)
        from jsonschema import Draft202012Validator

        semantic_errors = sorted(
            Draft202012Validator(semantic_schema).iter_errors(semantic), key=lambda error: list(error.absolute_path)
        )
        if semantic_errors:
            _logger.warning(
                "local_organization_semantic_schema_rejected path=%s rule=%s",
                list(semantic_errors[0].absolute_path),
                semantic_errors[0].validator,
            )
            raise InvalidExtraction(["semantic proposal did not match schema"], "SCHEMA_INVALID")
        wrapped = {
            "schema_version": "1.1",
            "capture_id": binding["memory_id"],
            "input_manifest_sha256": digest,
            "pages": [{"page_id": binding["memory_id"], "ordinal": 1, "transcription": text, "legibility": legibility}],
            **semantic,
        }
        validated = validate_extraction(
            json.dumps(wrapped, ensure_ascii=False, separators=(",", ":")),
            schema=extraction_schema,
            capture_id=binding["memory_id"],
            fingerprint=digest,
            pages={binding["memory_id"]: 1},
        )
        if validated.extraction["summary"] is not None and not validated.extraction["summary_evidence"]:
            raise InvalidExtraction(["summary requires evidence"], "INVALID_CONTENT")
        return validated

    def organize(
        self,
        authorization: str | None,
        grant: IntelligenceGrant,
        binding: dict[str, Any],
        body: bytes,
        media_type: str,
    ) -> dict[str, Any]:
        if binding["vault_id"] != str(grant.vault_id):
            raise forbidden("Device vault scope does not match.")
        is_v2 = binding["schema_version"] == "2.0"
        is_audio = binding["schema_version"] == "3.0"
        is_text = binding["source_kind"] in ("text", "audio_transcript")
        if (is_text and media_type != "text/plain; charset=utf-8") or (
            not is_text and media_type not in {"image/jpeg", "image/png", "image/webp"}
        ):
            raise unsupported_media("Organization input media type is invalid.")
        if hashlib.sha256(body).hexdigest() != binding["input_sha256"]:
            raise hash_mismatch("The organization input hash does not match.")
        text: str | None = None
        derivative: bytes | None = None
        derivative_hash: str | None = None
        if is_text:
            if binding["source_sha256"] == "" or not body:
                raise validation("Organization text must be nonempty.")
            try:
                text = body.decode("utf-8", errors="strict")
            except UnicodeDecodeError:
                raise validation("Organization text must be valid UTF-8.") from None
            if "\x00" in text or len(text) > 30_000 or (is_audio and len(body) > 120_000):
                raise validation("Organization text must be 1 to 30000 Unicode characters.")
        else:
            if binding["input_sha256"] != binding["source_sha256"]:
                raise validation("Photo input hash must equal its immutable source hash.")
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(io.BytesIO(body)) as image:
                        if (
                            image.format not in MEDIA_FORMATS[media_type]
                            or image.width * image.height > self.settings.max_image_pixels
                        ):
                            raise ValueError
                        image.verify()
                derivative, derivative_hash = make_derivative(
                    body, max_edge=min(self.settings.ai_image_max_edge, 2000), max_bytes=3_500_000
                )
            except (
                OSError,
                ValueError,
                SyntaxError,
                Image.DecompressionBombError,
                Image.DecompressionBombWarning,
                DerivativeError,
            ):
                raise unsupported_media("The photo type or image data is invalid.") from None

        # A tokenizer can split text into at most one token per UTF-8 byte. Add the
        # existing bounded prompt/schema allowance once and use this same limit for
        # reservation and provider accounting, including known billed errors.
        context_cost = len(_canonical(binding)) if is_v2 else 0
        max_input_tokens = (
            MAX_INTERPRET_TEXT_INPUT_TOKENS + len(body) + context_cost
            if is_text
            else MAX_VISUAL_TOKENS_PER_PAGE + MAX_INTERPRET_TEXT_INPUT_TOKENS + context_cost
        )

        canonical = _canonical({"binding": binding, "media_type": media_type, "input_sha256": binding["input_sha256"]})
        digest = hashlib.sha256(canonical).hexdigest()
        self.expire()
        self.authorize(authorization, grant)
        consent_policy, consent_epoch = self.require_consent(grant, binding["consent_epoch"], audio=is_audio)
        prior_result: dict[str, Any] | None = None
        with self.tx(grant) as tx:
            row = tx.one(
                "select * from local_organization_receipts where workspace_id=%s and device_id=%s "
                "and vault_id=%s and operation_id=%s",
                (grant.workspace_id, grant.device_id, grant.vault_id, binding["operation_id"]),
            )
            if row is not None:
                if row["payload_sha256"] != digest:
                    raise idempotency_conflict()
                if row["consent_policy_version"] != consent_policy or row["consent_epoch"] != consent_epoch:
                    raise forbidden("Organization consent decision has changed.")
                prior_result = self._view(row)
            else:
                if (
                    not (
                        self.settings.local_audio_organization_enabled
                        if is_audio
                        else self.settings.local_organization_enabled
                    )
                    or not self.settings.ai_configured
                    or self.provider is None
                ):
                    raise ApiError("AI_NOT_CONFIGURED", "Local organization is not currently enabled.", 409)
                try:
                    tx_decision = self._decision(tx, grant, lock=True, audio=is_audio)
                    if tx_decision[:3] != (True, consent_policy, consent_epoch):
                        raise processing.BudgetReservationError("CONSENT_REQUIRED")
                    reservation = processing.reserve_provider_budget(
                        tx,
                        self.settings,
                        purpose="organize",
                        model_id=self.settings.ai_model_id or "",
                        max_input_tokens=max_input_tokens,
                        max_output_tokens=MAX_INTERPRET_OUTPUT_TOKENS,
                        consent_check=lambda scoped_tx, _settings: (
                            self._decision(scoped_tx, grant, audio=is_audio)[:3]
                            == (True, consent_policy, consent_epoch)
                        ),
                    )
                except processing.BudgetReservationError as exc:
                    raise ApiError(str(exc), "Local organization is not currently permitted.", 409) from None
                tx.run(
                    "insert into local_organization_receipts(workspace_id,device_id,vault_id,operation_id,binding,"
                    "payload_sha256,state,reservation_id,consent_policy_version,consent_epoch) "
                    "values(%s,%s,%s,%s,%s,%s,'in_flight',%s,%s,%s)",
                    (
                        grant.workspace_id,
                        grant.device_id,
                        grant.vault_id,
                        binding["operation_id"],
                        Jsonb(binding),
                        digest,
                        reservation,
                        consent_policy,
                        consent_epoch,
                    ),
                )
        if prior_result is not None:
            return prior_result

        state, error_code, uncertain = "complete", None, False
        output: dict[str, Any] | None = None
        usage: ProviderResult | None = None
        assert self.provider is not None
        try:
            self.authorize(authorization, grant)
            self.require_consent(grant, consent_epoch, audio=is_audio)
            envelope = {
                "capture_id": binding["memory_id"],
                "input_manifest_sha256": digest,
                "timezone": "UTC",
                "captured_at": binding["captured_at"],
                "context_hint": None,
                "pages": [{"page_id": binding["memory_id"], "ordinal": 1}],
            }
            provider_schema = self.semantic_schema if is_text else self.extraction_schema
            if is_v2:
                related_schema = {
                    "type": "array",
                    "maxItems": 3,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["target_memory_id", "source_quote", "target_quote"],
                        "properties": {
                            "target_memory_id": {"type": "string"},
                            "source_quote": {"type": "string"},
                            "target_quote": {"type": "string"},
                        },
                    },
                }
                provider_schema = {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["extraction", "related_context"],
                    "properties": {"extraction": provider_schema, "related_context": related_schema},
                }
            if is_text:
                assert text is not None
                if is_audio:
                    text_request = InterpretTextRequest(
                        text,
                        envelope,
                        provider_schema,
                        None,
                        source_kind="audio_transcript",
                        transcript_evidence_kind=binding["transcript_evidence_kind"],
                    )
                else:
                    text_request = InterpretTextRequest(
                        text, envelope, provider_schema, binding.get("context") if is_v2 else None
                    )
                provider_result = self.provider.interpret_text(text_request)
            else:
                assert derivative is not None
                provider_result = self.provider.interpret(
                    InterpretRequest(
                        envelope,
                        [PageImage(binding["memory_id"], 1, derivative)],
                        provider_schema,
                        context=binding.get("context") if is_v2 else None,
                    )
                )
            if (
                provider_result.model_id != self.settings.ai_model_id
                or type(provider_result.input_tokens) is not int
                or type(provider_result.output_tokens) is not int
                or not 0 <= provider_result.input_tokens <= max_input_tokens
                or not 0 <= provider_result.output_tokens <= MAX_INTERPRET_OUTPUT_TOKENS
            ):
                raise RuntimeError("provider accounting did not match the reservation")
            usage = provider_result
            validate_storage_strings(provider_result.text)
            if len(provider_result.text.encode("utf-8")) > MAX_RESULT_BYTES:
                raise InvalidExtraction(["output too large"], "OUTPUT_TOO_LARGE")
            related_context: list[dict[str, str]] | None = None
            extraction_raw = provider_result.text
            if is_v2:
                try:
                    wrapper = json.loads(
                        provider_result.text,
                        object_pairs_hook=_object,
                        parse_float=_reject_number,
                        parse_constant=_reject_number,
                    )
                    _valid_unicode(wrapper)
                    if not isinstance(wrapper, dict) or set(wrapper) != {"extraction", "related_context"}:
                        raise ValueError
                    related_context = wrapper["related_context"]
                    if not isinstance(related_context, list) or len(related_context) > 3:
                        raise ValueError
                    extraction_raw = json.dumps(wrapper["extraction"], ensure_ascii=False, separators=(",", ":"))
                except (ValueError, TypeError, UnicodeEncodeError):
                    raise InvalidExtraction(["context result wrapper is invalid"], "SCHEMA_INVALID") from None
            if is_text:
                assert text is not None
                validated = self._text_result(
                    extraction_raw,
                    text=text,
                    binding=binding,
                    digest=digest,
                    semantic_schema=self.semantic_schema,
                    extraction_schema=self.extraction_schema,
                    # Machine wording is never "clear"; only a person's own corrected wording may be.
                    legibility=(
                        "mixed" if is_audio and binding["transcript_evidence_kind"] == "machine_unreviewed" else "clear"
                    ),
                )
            else:
                validated = validate_selected_extraction(
                    extraction_raw,
                    schema=self.extraction_schema,
                    capture_id=binding["memory_id"],
                    fingerprint=digest,
                    pages={binding["memory_id"]: 1},
                )
            if is_v2:
                assert related_context is not None
                transcript = (
                    text
                    if is_text
                    else "\n".join(
                        page["transcription"] for page in validated.extraction["pages"] if page.get("transcription")
                    )
                )
                supplied = {item["memory_id"]: item["excerpt"] for item in binding["context"]}
                seen_targets: set[str] = set()
                for relation in related_context:
                    if not isinstance(relation, dict) or set(relation) != {
                        "target_memory_id",
                        "source_quote",
                        "target_quote",
                    }:
                        raise InvalidExtraction(["related memory fields are invalid"], "SCHEMA_INVALID")
                    target, source_quote, target_quote = (
                        relation[k] for k in ("target_memory_id", "source_quote", "target_quote")
                    )
                    if (
                        not isinstance(target, str)
                        or target not in supplied
                        or target in seen_targets
                        or not isinstance(source_quote, str)
                        or not source_quote.strip()
                        or source_quote not in (transcript or "")
                        or not isinstance(target_quote, str)
                        or not target_quote.strip()
                        or target_quote not in supplied.get(target, "")
                    ):
                        raise InvalidExtraction(["related memory quote or target is unsupported"], "INVALID_CONTENT")
                    seen_targets.add(target)
            output = {
                "provider": self.settings.ai_provider,
                "model_id": provider_result.model_id,
                "input_manifest_sha256": digest,
                "extraction": validated.extraction,
                "validation_notes": validated.notes,
                "review_state": "unreviewed",
            }
            if is_v2:
                output["related_context"] = related_context
            if not is_text:
                output["derivative"] = {
                    "sha256": derivative_hash,
                    "transform_version": TRANSFORM_VERSION,
                    "media_type": "image/jpeg",
                }
            validate_storage_strings(output)
            if len(json.dumps(output, ensure_ascii=False).encode("utf-8")) > MAX_RESULT_BYTES:
                output = None
                raise InvalidExtraction(["normalized output too large"], "NORMALIZED_OUTPUT_TOO_LARGE")
        except ApiError:
            state, error_code = "failed", "AUTHORIZATION_CHANGED"
        except InvalidExtraction as exc:
            _logger.warning("local_organization_rejected code=%s", exc.code)
            state, error_code, output = "failed", "INVALID_EXTRACTION", None
        except ProviderError as exc:
            if (
                exc.model_id == self.settings.ai_model_id
                and exc.model_id is not None
                and all(type(value) is int for value in exc.usage)
                and 0 <= exc.usage[0] <= max_input_tokens
                and 0 <= exc.usage[1] <= MAX_INTERPRET_OUTPUT_TOKENS
            ):
                if any(exc.usage):
                    usage = ProviderResult("", exc.model_id, *exc.usage)
                state, error_code = "failed", "PROVIDER_FAILED"
            else:
                state, error_code, uncertain = "unknown", "PROVIDER_OUTCOME_UNKNOWN", True
        except Exception:
            state, error_code, uncertain = "unknown", "PROVIDER_OUTCOME_UNKNOWN", True
        with self.tx(grant) as tx:
            processing.finalize_provider_reservation(
                tx, self.settings, reservation, purpose="organize", job_id=None, result=usage, uncertain=uncertain
            )
            current = self._decision(tx, grant, lock=True, audio=is_audio)
            if state == "complete" and (
                current[0] is not True
                or current[1] != consent_policy
                or current[2] != consent_epoch
                or not self.grant_active(tx, authorization, grant)
            ):
                state, error_code, output = "failed", "AUTHORIZATION_CHANGED", None
            tx.run(
                "update local_organization_receipts set state=%s,result=%s,error_code=%s "
                "where workspace_id=%s and device_id=%s and vault_id=%s and operation_id=%s "
                "and state='in_flight' and expires_at>now()",
                (
                    state,
                    Jsonb(output) if output is not None and state == "complete" else None,
                    error_code,
                    grant.workspace_id,
                    grant.device_id,
                    grant.vault_id,
                    binding["operation_id"],
                ),
            )
        return self.recover(grant, binding["operation_id"])
