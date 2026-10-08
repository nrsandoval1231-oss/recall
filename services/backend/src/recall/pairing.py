"""Trusted operator pairing helpers. Public APIs never create or claim enrollment."""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime
from typing import Any

import psycopg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .db.database import Database
from .errors import forbidden, validation
from .ingestion.local_reading import DeviceGrant


def digest(secret: str) -> str:
    return hashlib.sha256(secret.encode("ascii")).hexdigest()


def validate_secret(secret: str) -> None:
    if re.fullmatch(r"[0-9a-f]{64}", secret) is None:
        raise ValueError("device secret must be 32-byte lowercase hex")


class DatabaseDeviceAuthorizer:
    """Resolve a bearer secret on every request; revocation is never cached."""

    def __init__(self, db: Database):
        self.db = db

    def verify(self, authorization: str | None) -> DeviceGrant:
        if not authorization or not authorization.startswith("Bearer "):
            raise forbidden("A private device connection is not configured.")
        secret = authorization[7:]
        try:
            validate_secret(secret)
        except ValueError:
            raise forbidden("A private device connection is not configured.") from None
        with self.db.pool.connection() as conn:
            row = conn.execute("select * from recall_device_pair_auth(%s)", (digest(secret),)).fetchone()
            conn.rollback()
        if row is None:
            raise forbidden("A private device connection is not configured.")
        return DeviceGrant(row["user_id"], row["workspace_id"], row["device_id"], row["vault_id"])


def create_invitation(
    conn: psycopg.Connection[Any],
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    device_id: uuid.UUID,
    vault_id: uuid.UUID,
    fingerprint: str,
    ttl_seconds: int = 600,
) -> tuple[str, datetime]:
    if len(fingerprint) != 64 or any(c not in "0123456789abcdef" for c in fingerprint):
        raise ValueError("device fingerprint must be 64 lowercase hexadecimal characters")
    if not 30 <= ttl_seconds <= 900:
        raise ValueError("invitation lifetime must be between 30 and 900 seconds")
    row = conn.execute(
        "select * from recall_device_pair_invite(%s,%s,%s,%s,%s,%s)",
        (user_id, workspace_id, device_id, vault_id, fingerprint, ttl_seconds),
    ).fetchone()
    if row is None:
        raise ValueError("invitation was not created")
    return str(row[0]), row[1]


def revoke_lost_device(
    conn: psycopg.Connection[Any],
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    device_id: uuid.UUID,
    vault_id: uuid.UUID,
) -> bool:
    row = conn.execute(
        "select recall_device_pair_owner_revoke(%s,%s,%s,%s)",
        (user_id, workspace_id, device_id, vault_id),
    ).fetchone()
    return bool(row and row[0])


def claim_invitation(db: Database, invitation_id: str, secret: str) -> dict[str, str]:
    validate_secret(secret)
    try:
        with db.pool.connection() as conn:
            row = conn.execute(
                "select * from recall_device_pair_claim(%s,%s)", (uuid.UUID(invitation_id), digest(secret))
            ).fetchone()
            conn.commit()
    except Exception:
        # No caller-visible distinction can leak invitation state or secret mismatch.
        raise ValueError("invitation is unavailable or does not match this device") from None
    if row is None:
        raise ValueError("invitation is unavailable or does not match this device")
    return {"device_id": str(row["device_id"]), "vault_id": str(row["vault_id"]), "scope": row["scope"]}


def pairing_routes(app: FastAPI, db: Database) -> None:
    """Install a capability-authenticated claim and authenticated status/revoke routes."""

    @app.post("/v1/device-pairings/{invitation_id}/claim")
    async def claim(invitation_id: uuid.UUID, request: Request) -> JSONResponse:
        declared = request.headers.get("content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > 4096):
            raise validation("Pairing request is too large.")
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > 4096:
                raise validation("Pairing request is too large.")
            raw.extend(chunk)
        import json

        try:
            body = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise validation("Invalid pairing request.") from None
        if not isinstance(body, dict) or set(body) != {"secret"} or not isinstance(body["secret"], str):
            raise validation("Invalid pairing request.")
        try:
            result = await run_in_threadpool(claim_invitation, db, str(invitation_id), body["secret"])
        except ValueError:
            raise forbidden("Pairing invitation is unavailable or does not match this device.") from None
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    @app.get("/v1/device-pairings/status")
    def status(request: Request) -> JSONResponse:
        grant = DatabaseDeviceAuthorizer(db).verify(request.headers.get("authorization"))
        return JSONResponse(
            {"device_id": str(grant.device_id), "vault_id": str(grant.vault_id), "scope": "photo_inference"},
            headers={"Cache-Control": "no-store"},
        )

    @app.delete("/v1/device-pairings")
    def disconnect(request: Request) -> JSONResponse:
        token = request.headers.get("authorization", "")
        if not token.startswith("Bearer "):
            raise forbidden("A private device connection is not configured.")
        try:
            validate_secret(token[7:])
        except ValueError:
            raise forbidden("A private device connection is not configured.") from None
        with db.pool.connection() as conn:
            row = conn.execute(
                "select recall_device_pair_revoke(%s) as revoked",
                (digest(token[7:]),),
            ).fetchone()
            conn.commit()
        return JSONResponse(
            {"confirmed": True, "revoked": bool(row and row["revoked"])}, headers={"Cache-Control": "no-store"}
        )
