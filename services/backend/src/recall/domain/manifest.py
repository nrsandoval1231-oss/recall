"""Capture manifest validation. The checked-in JSON Schema is the authoritative envelope."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from ..config import ACCEPTED_MEDIA_TYPES, Settings
from ..errors import ApiError, payload_too_large, unsupported_media, validation

SCHEMA_RELATIVE = Path("packages/contracts/capture.schema.json")


def find_schema_path(settings: Settings) -> Path:
    if settings.capture_schema_path:
        return settings.capture_schema_path
    for parent in Path(__file__).resolve().parents:
        candidate = parent / SCHEMA_RELATIVE
        if candidate.is_file():
            return candidate
    raise RuntimeError("capture.schema.json not found; set RECALL_CAPTURE_SCHEMA_PATH")


@lru_cache
def load_schema(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text())  # type: ignore[no-any-return]


def _validator(schema: dict[str, Any]) -> Draft202012Validator:
    return Draft202012Validator(schema, format_checker=FormatChecker())


def validate_manifest(body: Any, schema: dict[str, Any], settings: Settings) -> dict[str, Any]:
    """Return the manifest if valid; raise a stable ApiError otherwise."""
    errors = sorted(_validator(schema).iter_errors(body), key=lambda e: list(e.absolute_path))
    for err in errors:
        path = list(err.absolute_path)
        if path[-1:] == ["media_type"]:
            raise unsupported_media(f"Unsupported media type. Accepted: {', '.join(ACCEPTED_MEDIA_TYPES)}.")
        if path[-1:] == ["byte_size"] and err.validator == "maximum":
            raise payload_too_large(f"A page exceeds the {settings.max_page_bytes} byte limit.")
    if errors:
        first = errors[0]
        where = "/".join(str(p) for p in first.absolute_path) or "body"
        raise validation(f"Invalid capture manifest at {where}: {first.message[:200]}")
    assert isinstance(body, dict)

    pages = body["pages"]
    if len(pages) > settings.max_pages_per_capture:
        raise validation(f"At most {settings.max_pages_per_capture} pages per capture.")
    if any(p["byte_size"] > settings.max_page_bytes for p in pages):
        raise payload_too_large(f"A page exceeds the {settings.max_page_bytes} byte limit.")
    if sum(p["byte_size"] for p in pages) > settings.max_capture_bytes:
        raise payload_too_large(f"A capture may not exceed {settings.max_capture_bytes} bytes in total.")
    ordinals = sorted(p["ordinal"] for p in pages)
    if ordinals != list(range(1, len(pages) + 1)):
        raise validation("Page ordinals must be unique and contiguous starting at 1.")
    if len({p["client_page_id"] for p in pages}) != len(pages):
        raise validation("client_page_id values must be unique within a capture.")
    return body


def request_digest(payload: Any) -> str:
    """Stable digest of a request. Pages are ordered by ordinal so array order is not semantic."""
    if isinstance(payload, dict) and isinstance(payload.get("pages"), list):
        payload = {**payload, "pages": sorted(payload["pages"], key=lambda p: p.get("ordinal", 0))}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


__all__ = ["ApiError", "find_schema_path", "load_schema", "request_digest", "validate_manifest"]
