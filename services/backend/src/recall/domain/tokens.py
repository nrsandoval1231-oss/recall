"""HMAC-signed, short-lived, narrowly scoped capabilities and opaque cursors."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(secret: str, context: str, payload: bytes) -> bytes:
    return hmac.new(secret.encode(), context.encode() + b"\x00" + payload, hashlib.sha256).digest()


class TokenError(Exception):
    pass


class TokenExpired(TokenError):
    pass


def _seal(secret: str, context: str, claims: dict[str, Any]) -> str:
    payload = json.dumps(claims, separators=(",", ":"), sort_keys=True).encode()
    return f"{_b64(payload)}.{_b64(_sign(secret, context, payload))}"


def _open(secret: str, context: str, token: str) -> dict[str, Any]:
    try:
        payload_b64, sig_b64 = token.split(".")
        payload = _unb64(payload_b64)
        signature = _unb64(sig_b64)
        claims = json.loads(payload)
    except (ValueError, json.JSONDecodeError):
        raise TokenError("malformed") from None
    if not isinstance(claims, dict) or not hmac.compare_digest(signature, _sign(secret, context, payload)):
        raise TokenError("bad signature")
    return claims


@dataclass(frozen=True)
class UploadClaims:
    workspace_id: uuid.UUID
    actor_id: uuid.UUID
    capture_id: uuid.UUID
    source_id: uuid.UUID
    expires_at: int


def issue_upload_token(
    secret: str,
    *,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    capture_id: uuid.UUID,
    source_id: uuid.UUID,
    ttl_seconds: int,
    now: float | None = None,
) -> tuple[str, datetime]:
    exp = int((time.time() if now is None else now) + ttl_seconds)
    token = _seal(
        secret,
        "upload.v1",
        {
            "ws": str(workspace_id),
            "act": str(actor_id),
            "cap": str(capture_id),
            "src": str(source_id),
            "exp": exp,
        },
    )
    return token, datetime.fromtimestamp(exp).astimezone()


def verify_upload_token(secret: str, token: str, *, now: float | None = None) -> UploadClaims:
    claims = _open(secret, "upload.v1", token)
    try:
        parsed = UploadClaims(
            workspace_id=uuid.UUID(claims["ws"]),
            actor_id=uuid.UUID(claims["act"]),
            capture_id=uuid.UUID(claims["cap"]),
            source_id=uuid.UUID(claims["src"]),
            expires_at=int(claims["exp"]),
        )
    except (KeyError, ValueError, TypeError):
        raise TokenError("malformed") from None
    if (time.time() if now is None else now) >= parsed.expires_at:
        raise TokenExpired("expired")
    return parsed


def encode_cursor(secret: str, workspace_id: uuid.UUID, created_at: datetime, capture_id: uuid.UUID) -> str:
    return _seal(secret, "cursor.v1", {"ws": str(workspace_id), "t": created_at.isoformat(), "id": str(capture_id)})


def decode_cursor(secret: str, workspace_id: uuid.UUID, cursor: str) -> tuple[datetime, uuid.UUID]:
    claims = _open(secret, "cursor.v1", cursor)
    try:
        if uuid.UUID(claims["ws"]) != workspace_id:
            raise TokenError("wrong workspace")
        return datetime.fromisoformat(claims["t"]), uuid.UUID(claims["id"])
    except (KeyError, ValueError, TypeError):
        raise TokenError("malformed") from None
