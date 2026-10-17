"""Synthetic-only durable general capture enrichment against real PostgreSQL/RLS."""

import base64
import json
import uuid
from contextlib import contextmanager

import psycopg
import pytest

from conftest import Env, synthetic_image
from recall.ingestion.provider import ProviderError, ProviderResult
from recall.ingestion.worker import Worker
from recall.library.enrichment import LibraryWorker
from test_cloud_library import capture
from test_recall import AI


class SyntheticProvider:
    def __init__(self):
        self.calls = []
        self.error = None
        self.callback = None
        self.invalid = False
        self.wrong_model = False
        self.connections = []

    def interpret(self, request):
        self.calls.append(request)
        if self.error:
            raise self.error
        if self.callback:
            self.callback()
        image = bool(request.pages)
        quote = "SYNTHETIC: violet test pattern." if image else request.envelope["original_text"]

        def item(text):
            return {"text": text, "evidence": "unsupported" if self.invalid else quote}

        return ProviderResult(
            json.dumps(
                {
                    "title": item("Violet test pattern" if image else "Pump pressure record"),
                    "summary": item(
                        "Machine visual observation: violet synthetic pattern."
                        if image
                        else "Recorded pump pressure is 42 psi."
                    ),
                    "type": "photo" if image else "note",
                    "tags": [item("pattern" if image else "pump")],
                    "observation": quote if image else "",
                    "connections": self.connections,
                }
            ),
            "wrong-model" if self.wrong_model else "fake-model",
            100,
            100,
        )


@contextmanager
def rig(pg_cluster, jwt_key, tmp_path, *, configured=True):
    provider = SyntheticProvider()
    env = Env(pg_cluster, jwt_key, tmp_path, overrides=AI if configured else {}, provider=provider)
    worker = Worker(env.worker_dsn, env.store, env.settings, provider)
    worker.open()
    try:
        yield env, provider, LibraryWorker(worker)
    finally:
        worker.close()
        env.close()


def status(user, memory):
    return next(row for row in user.req("GET", "/v1/library/memories").json() if row["id"] == memory)


def consent(user):
    assert user.req("PUT", "/v1/settings/ai", json={"enabled": True}).status_code == 200


def test_no_backfill_default_off_and_source_and_workspace_consent(pg_cluster, jwt_key, tmp_path):
    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user = env.user()
        _, old = capture(user)
        consent(user)
        assert worker.run_once() is None
        assert status(user, old["id"])["processing"]["state"] == "consent-required"
        _, new = capture(user, processing_consent=True)
        assert worker.run_once() == new["id"]
        assert status(user, new["id"])["processing"]["state"] == "complete"
        assert len(provider.calls) == 1
        assert status(user, old["id"])["revision"] == 1
        user.req("PUT", "/v1/settings/ai", json={"enabled": False})
        _, waiting = capture(user, processing_consent=True)
        worker.run_once()
        assert status(user, waiting["id"])["processing"]["state"] == "consent-required"
        assert len(provider.calls) == 1


def test_missing_config_is_actionable_without_provider_call(pg_cluster, jwt_key, tmp_path):
    with rig(pg_cluster, jwt_key, tmp_path, configured=False) as (env, provider, worker):
        user = env.user()
        _, row = capture(user, processing_consent=True)
        worker.run_once()
        state = status(user, row["id"])["processing"]
        assert state["state"] == "configuration-required"
        assert "key, model, prices and budget" in state["message"]
        assert not provider.calls


