"""Selected-photo inference. Vault authority stays on the device; only recovery receipts persist."""

from __future__ import annotations

import hashlib
import io
import json
import re
import uuid
import warnings
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from PIL import Image
from psycopg.types.json import Jsonb

from ..config import Settings
from ..db.database import Database, Row, Tx
from ..domain import processing
from ..domain.manifest import find_schema_path, load_schema
from ..errors import ApiError, forbidden, hash_mismatch, idempotency_conflict, not_found, unsupported_media, validation
from .images import TRANSFORM_VERSION, DerivativeError, make_derivative
from .provider import InterpretRequest, PageImage, Provider, ProviderError, ProviderResult
from .validate import InvalidExtraction, validate_extraction
from .worker import MAX_INTERPRET_OUTPUT_TOKENS, MAX_INTERPRET_TEXT_INPUT_TOKENS, MAX_VISUAL_TOKENS_PER_PAGE

MAX_RESULT_BYTES = 900_000  # JSONB expansion and the binding still fit a 1 MiB HTTP response.
MEDIA_FORMATS = {
    "image/jpeg": {"JPEG", "MPO"},
    "image/png": {"PNG"},
    "image/webp": {"WEBP"},
    "image/heic": {"HEIF"},
    "image/heif": {"HEIF"},
}


@dataclass(frozen=True)
class DeviceGrant:
    user_id: uuid.UUID
    workspace_id: uuid.UUID
    device_id: uuid.UUID
    vault_id: uuid.UUID


class DeviceAuthorizer(Protocol):
    def verify(self, authorization: str | None) -> DeviceGrant:
        """Verify a currently valid, revocable inference-only credential with exact vault scope.

        Map to an existing operational user/workspace; never provision or trust submitted workspace IDs.
        Called before bytes, before dispatch, and before returning content. Implementations must not cache revocation.
        """
        ...


class DenyDeviceAuthorizer:
    def verify(self, authorization: str | None) -> DeviceGrant:
        raise forbidden("A private device connection is not configured.")


def parse_binding(raw: str) -> dict[str, Any]:
    try:
        if len(raw.encode()) > 4096:
            raise ValueError
        binding = json.loads(raw)
        keys = {
            "schema_version",
            "operation_id",
            "vault_id",
            "memory_id",
            "source_id",
            "source_sha256",
            "expected_revision",
            "captured_at",
        }
        if not isinstance(binding, dict) or set(binding) != keys or binding["schema_version"] != "1.0":
            raise ValueError
        for key in ("operation_id", "vault_id", "memory_id", "source_id"):
            if str(uuid.UUID(binding[key])) != binding[key]:
                raise ValueError
        digest = binding["source_sha256"]
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError
        revision = binding["expected_revision"]
        if type(revision) is not int or not 1 <= revision <= 2**53 - 1:
            raise ValueError
        captured = binding["captured_at"]
        if (
            not isinstance(captured, str)
            or len(captured) > 40
            or re.fullmatch(
                r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})",
                captured,
            )
            is None
            or datetime.fromisoformat(captured).tzinfo is None
        ):
            raise ValueError
        return binding
    except (ValueError, TypeError, AttributeError):
        raise validation("X-Recall-Reading must contain a valid version 1.0 binding.") from None


def valid_usage(input_tokens: int, output_tokens: int) -> bool:
    return (
        type(input_tokens) is int
        and type(output_tokens) is int
        and 0 <= input_tokens <= MAX_VISUAL_TOKENS_PER_PAGE + MAX_INTERPRET_TEXT_INPUT_TOKENS
        and 0 <= output_tokens <= MAX_INTERPRET_OUTPUT_TOKENS
    )


