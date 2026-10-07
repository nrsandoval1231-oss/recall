"""Consent, budget, and enqueue rules shared by the API and the worker."""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

from ..config import Settings
from ..db.database import Row, Tx
from ..ingestion import PROCESSOR_VERSION


def input_fingerprint(pages: list[Row], context_hint: str | None, timezone: str) -> str:
    """What the interpretation depends on: verified page hashes in order + user context."""
    parts = [p["server_sha256"] for p in sorted(pages, key=lambda p: p["ordinal"])]
    payload = "\n".join([*parts, f"tz={timezone}", f"hint={context_hint or ''}"])
    return hashlib.sha256(payload.encode()).hexdigest()


def consent_active(tx: Tx, settings: Settings) -> bool:
    row = tx.one("select enabled, policy_version from ai_consents where workspace_id = %s", (tx.workspace_id,))
    return bool(row and row["enabled"] and row["policy_version"] == settings.ai_policy_version)


def enqueue_capture(tx: Tx, settings: Settings, capture_id: uuid.UUID) -> bool:
    """Create the interpretation job for a stored capture, if (and only if) every gate is open.

    Idempotent: the unique (capture, fingerprint, processor_version) key absorbs repeats.
    """
    if not settings.ai_configured or not consent_active(tx, settings):
        return False
    cap = tx.one(
        "select id, status, context_hint, timezone from captures where workspace_id=%s and id=%s and deleted_at is null",  # noqa: E501
        (tx.workspace_id, capture_id),
    )
    if cap is None or cap["status"] != "stored":
        return False
    if tx.one(
        "select 1 as ok from memory_suppressions where workspace_id=%s and capture_id=%s", (tx.workspace_id, capture_id)
    ):  # noqa: E501
        return False
    pages = tx.all(
        "select ordinal, server_sha256 from source_objects where workspace_id=%s and capture_id=%s",
        (tx.workspace_id, capture_id),
    )
    inserted = tx.one(
        "insert into processing_jobs (id, workspace_id, capture_id, input_fingerprint, processor_version,"
        " max_attempts) values (%s,%s,%s,%s,%s,%s) on conflict do nothing returning 1 as ok",
        (
            uuid.uuid4(),
            tx.workspace_id,
            capture_id,
            input_fingerprint(pages, cap["context_hint"], cap["timezone"]),
            PROCESSOR_VERSION,
            settings.max_processing_attempts,
        ),
    )
    return inserted is not None


def spend(tx: Tx) -> tuple[float, float]:
    row = tx.one(
        """
        select usage.day_usd + coalesce(reserved.day_usd, 0) as day_usd,
               usage.month_usd + coalesce(reserved.month_usd, 0) as month_usd
          from recall_ai_spend() usage
          cross join recall_embedding_reserved_spend() reserved
        """
    )
    assert row is not None
    return float(row["day_usd"]), float(row["month_usd"])


def budget_available(settings: Settings, day: float, month: float) -> bool:
    assert settings.ai_daily_budget_usd is not None and settings.ai_monthly_budget_usd is not None
    return day < settings.ai_daily_budget_usd and month < settings.ai_monthly_budget_usd


def estimate_cost(settings: Settings, input_tokens: int, output_tokens: int) -> float:
    assert settings.ai_input_usd_per_mtok is not None and settings.ai_output_usd_per_mtok is not None
    return (input_tokens * settings.ai_input_usd_per_mtok + output_tokens * settings.ai_output_usd_per_mtok) / 1e6


def processing_view(job: Row | None) -> dict[str, Any] | None:
    if job is None:
        return None
    state = {
        "queued": "retrying" if job["attempts"] > 0 else "queued",
        "leased": "running",
        "succeeded": "succeeded",
        "failed": "failed",
        "cancelled": "cancelled",
    }[job["status"]]
    return {
        "state": state,
        "attempts": job["attempts"],
        "max_attempts": job["max_attempts"],
        "blocked_reason": job["blocked_reason"],
        "last_error_code": job["last_error_code"],
        "retry_available": job["last_error_code"] != "MEMORY_DELETED"
        and ((job["status"] == "failed" and job["manual_retries"] < 3) or job["status"] == "cancelled"),
    }