def test_general_photo_has_description_and_original_and_repeated_capture_is_once(pg_cluster, jwt_key, tmp_path):
    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user = env.user()
        consent(user)
        raw = synthetic_image()
        body, row = capture(
            user,
            processing_consent=True,
            note="",
            source_name="IMG_0001.jpg",
            mime_type="image/jpeg",
            source_base64=base64.b64encode(raw).decode(),
        )
        worker.run_once()
        enriched = status(user, row["id"])
        assert 'title: "Violet test pattern"' in enriched["note"]
        assert 'type: "photo"' in enriched["note"]
        assert "Machine visual reading (unverified)" in enriched["note"]
        assert "meeting" not in enriched["note"].lower()
        assert user.req("GET", f"/v1/library/memories/{row['id']}/source").content == raw
        assert user.req("POST", "/v1/library/mutations", json=body).status_code == 200
        assert worker.run_once() is None
        assert len(provider.calls) == 1
        assert enriched["revision"] == 2
        assert provider.calls[0].system and "general capture" in provider.calls[0].system
        for _ in range(2):
            repeated = user.req(
                "POST",
                f"/v1/library/memories/{row['id']}/processing",
                json={
                    "consent": True,
                    "expected_revision": 1,
                    "expected_vault_id": user.req("GET", "/v1/library/status").json()["vault_id"],
                },
            )
            assert repeated.status_code == 200
            assert repeated.json()["state"] == "complete"
        assert worker.run_once() is None
        assert len(provider.calls) == 1


@pytest.mark.parametrize(
    "code,state",
    [("PROVIDER_AUTH", "failed"), ("PROVIDER_RATE_LIMITED", "failed"), ("PROVIDER_UNAVAILABLE", "uncertain")],
)
def test_provider_failure_and_timeouts_never_blindly_replay(pg_cluster, jwt_key, tmp_path, code, state):
    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user = env.user()
        consent(user)
        _, row = capture(user, processing_consent=True)
        provider.error = ProviderError(code, "synthetic", retryable=True)
        worker.run_once()
        assert status(user, row["id"])["processing"]["state"] == state
        assert worker.run_once() is None
        assert len(provider.calls) == 1
        if state == "uncertain":
            user.req(
                "POST",
                f"/v1/library/memories/{row['id']}/processing",
                json={
                    "consent": True,
                    "expected_revision": 1,
                    "expected_vault_id": user.req("GET", "/v1/library/status").json()["vault_id"],
                },
            )
            assert worker.run_once() is None
            assert len(provider.calls) == 1
        else:
            for _ in range(4):
                user.req(
                    "POST",
                    f"/v1/library/memories/{row['id']}/processing",
                    json={
                        "consent": True,
                        "expected_revision": 1,
                        "expected_vault_id": user.req("GET", "/v1/library/status").json()["vault_id"],
                    },
                )
                worker.run_once()
            assert len(provider.calls) == 3


def test_human_edit_during_provider_call_is_never_overwritten(pg_cluster, jwt_key, tmp_path):
    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user = env.user()
        consent(user)
        _, row = capture(user, processing_consent=True)

        def correct():
            assert (
                user.req(
                    "POST",
                    "/v1/library/mutations",
                    json={
                        "action": "correct",
                        "memory_id": row["id"],
                        "operation_id": str(uuid.uuid4()),
                        "expected_revision": 1,
                        "note": "SYNTHETIC human correction",
                    },
                ).status_code
                == 200
            )

        provider.callback = correct
        worker.run_once()
        saved = status(user, row["id"])
        assert saved["note"] == "SYNTHETIC human correction"
        assert saved["processing"]["state"] == "failed"
        assert worker.run_once() is None
        assert (
            user.req(
                "POST",
                f"/v1/library/memories/{row['id']}/processing",
                json={
                    "consent": True,
                    "expected_revision": 2,
                    "expected_vault_id": user.req("GET", "/v1/library/status").json()["vault_id"],
                },
            ).status_code
            == 409
        )


def test_interrupted_dispatch_recovers_as_uncertain_and_pending_as_safe(pg_cluster, jwt_key, tmp_path):
    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user = env.user()
        consent(user)
        _, row = capture(user, processing_consent=True)
        with psycopg.connect(env.admin_dsn) as conn:
            conn.execute(
                "update library_processing set state='processing',dispatched_at=now(),lease_until=now()-interval '1 minute' where memory_id=%s",
                (row["id"],),
            )
        assert worker.run_once() is None
        assert status(user, row["id"])["processing"]["state"] == "uncertain"
        assert not provider.calls
        _, pending = capture(user, processing_consent=True)
        worker.run_once()
        assert status(user, pending["id"])["processing"]["state"] == "complete"


