"""Consent, budget, and enqueue rules shared by the API and the worker."""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

from ..config import Settings
from ..db.database import Row, Tx
from ..ingestion import PROCESSOR_VERSION
from ..ingestion.provider import ProviderResult


class BudgetReservationError(RuntimeError):
    """A bounded provider call cannot be admitted under the shared AI budget."""


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


def reserve_provider_budget(
    tx: Tx,
    settings: Settings,
    *,
    purpose: str,
    model_id: str,
    max_input_tokens: int,
    max_output_tokens: int,
) -> uuid.UUID:
    """Reserve a conservative, durable maximum before an interpretation or Ask call.

    Existing ``embedding_reservations`` is the deployment-wide reservation ledger.  Its name is
    historical; its aggregate spend function intentionally covers every AI provider so separate
    callers cannot pass the budget check concurrently.
    """
    if purpose not in ("interpret", "repair", "answer") or max_input_tokens < 0 or max_output_tokens < 0:
        raise ValueError("invalid provider reservation")
    if not consent_active(tx, settings):
        raise BudgetReservationError("CONSENT_REQUIRED")
    tx.run("select pg_advisory_xact_lock(7402007)")
    day, month = spend(tx)
    estimated = estimate_cost(settings, max_input_tokens, max_output_tokens)
    assert settings.ai_daily_budget_usd is not None and settings.ai_monthly_budget_usd is not None
    if day + estimated > settings.ai_daily_budget_usd or month + estimated > settings.ai_monthly_budget_usd:
        raise BudgetReservationError("BUDGET_EXHAUSTED")
    reservation_id = uuid.uuid4()
    tx.run(
        "insert into embedding_reservations (id,workspace_id,purpose,model_id,estimated_cost_usd,status,expires_at) "
        "values (%s,%s,%s,%s,%s,'reserved','infinity')",
        (reservation_id, tx.workspace_id, purpose, model_id, estimated),
    )
    return reservation_id


def finalize_provider_reservation(
    tx: Tx,
    settings: Settings,
    reservation_id: uuid.UUID,
    *,
    purpose: str,
    job_id: uuid.UUID | None,
    result: ProviderResult | None,
    uncertain: bool,
) -> None:
    """Settle observed provider usage, release a known-free failure, or retain uncertainty.

    ``uncertain`` deliberately leaves the reservation live until an operator settles it.  A
    connection failure may have reached the provider but have no usage payload; releasing or
    expiring it would make the pilot limit optimistic.  Erasure can delete the reservation while
    I/O is in flight; never recreate it.
    """
    reservation = tx.one(
        "select status,purpose from embedding_reservations where workspace_id=%s and id=%s for update",
        (tx.workspace_id, reservation_id),
    )
    if reservation is None:
        return
    if reservation["status"] != "reserved" or reservation["purpose"] != purpose:
        raise BudgetReservationError("PROVIDER_RESERVATION_INVALID")
    if result is None:
        if not uncertain:
            tx.run(
                "update embedding_reservations set status='released', finished_at=now() where id=%s",
                (reservation_id,),
            )
        return
    tx.run("update embedding_reservations set status='completed', finished_at=now() where id=%s", (reservation_id,))
    tx.run(
        "insert into ai_usage (id,workspace_id,job_id,purpose,model_id,input_tokens,output_tokens,estimated_cost_usd) "
        "values (%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            uuid.uuid4(),
            tx.workspace_id,
            job_id,
            purpose,
            result.model_id,
            result.input_tokens,
            result.output_tokens,
            estimate_cost(settings, result.input_tokens, result.output_tokens),
        ),
    )


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