class LocalReadingService:
    def __init__(self, db: Database, settings: Settings, authorizer: DeviceAuthorizer, provider: Provider | None):
        self.db, self.settings, self.authorizer, self.provider = db, settings, authorizer, provider
        self.schema = load_schema(str(find_schema_path(settings).with_name("extraction.schema.json")))

    @contextmanager
    def tx(self, grant: DeviceGrant) -> Iterator[Tx]:
        try:
            with self.db.tx(grant.user_id) as tx:
                if tx.workspace_id != grant.workspace_id:
                    raise forbidden("Device workspace is unavailable.")
                yield tx
        except LookupError:
            raise forbidden("Device workspace is unavailable.") from None

    def authorize(self, authorization: str | None, prior: DeviceGrant | None = None) -> DeviceGrant:
        grant = self.authorizer.verify(authorization)
        if prior is not None and grant != prior:
            raise forbidden("Device connection changed.")
        with self.tx(grant):
            pass
        return grant

    def _receipt(self, tx: Tx, grant: DeviceGrant, operation: str) -> Row | None:
        return tx.one(
            "select * from local_reading_receipts where workspace_id=%s and device_id=%s "
            "and vault_id=%s and operation_id=%s",
            (grant.workspace_id, grant.device_id, grant.vault_id, operation),
        )

    def recover(self, grant: DeviceGrant, operation: str) -> dict[str, Any]:
        self.expire()
        with self.tx(grant) as tx:
            row = self._receipt(tx, grant, operation)
            if row is None:
                raise not_found()
            return self.view(row)

    @staticmethod
    def view(row: Row) -> dict[str, Any]:
        return {
            "schema_version": "1.0",
            "binding": row["binding"],
            "state": row["state"],
            "result": row["result"],
            "error_code": row["error_code"],
        }

    def expire(self) -> None:
        with self.db.pool.connection() as conn:
            conn.execute("select recall_expire_local_readings()")

    def read(
        self, authorization: str | None, grant: DeviceGrant, binding: dict[str, Any], original: bytes, media_type: str
    ) -> dict[str, Any]:
        if binding["vault_id"] != str(grant.vault_id):
            raise forbidden("Device vault scope does not match.")
        if hashlib.sha256(original).hexdigest() != binding["source_sha256"]:
            raise hash_mismatch("The selected photo hash does not match.")
        # Decode bounds and declared type are checked before derivative allocation or budget admission.
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(original)) as image:
                    if (
                        image.format not in MEDIA_FORMATS[media_type]
                        or image.width * image.height > self.settings.max_image_pixels
                    ):
                        raise ValueError
                    image.verify()
            jpeg, derivative_hash = make_derivative(
                original, max_edge=min(self.settings.ai_image_max_edge, 2000), max_bytes=3_500_000
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
        digest = hashlib.sha256(
            json.dumps(
                {"binding": binding, "media_type": media_type}, sort_keys=True, separators=(",", ":"), ensure_ascii=True
            ).encode()
        ).hexdigest()
        self.expire()
        self.authorize(authorization, grant)
        with self.tx(grant) as tx:
            row = self._receipt(tx, grant, binding["operation_id"])
            if row:
                if row["payload_sha256"] != digest:
                    raise idempotency_conflict()
                return self.view(row)
            if not self.settings.ai_configured or self.provider is None:
                raise ApiError("AI_NOT_CONFIGURED", "Photo reading is not configured.", 409)
            try:
                reservation = processing.reserve_provider_budget(
                    tx,
                    self.settings,
                    purpose="interpret",
                    model_id=self.settings.ai_model_id or "",
                    max_input_tokens=MAX_VISUAL_TOKENS_PER_PAGE + MAX_INTERPRET_TEXT_INPUT_TOKENS,
                    max_output_tokens=MAX_INTERPRET_OUTPUT_TOKENS,
                )
            except processing.BudgetReservationError as exc:
                raise ApiError(str(exc), "Photo reading is not currently permitted.", 409) from None
            tx.run(
                "insert into local_reading_receipts(workspace_id,device_id,vault_id,operation_id,binding,"
                "payload_sha256,state,reservation_id) values(%s,%s,%s,%s,%s,%s,'in_flight',%s)",
                (
                    grant.workspace_id,
                    grant.device_id,
                    grant.vault_id,
                    binding["operation_id"],
                    Jsonb(binding),
                    digest,
                    reservation,
                ),
            )
        # Dispatch happens only after the receipt and maximum budget hold commit, and outside all DB locks.
        envelope = {
            "capture_id": binding["memory_id"],
            "input_manifest_sha256": digest,
            "timezone": "UTC",
            "captured_at": binding["captured_at"],
            "context_hint": None,
            "pages": [{"page_id": binding["source_id"], "ordinal": 1}],
        }
        result: ProviderResult | None = None
        payload: dict[str, Any] | None = None
        state, error, uncertain = "complete", None, False
        try:
            self.authorize(authorization, grant)
            with self.tx(grant) as tx:
                if not processing.consent_active(tx, self.settings):
                    raise forbidden("Photo reading consent is unavailable.")
            result = self.provider.interpret(
                InterpretRequest(envelope, [PageImage(binding["source_id"], 1, jpeg)], self.schema)
            )
            if result.model_id != self.settings.ai_model_id or not valid_usage(
                result.input_tokens, result.output_tokens
            ):
                result = None
                raise RuntimeError("provider accounting does not match the reservation")
            if len(result.text.encode()) > MAX_RESULT_BYTES:
                raise InvalidExtraction(["output too large"])
            validated = validate_extraction(
                result.text,
                schema=self.schema,
                capture_id=binding["memory_id"],
                fingerprint=digest,
                pages={binding["source_id"]: 1},
            )
            payload = {
                "provider": "anthropic",
                "model_id": result.model_id,
                "input_manifest_sha256": digest,
                "derivative": {
                    "sha256": derivative_hash,
                    "transform_version": TRANSFORM_VERSION,
                    "media_type": "image/jpeg",
                },
                "extraction": validated.extraction,
                "validation_notes": validated.notes,
                "review_state": "unreviewed",
            }
            if len(json.dumps(payload).encode()) > MAX_RESULT_BYTES:
                payload = None
                raise InvalidExtraction(["normalized output too large"])
        except ApiError:
            state, error = "failed", "AUTHORIZATION_CHANGED"
        except InvalidExtraction:
            state, error = "failed", "INVALID_EXTRACTION"
        except ProviderError as exc:
            if exc.usage != (0, 0) and valid_usage(*exc.usage):
                result = ProviderResult("", self.settings.ai_model_id or "", *exc.usage)
                state, error = (
                    "failed",
                    exc.code if exc.code in {"PROVIDER_REFUSED", "OUTPUT_TRUNCATED"} else "PROVIDER_FAILED",
                )
            else:
                state, error, uncertain = "unknown", "PROVIDER_OUTCOME_UNKNOWN", True
        except Exception:
            state, error, uncertain = "unknown", "PROVIDER_OUTCOME_UNKNOWN", True
        with self.tx(grant) as tx:
            processing.finalize_provider_reservation(
                tx, self.settings, reservation, purpose="interpret", job_id=None, result=result, uncertain=uncertain
            )
            tx.run(
                "update local_reading_receipts set state=%s,result=%s,error_code=%s where workspace_id=%s "
                "and device_id=%s and vault_id=%s and operation_id=%s and state='in_flight' and expires_at>now()",
                (
                    state,
                    Jsonb(payload) if payload is not None else None,
                    error,
                    grant.workspace_id,
                    grant.device_id,
                    grant.vault_id,
                    binding["operation_id"],
                ),
            )
        return self.recover(grant, binding["operation_id"])