def test_invalid_evidence_withheld_and_other_workspace_isolated(pg_cluster, jwt_key, tmp_path):
    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user, other = env.user(), env.user()
        consent(user)
        _, row = capture(user, processing_consent=True)
        provider.invalid = True
        worker.run_once()
        saved = status(user, row["id"])
        assert saved["revision"] == 1
        assert saved["processing"]["state"] == "failed"
        other.req("GET", "/v1/me")
        assert (
            other.req(
                "POST",
                f"/v1/library/memories/{row['id']}/processing",
                json={
                    "consent": True,
                    "expected_revision": 1,
                    "expected_vault_id": other.req("GET", "/v1/library/status").json()["vault_id"],
                },
            ).status_code
            == 404
        )
        assert other.req("GET", "/v1/library/memories").json() == []


def test_wrong_workspace_processing_permission_is_refused_before_enqueue(pg_cluster, jwt_key, tmp_path):
    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user = env.user()
        consent(user)
        _, row = capture(user)
        result = user.req(
            "POST",
            f"/v1/library/memories/{row['id']}/processing",
            json={"consent": True, "expected_revision": 1, "expected_vault_id": str(uuid.uuid4())},
        )
        assert result.status_code == 409
        assert result.json()["error"]["code"] == "SCOPE_CHANGED"
        assert worker.run_once() is None
        assert not provider.calls
        assert status(user, row["id"])["processing"]["state"] == "consent-required"


def test_expired_predispatch_worker_cannot_send_after_replacement_claim(pg_cluster, jwt_key, tmp_path):
    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user = env.user()
        consent(user)
        _, row = capture(user, processing_consent=True)
        original = env.store.iter_bytes
        replaced = False

        def interrupt(key):
            nonlocal replaced
            data = list(original(key))
            if not replaced:
                replaced = True
                with psycopg.connect(env.admin_dsn) as conn:
                    conn.execute(
                        "update library_processing set lease_until=now()-interval '1 minute' where memory_id=%s",
                        (row["id"],),
                    )
                LibraryWorker(worker.worker).run_once()
            return iter(data)

        env.store.iter_bytes = interrupt
        worker.run_once()
        assert len(provider.calls) == 1
        assert status(user, row["id"])["revision"] == 2
        assert status(user, row["id"])["processing"]["state"] == "complete"


def test_durable_result_recovers_without_second_provider_charge(pg_cluster, jwt_key, tmp_path):
    class Interrupted(BaseException):
        pass

    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user = env.user()
        consent(user)
        _, row = capture(user, processing_consent=True)
        commit = worker._commit

        def crash(*_):
            raise Interrupted()

        worker._commit = crash
        with pytest.raises(Interrupted):
            worker.run_once()
        with psycopg.connect(env.admin_dsn) as conn:
            conn.execute(
                "update library_processing set lease_until=now()-interval '1 minute' where memory_id=%s", (row["id"],)
            )
        worker._commit = commit
        worker.run_once()
        assert len(provider.calls) == 1
        assert status(user, row["id"])["revision"] == 2
        assert worker.run_once() is None


