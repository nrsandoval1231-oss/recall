from __future__ import annotations

import json
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from recall.api.app import create_app
from recall.api.inference import create_inference_app
from recall.config import Settings
from recall.db.database import Database
from recall.db.inference_bootstrap import bootstrap_owner
from recall.pairing import create_invitation, digest


def inference_settings(app_dsn: str) -> Settings:
    return Settings(
        service_profile="inference",
        database_url=app_dsn,
        auto_provision_workspaces=False,
        device_pairing_enabled=True,
    )


def test_profiles_keep_legacy_auth_strict_and_inference_local() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="postgresql://unused")
    configured = inference_settings("postgresql://unused")
    assert configured.auth_issuer == "" and configured.signing_secret == ""
    with pytest.raises(ValidationError, match="automatic workspace provisioning"):
        Settings(service_profile="inference", database_url="postgresql://unused", device_pairing_enabled=True)
    with pytest.raises(ValidationError, match="requires device pairing"):
        Settings(service_profile="inference", database_url="postgresql://unused", auto_provision_workspaces=False)
    with pytest.raises(ValidationError, match="does not support Supabase"):
        Settings(
            service_profile="inference",
            database_url="postgresql://unused",
            auto_provision_workspaces=False,
            device_pairing_enabled=True,
            storage_backend="supabase",
            supabase_url="https://example.invalid",
            supabase_service_role_key="synthetic-test-key-not-a-secret",
        )
    with pytest.raises(RuntimeError, match="legacy create_app cannot run"):
        create_app(configured)


def test_inference_profile_routes_and_real_pairing(pg_cluster) -> None:  # type: ignore[no-untyped-def]
    from conftest import make_database, sha, synthetic_image
    from fake_provider import FakeProvider, faithful_extraction

    owner_dsn, app_dsn = make_database(pg_cluster)
    bootstrap_dsn = owner_dsn.replace("recall_owner@", "postgres@")
    owner_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    assert bootstrap_owner(bootstrap_dsn, owner_id, workspace_id)
    device_id, vault_id = uuid.uuid4(), uuid.uuid4()
    secret = "b" * 64
    fingerprint = digest(secret)
    with psycopg.connect(owner_dsn) as conn:
        invitation, _ = create_invitation(
            conn,
            user_id=owner_id,
            workspace_id=workspace_id,
            device_id=device_id,
            vault_id=vault_id,
            fingerprint=fingerprint,
        )
    db = Database(app_dsn)
    db.open()
    settings = inference_settings(app_dsn).model_copy(
        update={
            "ai_provider": "anthropic",
            "ai_model_id": "fake-model",
            "ai_api_key": "synthetic-test-key",
            "ai_input_usd_per_mtok": 1.0,
            "ai_output_usd_per_mtok": 1.0,
            "ai_daily_budget_usd": 5.0,
            "ai_monthly_budget_usd": 10.0,
        }
    )
    with db.tx(owner_id) as tx:
        tx.run(
            "insert into ai_consents(workspace_id,enabled,policy_version,decided_by,provider) "
            "values(%s,true,%s,%s,'anthropic')",
            (workspace_id, settings.ai_policy_version, owner_id),
        )
    original = synthetic_image()
    binding = {
        "schema_version": "1.0",
        "operation_id": str(uuid.uuid4()),
        "vault_id": str(vault_id),
        "memory_id": str(uuid.uuid4()),
        "source_id": str(uuid.uuid4()),
        "source_sha256": sha(original),
        "expected_revision": 1,
        "captured_at": "2026-10-08T12:00:00Z",
    }
    fake = FakeProvider()
    fake.interpret_script = [lambda request: json.dumps(faithful_extraction(request, ["Synthetic inference note"]))]
    app = create_inference_app(settings, database=db, provider=fake)
    with TestClient(app) as client:
        paths = {route.path for route in app.routes}
        assert paths == {
            "/healthz",
            "/readyz",
            "/v1/device-pairings/{invitation_id}/claim",
            "/v1/device-pairings/status",
            "/v1/device-pairings",
            "/v1/local-readings",
            "/v1/local-readings/{operation_id}",
        }
        assert client.get("/healthz").json() == {"status": "ok"}
        assert client.get("/openapi.json").status_code == 404
        noauth = client.post("/v1/local-readings", content=b"not-an-image", headers={"content-type": "image/jpeg"})
        assert noauth.status_code == 403
        claimed = client.post(f"/v1/device-pairings/{invitation}/claim", json={"secret": secret})
        assert claimed.status_code == 200
        token = {"authorization": f"Bearer {secret}"}
        assert client.get("/v1/device-pairings/status", headers=token).json() == {
            "device_id": str(device_id),
            "vault_id": str(vault_id),
            "scope": "photo_inference",
        }
        photo = client.post(
            "/v1/local-readings",
            content=original,
            headers={**token, "content-type": "image/jpeg", "x-recall-reading": json.dumps(binding)},
        )
        assert photo.status_code == 200 and photo.json()["state"] == "complete"
        replay = client.post(
            "/v1/local-readings",
            content=original,
            headers={**token, "content-type": "image/jpeg", "x-recall-reading": json.dumps(binding)},
        )
        assert replay.json() == photo.json() and len(fake.interpret_calls) == 1
        recovery = client.get(f"/v1/local-readings/{binding['operation_id']}", headers=token)
        assert recovery.json() == photo.json()
        wrong_vault_binding = {
            "schema_version": "1.0",
            "operation_id": str(uuid.uuid4()),
            "vault_id": str(uuid.uuid4()),
            "memory_id": str(uuid.uuid4()),
            "source_id": str(uuid.uuid4()),
            "source_sha256": "c" * 64,
            "expected_revision": 1,
            "captured_at": "2026-10-08T12:00:00Z",
        }
        denied = client.post(
            "/v1/local-readings",
            content=b"not-an-image",
            headers={**token, "content-type": "image/jpeg", "x-recall-reading": json.dumps(wrong_vault_binding)},
        )
        assert denied.status_code == 403
        revoked = client.delete("/v1/device-pairings", headers=token)
        assert revoked.status_code == 200 and revoked.json()["revoked"] is True
        assert client.get("/v1/device-pairings/status", headers=token).status_code == 403
        assert client.get(f"/v1/local-readings/{binding['operation_id']}", headers=token).status_code == 403
    db.close()


def test_inference_provider_uses_no_retries_or_fallback(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import recall.ingestion.anthropic_provider as anthropic_provider

    captured: dict[str, object] = {}

    class Provider:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

    monkeypatch.setattr(anthropic_provider, "AnthropicProvider", Provider)
    settings = inference_settings("postgresql://unused").model_copy(
        update={
            "ai_provider": "anthropic",
            "ai_model_id": "synthetic-model",
            "ai_api_key": "synthetic-key",
            "ai_input_usd_per_mtok": 1.0,
            "ai_output_usd_per_mtok": 1.0,
            "ai_daily_budget_usd": 5.0,
            "ai_monthly_budget_usd": 10.0,
        }
    )
    create_inference_app(settings)
    assert captured["max_retries"] == 0 and captured["refusal_fallback"] is False


def test_worker_stops_before_opening_services_for_inference(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from recall.ingestion import worker

    monkeypatch.setattr(worker, "get_settings", lambda: inference_settings("postgresql://unused"))
    assert worker.main() == 2
