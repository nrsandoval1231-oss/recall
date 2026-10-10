"""Operator enrollment and revocable device sessions.

The plaintext capability is returned once to the operator. The database stores
only SHA-256 hashes. A device session is an opaque `rcs_` bearer presented by
the web edge; it is not a provider JWT and cannot select a workspace.
"""

from __future__ import annotations

import hashlib
import re
import secrets
import uuid
from typing import Any

from ..config import Settings
from ..db.database import Database, Row
from ..errors import ApiError, forbidden, not_found, rate_limited, unauthenticated, validation
from ..request_scope import DeviceScope

_ENROLLMENT = re.compile(r"^enr_[A-Za-z0-9_-]{20,120}$")
_SESSION = re.compile(r"^rcs_[A-Za-z0-9_-]{20,120}$")
_CLIENT_KEY = re.compile(r"^[a-f0-9]{64}$")


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _new_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def _client_bucket(client_key: str | None) -> str:
    if client_key and _CLIENT_KEY.fullmatch(client_key):
        return client_key
    return "anonymous"


class EnrollmentService:
    def __init__(self, db: Database, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    def issue(self, user_id: uuid.UUID | None, workspace_id: uuid.UUID | None, label: str | None) -> dict[str, Any]:
        token = _new_token("enr")
        with self.db.pool.connection() as conn, conn.transaction():
            row = conn.execute(
                "select * from recall_issue_enrollment(%s, %s, %s, %s, %s, %s, %s)",
                (
                    user_id,
                    workspace_id,
                    _hash(token),
                    self.settings.enrollment_ttl_seconds,
                    label,
                    self.settings.operator_issue_limit,
                    self.settings.operator_issue_window_seconds,
                ),
            ).fetchone()
        issued = _required(row)
        outcome = str(issued["outcome"])
        if outcome == "rate_limited":
            raise rate_limited("Enrollment issuance is temporarily limited.")
        if outcome == "not_member":
            raise forbidden("That user is not a member of the requested workspace.")
        if outcome != "issued" or issued["enrollment_id"] is None:
            raise validation("The enrollment request was rejected.")
        return {
            "enrollment_id": str(issued["enrollment_id"]),
            "user_id": str(issued["user_id"]),
            "workspace_id": str(issued["workspace_id"]),
            "expires_at": issued["expires_at"].isoformat(),
            "enrollment_token": token,
        }

    def redeem(
        self,
        token: str,
        *,
        device_id: uuid.UUID | None,
        user_agent: str | None,
        client_key: str | None,
    ) -> dict[str, Any]:
        presented = token if isinstance(token, str) and _ENROLLMENT.fullmatch(token) else "rejected-enrollment"
        digest = _hash(presented)
        session_token = _new_token("rcs")
        bucket = _client_bucket(client_key)
        agent = user_agent[:200] if isinstance(user_agent, str) and user_agent else None
        with self.db.pool.connection() as conn, conn.transaction():
            row = conn.execute(
                "select * from recall_redeem_enrollment(%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    digest,
                    _hash(session_token),
                    self.settings.device_session_ttl_seconds,
                    device_id,
                    agent,
                    bucket,
                    self.settings.enrollment_client_limit,
                    self.settings.enrollment_global_limit,
                    self.settings.enrollment_window_seconds,
                ),
            ).fetchone()
        redeemed = _required(row)
        outcome = str(redeemed["outcome"])
        if outcome == "rate_limited":
            raise rate_limited("Too many enrollment attempts. Wait and try again.")
        if outcome != "redeemed" or redeemed["session_id"] is None:
            raise unauthenticated("This enrollment link is no longer valid.")
        return {
            "session_token": session_token,
            "session_id": str(redeemed["session_id"]),
            "user_id": str(redeemed["user_id"]),
            "workspace_id": str(redeemed["workspace_id"]),
            "expires_at": redeemed["expires_at"].isoformat(),
        }

    def note_csrf(self, client_key: str | None) -> None:
        with self.db.pool.connection() as conn, conn.transaction():
            conn.execute("select recall_note_csrf(%s)", (_client_bucket(client_key),))

    def resolve(self, token: str) -> DeviceScope | None:
        if not _SESSION.fullmatch(token):
            return None
        with self.db.pool.connection() as conn, conn.transaction():
            row = conn.execute("select * from recall_resolve_device_session(%s)", (_hash(token),)).fetchone()
        if row is None or row["session_id"] is None:
            return None
        return DeviceScope(
            session_id=row["session_id"],
            user_id=row["user_id"],
            workspace_id=row["workspace_id"],
        )

    def revoke_bearer(self, token: str) -> bool:
        if not _SESSION.fullmatch(token):
            return False
        with self.db.pool.connection() as conn, conn.transaction():
            row = conn.execute("select recall_revoke_device_session_hash(%s) as revoked", (_hash(token),)).fetchone()
        return bool(row and row["revoked"])

    def revoke_session(self, session_id: uuid.UUID) -> bool:
        with self.db.pool.connection() as conn, conn.transaction():
            row = conn.execute("select recall_revoke_device_session(%s) as revoked", (session_id,)).fetchone()
        return bool(row and row["revoked"])

    def revoke_enrollment(self, enrollment_id: uuid.UUID) -> bool:
        with self.db.pool.connection() as conn, conn.transaction():
            row = conn.execute("select recall_revoke_enrollment(%s) as revoked", (enrollment_id,)).fetchone()
        return bool(row and row["revoked"])

    def revoke_workspace(self, workspace_id: uuid.UUID) -> int:
        with self.db.pool.connection() as conn, conn.transaction():
            row = conn.execute(
                "select recall_revoke_workspace_device_sessions(%s) as revoked", (workspace_id,)
            ).fetchone()
        return int(row["revoked"]) if row else 0

    def kill_switch(self) -> int:
        with self.db.pool.connection() as conn, conn.transaction():
            row = conn.execute("select recall_kill_device_sessions() as revoked").fetchone()
        return int(row["revoked"]) if row else 0


def _required(row: Row | None) -> Row:
    if row is None:
        raise ApiError("INTERNAL", "Enrollment could not be completed.", 500, retryable=True)
    return row


def csrf_blocked(origin: str | None, sec_fetch_site: str | None, site_origins: list[str]) -> bool:
    if (sec_fetch_site or "").lower() == "cross-site":
        return True
    if origin is None:
        return False
    return origin not in site_origins


def enrollment_header_missing(value: str | None) -> bool:
    return value != "1"


def parse_client_key(value: str | None) -> str | None:
    if value and _CLIENT_KEY.fullmatch(value):
        return value
    return None


def operator_matches(presented: str, expected: str) -> bool:
    if len(presented) > 200 or len(expected) > 200:
        return False
    return secrets.compare_digest(_hash(presented), _hash(expected))


def not_provisioned() -> ApiError:
    return unauthenticated("This device is not provisioned.")


def operator_unavailable() -> ApiError:
    return not_found("Not found.")


def operator_rejected() -> ApiError:
    return unauthenticated("Operator authorization is required.")