@pytest.mark.parametrize(
    "scenario", ["unchanged", "legacy_failed", "corrected", "revoked", "target_changed", "committed_response_lost"]
)
def test_ordinary_publication_exception_preserves_receipt_and_never_charges_again(
    pg_cluster, jwt_key, tmp_path, scenario
):
    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user = env.user()
        consent(user)
        _, target = capture(user)
        body, row = capture(user, processing_consent=True)
        provider.connections = [
            {"memory_id": target["id"], "evidence": body["note"], "related_evidence": target["note"]}
        ]
        commit = worker._commit

        def fail(job, receipt):
            if scenario == "committed_response_lost":
                commit(job, receipt)
            raise RuntimeError("SYNTHETIC transient publication error")

        worker._commit = fail
        worker.run_once()
        worker._commit = commit
        with psycopg.connect(env.admin_dsn) as conn:
            state, receipt, dispatched, attempts = conn.execute(
                "select state,result,dispatched_at,attempts from library_processing where memory_id=%s", (row["id"],)
            ).fetchone()
            assert state == ("complete" if scenario == "committed_response_lost" else "pending")
            assert receipt is not None and dispatched is not None and attempts == 1
            if scenario == "legacy_failed":
                conn.execute("update library_processing set state='failed' where memory_id=%s", (row["id"],))
        if scenario in ("corrected", "target_changed"):
            edited = row if scenario == "corrected" else target
            result = user.req(
                "POST",
                "/v1/library/mutations",
                json={
                    "action": "correct",
                    "memory_id": edited["id"],
                    "operation_id": str(uuid.uuid4()),
                    "expected_revision": 1,
                    "note": "SYNTHETIC human correction",
                },
            )
            assert result.status_code == 200
        elif scenario == "revoked":
            user.req("PUT", "/v1/settings/ai", json={"enabled": False})
        else:
            requested = user.req(
                "POST",
                f"/v1/library/memories/{row['id']}/processing",
                json={
                    "consent": True,
                    "expected_revision": 1,
                    "expected_vault_id": user.req("GET", "/v1/library/status").json()["vault_id"],
                },
            )
            assert requested.status_code == 200
        worker.run_once()
        current = status(user, row["id"])
        assert len(provider.calls) == 1
        if scenario == "corrected":
            assert current["note"] == "SYNTHETIC human correction"
            assert current["processing"]["state"] == "failed"
        elif scenario == "target_changed":
            assert current["revision"] == 1 and current["processing"]["state"] == "failed"
        elif scenario == "revoked":
            assert current["revision"] == 1 and current["processing"]["state"] == "consent-required"
            consent(user)
            worker.run_once()
            assert status(user, row["id"])["processing"]["state"] == "complete"
        else:
            assert current["revision"] == 2 and current["processing"]["state"] == "complete"
        assert len(provider.calls) == 1
        with psycopg.connect(env.admin_dsn) as conn:
            assert conn.execute(
                "select result,dispatched_at,attempts from library_processing where memory_id=%s", (row["id"],)
            ).fetchone() == (receipt, dispatched, 1)


def test_wrong_model_and_revoked_workspace_permission_withhold_publication(pg_cluster, jwt_key, tmp_path):
    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user = env.user()
        consent(user)
        _, row = capture(user, processing_consent=True)
        provider.wrong_model = True
        worker.run_once()
        assert status(user, row["id"])["revision"] == 1
        assert status(user, row["id"])["processing"]["state"] == "failed"
        provider.wrong_model = False
        _, row = capture(user, processing_consent=True)
        provider.callback = lambda: user.req("PUT", "/v1/settings/ai", json={"enabled": False})
        worker.run_once()
        assert status(user, row["id"])["revision"] == 1
        assert status(user, row["id"])["processing"]["state"] == "consent-required"
        provider.callback = None
        consent(user)
        worker.run_once()
        assert len(provider.calls) == 2
        assert status(user, row["id"])["processing"]["state"] == "complete"


def test_supported_connection_is_withheld_when_target_changes(pg_cluster, jwt_key, tmp_path):
    with rig(pg_cluster, jwt_key, tmp_path) as (env, provider, worker):
        user = env.user()
        consent(user)
        _, target = capture(user)
        body, row = capture(user, processing_consent=True)
        provider.connections = [
            {"memory_id": target["id"], "evidence": body["note"], "related_evidence": target["note"]}
        ]

        def edit_target():
            user.req(
                "POST",
                "/v1/library/mutations",
                json={
                    "action": "correct",
                    "memory_id": target["id"],
                    "operation_id": str(uuid.uuid4()),
                    "expected_revision": 1,
                    "note": "SYNTHETIC target changed",
                },
            )

        provider.callback = edit_target
        worker.run_once()
        assert status(user, row["id"])["revision"] == 1
        assert status(user, row["id"])["processing"]["state"] == "failed"
        assert "Related evidence changed" in status(user, row["id"])["processing"]["message"]
