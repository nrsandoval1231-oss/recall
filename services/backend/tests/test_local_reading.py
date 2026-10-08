"""Selected-photo HTTP contract; synthetic credentials/provider and real PostgreSQL."""

from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from conftest import REPO_ROOT, Env, sha, synthetic_image
from fake_provider import FakeProvider, faithful_extraction, outage, refusal
from recall.api.app import create_app
from recall.errors import forbidden
from test_recall import AI


class SyntheticAuthorization:
    def __init__(self, user: uuid.UUID, workspace: uuid.UUID, vault: uuid.UUID) -> None:
        self.user, self.workspace, self.vault = user, workspace, vault
        self.revoked = False

    def verify(self, authorization: str | None) -> Any:
        from recall.ingestion.local_reading import DeviceGrant

        if authorization != "Bearer synthetic-device-only" or self.revoked:
            raise forbidden("Device connection unavailable.")
        return DeviceGrant(self.user, self.workspace, uuid.UUID(int=42), self.vault)


@pytest.fixture
def reading(env: Env) -> Iterator[tuple[TestClient, SyntheticAuthorization, FakeProvider, dict[str, Any], bytes]]:
    user = env.user()
    user.register_device()
    with env.db.tx(user.id) as tx:
        workspace = tx.workspace_id
    settings = env.settings.model_copy(update=AI)
    with env.db.tx(user.id) as tx:
        tx.run(
            "insert into ai_consents(workspace_id,enabled,policy_version,decided_by,provider) values(%s,true,%s,%s,'anthropic')",
            (workspace, settings.ai_policy_version, user.id),
        )
    grant = SyntheticAuthorization(user.id, workspace, uuid.uuid4())
    fake = FakeProvider()
    fake.interpret_script = [lambda request: json.dumps(faithful_extraction(request, ["Synthetic note: 12?"]))]
    app = create_app(
        settings, database=env.db, store=env.store, local_reading_authorizer=grant, local_reading_provider=fake
    )
    original = synthetic_image()
    binding = {
        "schema_version": "1.0",
        "operation_id": str(uuid.uuid4()),
        "vault_id": str(grant.vault),
        "memory_id": str(uuid.uuid4()),
        "source_id": str(uuid.uuid4()),
        "source_sha256": sha(original),
        "expected_revision": 1,
        "captured_at": "2026-10-08T12:00:00Z",
    }
    with TestClient(app) as client:
        yield client, grant, fake, binding, original


def post(client: TestClient, binding: dict[str, Any], body: bytes, **headers: str) -> Any:
    return client.post(
        "/v1/local-readings",
        content=body,
        headers={
            "Authorization": "Bearer synthetic-device-only",
            "Content-Type": "image/jpeg",
            "X-Recall-Reading": json.dumps(binding),
            **headers,
        },
    )


@pytest.mark.parametrize(
    "case",
    json.loads((REPO_ROOT / "packages/contracts/fixtures/local-reading-selected-contract.json").read_text())["cases"],
    ids=lambda case: case["name"],
)
def test_selected_contract_actual_service_receipts_replay_and_account_once(reading: Any, env: Env, case: Any) -> None:
    client, grant, fake, _, original = reading
    binding = case["request"]["binding"]
    grant.vault = uuid.UUID(binding["vault_id"])
    assert sha(original) == binding["source_sha256"]
    fake.interpret_script = [json.dumps(case["provider_output"])]
    response = post(client, binding, original)
    assert response.status_code == 200 and response.json() == case["response"]
    assert post(client, binding, original).json() == case["response"]
    recovered = client.get(
        f"/v1/local-readings/{binding['operation_id']}", headers={"Authorization": "Bearer synthetic-device-only"}
    )
    assert recovered.status_code == 200 and recovered.json() == case["response"]
    assert len(fake.interpret_calls) == 1
    with env.db.tx(grant.user) as tx:
        assert tx.one("select status from embedding_reservations")["status"] == "completed"
        assert tx.all("select model_id,input_tokens,output_tokens from ai_usage") == [
            {"model_id": "fake-model", "input_tokens": 1000, "output_tokens": 500}
        ]
        assert tx.one("select result from local_reading_receipts")["result"] == case["response"]["result"]
    result = response.json()["result"]
    if case["name"] in {"uncertainty_quote", "null_summary_quote", "max_local_ids", "unsupported_fact_summary"}:
        assert response.json()["state"] == "complete" and result["review_state"] == "unreviewed"
        assert result["extraction"]["pages"] == case["provider_output"]["pages"]
        assert result["extraction"]["uncertainties"] == case["provider_output"]["uncertainties"]
        if case["name"] in {"null_summary_quote", "unsupported_fact_summary"}:
            assert result["extraction"]["summary"] is None and result["extraction"]["summary_evidence"] == []
        if case["name"] == "unsupported_fact_summary":
            assert result["extraction"]["statements"] == []
        if case["name"] == "max_local_ids":
            for kind in ("mentions", "statements", "action_suggestions"):
                assert len(result["extraction"][kind][0]["local_id"]) == 128
    else:
        assert response.json()["state"] == "failed" and response.json()["error_code"] == "INVALID_EXTRACTION"
        assert result is None


def test_default_denial_before_consuming_photo(env: Env) -> None:
    consumed = []

    def body() -> Iterator[bytes]:
        consumed.append(True)
        yield b"private image must never be read"

    response = env.client.post("/v1/local-readings", content=body())
    assert response.status_code == 403
    assert not consumed


def test_complete_replay_recovery_binding_and_no_canonical_cloud_rows(reading: Any, env: Env) -> None:
    client, grant, fake, binding, original = reading
    response = post(client, binding, original)
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["binding"] == binding and view["state"] == "complete"
    assert view["result"]["review_state"] == "unreviewed"
    assert view["result"]["extraction"]["pages"][0]["transcription"] == "Synthetic note: 12?"
    assert view["result"]["extraction"]["statements"][0]["epistemic_state"] == "uncertain"
    assert view["result"]["derivative"]["sha256"] == sha(fake.interpret_calls[0].pages[0].jpeg)
    assert post(client, binding, original).json() == view
    assert (
        client.get(
            f"/v1/local-readings/{binding['operation_id']}", headers={"Authorization": "Bearer synthetic-device-only"}
        ).json()
        == view
    )
    assert len(fake.interpret_calls) == 1
    assert post(client, {**binding, "expected_revision": 2}, original).status_code == 409
    with env.db.tx(grant.user) as tx:
        assert tx.one("select count(*) as n from captures")["n"] == 0
        assert tx.one("select count(*) as n from memories")["n"] == 0
        assert tx.one("select count(*) as n from ai_usage")["n"] == 1


@pytest.mark.parametrize(
    ("change", "body", "media", "status"),
    [
        ({"source_sha256": "0" * 64}, None, "image/jpeg", 422),
        ({"vault_id": str(uuid.UUID(int=99))}, None, "image/jpeg", 403),
        ({"expected_revision": True}, None, "image/jpeg", 422),
        ({"extra": "no"}, None, "image/jpeg", 422),
        ({}, None, "image/png", 415),
        ({}, b"not an image", "image/jpeg", 422),
        ({}, None, "text/plain", 415),
    ],
)
def test_rejects_invalid_input_before_provider(
    reading: Any, change: dict[str, Any], body: bytes | None, media: str, status: int
) -> None:
    client, _, fake, binding, original = reading
    response = post(client, {**binding, **change}, original if body is None else body, **{"Content-Type": media})
    assert response.status_code == status, response.text
    assert not fake.interpret_calls


def test_stream_size_bound(reading: Any) -> None:
    client, _, fake, binding, _ = reading
    response = post(client, binding, b"x", **{"Content-Length": str(25 * 1024 * 1024 + 1)})
    assert response.status_code == 413
    assert not fake.interpret_calls


@pytest.mark.parametrize(
    ("step", "state", "code", "reserved"),
    [
        ("not JSON", "failed", "INVALID_EXTRACTION", False),
        (refusal(), "unknown", "PROVIDER_OUTCOME_UNKNOWN", True),
        (outage(), "unknown", "PROVIDER_OUTCOME_UNKNOWN", True),
        (TimeoutError("sensitive provider details"), "unknown", "PROVIDER_OUTCOME_UNKNOWN", True),
    ],
)
def test_failed_or_unknown_receipts_never_repeat_paid_call(
    reading: Any, env: Env, step: Any, state: str, code: str, reserved: bool
) -> None:
    client, grant, fake, binding, original = reading
    fake.interpret_script = [step]
    response = post(client, binding, original)
    assert response.json()["state"] == state, response.text
    assert response.json()["error_code"] == code
    assert "sensitive" not in response.text
    assert post(client, binding, original).json() == response.json()
    assert len(fake.interpret_calls) == 1
    with env.db.tx(grant.user) as tx:
        assert (tx.one("select status from embedding_reservations")["status"] == "reserved") is reserved


def test_concurrent_duplicate_observes_in_flight_without_provider_lock(reading: Any) -> None:
    client, _, fake, binding, original = reading
    entered, release = threading.Event(), threading.Event()

    def blocked(request: Any) -> str:
        entered.set()
        assert release.wait(10)
        return json.dumps(faithful_extraction(request, ["Synthetic note"]))

    fake.interpret_script = [blocked]
    with ThreadPoolExecutor() as executor:
        future = executor.submit(post, client, binding, original)
        assert entered.wait(10)
        try:
            second = post(client, binding, original)
            assert second.status_code == 202 and second.json()["state"] == "in_flight"
        finally:
            release.set()
        assert future.result().json()["state"] == "complete"
    assert len(fake.interpret_calls) == 1


def test_revocation_before_return_and_recovery(reading: Any) -> None:
    client, grant, fake, binding, original = reading

    def revoke(request: Any) -> str:
        grant.revoked = True
        return json.dumps(faithful_extraction(request, ["Synthetic note"]))

    fake.interpret_script = [revoke]
    assert post(client, binding, original).status_code == 403
    assert (
        client.get(
            f"/v1/local-readings/{binding['operation_id']}", headers={"Authorization": "Bearer synthetic-device-only"}
        ).status_code
        == 403
    )


@pytest.mark.parametrize("gate", ["consent", "membership"])
def test_shared_admission_gates(reading: Any, env: Env, gate: str) -> None:
    client, grant, fake, binding, original = reading
    with psycopg.connect(env.admin_dsn) as conn:
        if gate == "consent":
            conn.execute("update ai_consents set enabled=false where workspace_id=%s", (grant.workspace,))
        else:
            conn.execute("delete from workspace_members where workspace_id=%s", (grant.workspace,))
    response = post(client, binding, original)
    assert response.status_code in (403, 409), response.text
    assert not fake.interpret_calls


def test_receipt_expiry_runs_on_startup_and_never_redispatches(reading: Any, env: Env) -> None:
    client, grant, fake, binding, original = reading
    assert post(client, binding, original).json()["state"] == "complete"
    with psycopg.connect(env.admin_dsn) as conn:
        conn.execute(
            "update local_reading_receipts set expires_at=now()-interval '1 second' where workspace_id=%s",
            (grant.workspace,),
        )
    # A process restart cleans content even if the device never asks for it again.
    app = create_app(
        env.settings.model_copy(update=AI),
        database=env.db,
        store=env.store,
        local_reading_authorizer=grant,
        local_reading_provider=fake,
    )
    with TestClient(app), env.db.tx(grant.user) as tx:
        row = tx.one("select state,result from local_reading_receipts")
        assert row == {"state": "expired", "result": None}
    assert post(client, binding, original).json()["state"] == "expired"
    assert len(fake.interpret_calls) == 1


def test_abandoned_inflight_recovery_preserves_budget_hold(reading: Any, env: Env) -> None:
    client, grant, fake, binding, original = reading
    fake.interpret_script = [outage()]
    assert post(client, binding, original).json()["state"] == "unknown"
    with psycopg.connect(env.admin_dsn) as conn:
        conn.execute(
            "update local_reading_receipts set state='in_flight',created_at=now()-interval '16 minutes' where workspace_id=%s",
            (grant.workspace,),
        )
    response = client.get(
        f"/v1/local-readings/{binding['operation_id']}", headers={"Authorization": "Bearer synthetic-device-only"}
    )
    assert response.status_code == 202 and response.json()["state"] == "unknown"
    assert post(client, binding, original).json()["state"] == "unknown"
    with env.db.tx(grant.user) as tx:
        assert tx.one("select status from embedding_reservations")["status"] == "reserved"
    assert len(fake.interpret_calls) == 1


def test_other_vault_cannot_recover_receipt(reading: Any) -> None:
    client, grant, _, binding, original = reading
    assert post(client, binding, original).json()["state"] == "complete"
    grant.vault = uuid.uuid4()
    response = client.get(
        f"/v1/local-readings/{binding['operation_id']}", headers={"Authorization": "Bearer synthetic-device-only"}
    )
    assert response.status_code == 404


def test_provider_accounting_mismatch_retains_unknown_hold(reading: Any, env: Env) -> None:
    from recall.ingestion.provider import ProviderResult

    client, grant, fake, binding, original = reading

    def wrong_model(request: Any) -> ProviderResult:
        return ProviderResult(json.dumps(faithful_extraction(request, ["Synthetic"])), "different-model", 100, 10)

    fake.interpret = wrong_model
    response = post(client, binding, original)
    assert response.json()["state"] == "unknown"
    with env.db.tx(grant.user) as tx:
        assert tx.one("select status from embedding_reservations")["status"] == "reserved"
        assert tx.one("select count(*) as n from ai_usage")["n"] == 0


def test_webp_selected_photo(reading: Any) -> None:
    client, _, _, binding, _ = reading
    original = synthetic_image("WEBP")
    response = post(client, {**binding, "source_sha256": sha(original)}, original, **{"Content-Type": "image/webp"})
    assert response.json()["state"] == "complete"


def test_real_tcp_http_selected_photo_and_recovery(reading: Any) -> None:
    import socket
    import time
    import urllib.request

    import uvicorn

    client, _, fake, binding, original = reading
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(client.app, log_level="error", lifespan="off"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.01)
        assert server.started
        base = f"http://127.0.0.1:{listener.getsockname()[1]}/v1/local-readings"
        request = urllib.request.Request(
            base,
            data=original,
            headers={
                "Authorization": "Bearer synthetic-device-only",
                "Content-Type": "image/jpeg",
                "X-Recall-Reading": json.dumps(binding),
            },
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            view = json.load(response)
            assert response.status == 200 and view["state"] == "complete"
        with urllib.request.urlopen(
            urllib.request.Request(
                base + "/" + binding["operation_id"], headers={"Authorization": "Bearer synthetic-device-only"}
            ),
            timeout=10,
        ) as response:
            assert json.load(response) == view
        assert len(fake.interpret_calls) == 1
        # A client can cancel locally after dispatch. The server retains its outcome for
        # recovery and must never infer that disconnect means the paid call was undone.
        entered, release = threading.Event(), threading.Event()

        def blocked(request: Any) -> str:
            entered.set()
            assert release.wait(10)
            return json.dumps(faithful_extraction(request, ["Synthetic disconnected request"]))

        fake.interpret_script = [blocked]
        lost_binding = {**binding, "operation_id": str(uuid.uuid4())}
        connection = socket.create_connection(listener.getsockname(), timeout=10)
        wire = (
            "POST /v1/local-readings HTTP/1.1\r\nHost: localhost\r\n"
            "Authorization: Bearer synthetic-device-only\r\nContent-Type: image/jpeg\r\n"
            f"X-Recall-Reading: {json.dumps(lost_binding)}\r\nContent-Length: {len(original)}\r\n\r\n"
        ).encode() + original
        connection.sendall(wire)
        try:
            assert entered.wait(10)
        finally:
            connection.close()
            release.set()
        recovered = None
        for _ in range(100):
            with urllib.request.urlopen(
                urllib.request.Request(
                    base + "/" + lost_binding["operation_id"], headers={"Authorization": "Bearer synthetic-device-only"}
                ),
                timeout=10,
            ) as response:
                recovered = json.load(response)
            if recovered["state"] == "complete":
                break
            time.sleep(0.01)
        assert recovered is not None and recovered["state"] == "complete"
        assert len(fake.interpret_calls) == 2
    finally:
        server.should_exit = True
        thread.join(10)
        listener.close()


def test_budget_shared_with_other_operations(reading: Any, env: Env) -> None:
    client, grant, fake, binding, original = reading
    reservation = uuid.uuid4()
    with psycopg.connect(env.admin_dsn) as conn:
        conn.execute(
            "insert into embedding_reservations(id,workspace_id,purpose,model_id,estimated_cost_usd,status,expires_at) values(%s,%s,'answer','fake-model',10000,'reserved','infinity')",
            (reservation, grant.workspace),
        )
    try:
        response = post(client, binding, original)
        assert response.status_code == 409 and response.json()["error"]["code"] == "BUDGET_EXHAUSTED"
        assert not fake.interpret_calls
    finally:
        with psycopg.connect(env.admin_dsn) as conn:
            conn.execute("update embedding_reservations set status='released' where id=%s", (reservation,))


def test_workspace_erasure_discards_reading_and_fences_replay(reading: Any, env: Env) -> None:
    client, grant, fake, binding, original = reading
    assert post(client, binding, original).json()["state"] == "complete"
    with env.db.tx(grant.user) as tx:
        clock = tx.one("select sync_clock from workspaces where id=%s", (grant.workspace,))["sync_clock"]
        tx.run("select recall_erase_workspace(%s)", (clock,))
        assert tx.one("select state,result from local_reading_receipts") == {"state": "expired", "result": None}
    assert post(client, binding, original).json()["state"] == "expired"
    assert len(fake.interpret_calls) == 1


def test_declared_type_not_part_of_binding_still_fences_replay(reading: Any) -> None:
    client, _, fake, binding, original = reading
    assert post(client, binding, original).json()["state"] == "complete"
    changed = synthetic_image("PNG")
    response = post(client, {**binding, "source_sha256": sha(changed)}, changed, **{"Content-Type": "image/png"})
    assert response.status_code == 409
    assert len(fake.interpret_calls) == 1


def test_chunked_body_limit_without_content_length(reading: Any, env: Env) -> None:
    client, grant, fake, binding, _ = reading
    app = create_app(
        env.settings.model_copy(update={**AI, "max_page_bytes": 10}),
        database=env.db,
        store=env.store,
        local_reading_authorizer=grant,
        local_reading_provider=fake,
    )
    with TestClient(app) as small:
        response = small.post(
            "/v1/local-readings",
            content=iter([b"12345", b"678901"]),
            headers={
                "Authorization": "Bearer synthetic-device-only",
                "Content-Type": "image/jpeg",
                "X-Recall-Reading": json.dumps(binding),
            },
        )
    assert response.status_code == 413
    assert not fake.interpret_calls


def test_local_provider_disables_sdk_retry_and_refusal_fallback(monkeypatch: Any, env: Env) -> None:
    import anthropic

    from recall.ingestion.anthropic_provider import AnthropicProvider

    constructed = []
    real_init = AnthropicProvider.__init__

    def observe(self: Any, **kwargs: Any) -> None:
        real_init(self, **kwargs)
        constructed.append(self)

    monkeypatch.setattr(AnthropicProvider, "__init__", observe)
    create_app(
        env.settings.model_copy(update=AI),
        database=env.db,
        store=env.store,
        provider=FakeProvider(),
        local_reading_authorizer=SyntheticAuthorization(uuid.uuid4(), uuid.uuid4(), uuid.uuid4()),
    )
    assert len(constructed) == 1
    assert isinstance(constructed[0]._client, anthropic.Anthropic)
    assert constructed[0]._client.max_retries == 0
    assert constructed[0]._fallback is False
    constructed[0]._client.close()


def test_pairing_enabled_runtime_uses_database_grant_and_local_provider(monkeypatch: Any, env: Env) -> None:
    from recall.ingestion.anthropic_provider import AnthropicProvider
    from recall.pairing import digest

    owner = env.user()
    assert owner.register_device().status_code == 201
    with env.db.tx(owner.id) as tx:
        workspace_id = tx.workspace_id
    settings = env.settings.model_copy(update={**AI, "device_pairing_enabled": True})
    with env.db.tx(owner.id) as tx:
        tx.run(
            "insert into ai_consents(workspace_id,enabled,policy_version,decided_by,provider) "
            "values(%s,true,%s,%s,'anthropic')",
            (workspace_id, settings.ai_policy_version, owner.id),
        )

    secret = "ab" * 32
    device_id, vault_id = uuid.uuid4(), uuid.uuid4()
    with psycopg.connect(env.owner_dsn) as conn:
        invitation_id = conn.execute(
            "select invitation_id from recall_device_pair_invite(%s,%s,%s,%s,%s,%s)",
            (owner.id, workspace_id, device_id, vault_id, digest(secret), 600),
        ).fetchone()[0]

    fake = FakeProvider()
    fake.interpret_script = [lambda request: json.dumps(faithful_extraction(request, ["Synthetic paired reading"]))]
    constructed: list[AnthropicProvider] = []
    real_init = AnthropicProvider.__init__

    def observe_init(self: Any, **kwargs: Any) -> None:
        real_init(self, **kwargs)
        self.interpret = fake.interpret
        constructed.append(self)

    monkeypatch.setattr(AnthropicProvider, "__init__", observe_init)
    app = create_app(settings, database=env.db, store=env.store, provider=FakeProvider())
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
    with TestClient(app) as client:
        claim = client.post(f"/v1/device-pairings/{invitation_id}/claim", json={"secret": secret})
        assert claim.status_code == 200
        assert claim.json() == {"device_id": str(device_id), "vault_id": str(vault_id), "scope": "photo_inference"}
        response = client.post(
            "/v1/local-readings",
            content=original,
            headers={
                "Authorization": f"Bearer {secret}",
                "Content-Type": "image/jpeg",
                "X-Recall-Reading": json.dumps(binding),
            },
        )

    assert response.status_code == 200, response.text
    assert response.json()["state"] == "complete"
    assert len(constructed) == 1
    assert len(fake.interpret_calls) == 1
    assert constructed[0]._client.max_retries == 0
    assert constructed[0]._fallback is False
    constructed[0]._client.close()


def test_shared_native_wire_fixture_matches_actual_http_response(reading: Any) -> None:
    import base64

    from conftest import REPO_ROOT

    client, grant, _, _, _ = reading
    fixture = json.loads((REPO_ROOT / "packages/contracts/fixtures/local-reading-synthetic.json").read_text())
    request = fixture["request"]
    grant.vault = uuid.UUID(request["binding"]["vault_id"])
    response = post(
        client, request["binding"], base64.b64decode(request["image_base64"]), **{"Content-Type": request["media_type"]}
    )
    assert response.status_code == 200
    assert response.json() == fixture["response"]


@pytest.mark.parametrize("usage", [(-1, 2), (1000, 64001), (24785, 2)])
def test_invalid_error_usage_keeps_unknown_budget_hold(reading: Any, env: Env, usage: tuple[int, int]) -> None:
    from recall.ingestion.provider import ProviderError

    client, grant, fake, binding, original = reading
    fake.interpret_script = [
        ProviderError("PROVIDER_REFUSED", "synthetic", retryable=False, usage=usage, model_id="fake-model")
    ]
    response = post(client, binding, original)
    assert response.json()["state"] == "unknown"
    with env.db.tx(grant.user) as tx:
        assert tx.one("select status from embedding_reservations")["status"] == "reserved"
        assert tx.one("select count(*) as n from ai_usage")["n"] == 0


@pytest.mark.parametrize("field", ["capture_id", "input_manifest_sha256", "page_id"])
def test_model_cannot_change_source_binding(reading: Any, field: str) -> None:
    client, _, fake, binding, original = reading

    def wrong(request: Any) -> str:
        output = faithful_extraction(request, ["Synthetic note"])
        if field == "page_id":
            output["pages"][0]["page_id"] = str(uuid.uuid4())
        else:
            output[field] = "0" * 64 if field == "input_manifest_sha256" else str(uuid.uuid4())
        return json.dumps(output)

    fake.interpret_script = [wrong]
    response = post(client, binding, original)
    assert response.json()["state"] == "failed"
    assert response.json()["error_code"] == "INVALID_EXTRACTION"
    assert len(fake.interpret_calls) == 1


def test_binding_requires_rfc3339_captured_time(reading: Any) -> None:
    client, _, fake, binding, original = reading
    response = post(client, {**binding, "captured_at": "2026-10-08X12:00:00Z"}, original)
    assert response.status_code == 422
    assert not fake.interpret_calls


@pytest.mark.parametrize("bad", ["\x00", "\ud800", "\udfff"])
@pytest.mark.parametrize("field", ["transcription", "uncertainty"])
@pytest.mark.parametrize("ascii_output", [True, False])
def test_jsonb_incompatible_model_strings_fail_terminally_with_usage(
    reading: Any, env: Env, bad: str, field: str, ascii_output: bool
) -> None:
    client, grant, fake, binding, original = reading

    def invalid(request: Any) -> str:
        output = faithful_extraction(request, ["Synthetic note?"])
        if field == "transcription":
            output["pages"][0]["transcription"] += bad
        else:
            output["uncertainties"][0]["description"] += bad
        return json.dumps(output, ensure_ascii=ascii_output)

    fake.interpret_script = [invalid]
    with TestClient(client.app, raise_server_exceptions=False) as http:
        response = post(http, binding, original)
    expected = {
        "schema_version": "1.0",
        "binding": binding,
        "state": "failed",
        "result": None,
        "error_code": "INVALID_EXTRACTION",
    }
    assert response.status_code == 200 and response.json() == expected
    assert post(client, binding, original).json() == expected
    assert (
        client.get(
            f"/v1/local-readings/{binding['operation_id']}", headers={"Authorization": "Bearer synthetic-device-only"}
        ).json()
        == expected
    )
    assert len(fake.interpret_calls) == 1
    with env.db.tx(grant.user) as tx:
        assert tx.one("select status from embedding_reservations")["status"] == "completed"
        assert tx.all("select model_id,input_tokens,output_tokens from ai_usage") == [
            {"model_id": "fake-model", "input_tokens": 1000, "output_tokens": 500}
        ]
        assert tx.one("select result from local_reading_receipts")["result"] is None


@pytest.mark.parametrize("stop", ["refusal", "max_tokens"])
@pytest.mark.parametrize("model_id", ["fake-model", "different-model", None])
def test_sdk_billed_error_model_controls_settlement(reading: Any, env: Env, stop: str, model_id: str | None) -> None:
    import anthropic
    import httpx2

    from recall.ingestion.anthropic_provider import AnthropicProvider
    from test_anthropic_adapter import sse

    client, grant, fake, binding, original = reading
    wire_calls = []

    def response(request: Any) -> Any:
        wire_calls.append(request)
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=sse("{}", stop, model_id))

    with anthropic.Anthropic(
        api_key="synthetic-not-real", max_retries=0, http_client=httpx2.Client(transport=httpx2.MockTransport(response))
    ) as sdk:
        adapter = AnthropicProvider(
            api_key="synthetic-not-real", model_id="fake-model", effort="high", refusal_fallback=False, client=sdk
        )
        fake.interpret = adapter.interpret
        result = post(client, binding, original)
        matching = model_id == "fake-model"
        expected = {
            "schema_version": "1.0",
            "binding": binding,
            "state": "failed" if matching else "unknown",
            "result": None,
            "error_code": (
                ("PROVIDER_REFUSED" if stop == "refusal" else "OUTPUT_TRUNCATED")
                if matching
                else "PROVIDER_OUTCOME_UNKNOWN"
            ),
        }
        assert result.status_code == (200 if matching else 202)
        assert result.json() == expected
        assert post(client, binding, original).json() == expected
    assert len(wire_calls) == 1
    with env.db.tx(grant.user) as tx:
        assert tx.one("select status from embedding_reservations")["status"] == (
            "completed" if matching else "reserved"
        )
        assert tx.all("select model_id,input_tokens,output_tokens from ai_usage") == (
            [{"model_id": "fake-model", "input_tokens": 1234, "output_tokens": 77}] if matching else []
        )


def test_sdk_invalid_stream_encoding_retains_unknown_hold(reading: Any, env: Env) -> None:
    import anthropic
    import httpx2

    from recall.ingestion.anthropic_provider import AnthropicProvider
    from test_anthropic_adapter import sse

    client, grant, fake, binding, original = reading
    wire = sse("synthetic", model_id="fake-model").replace(b'"text": "synthetic"', b'"text": "\xff"')
    calls = []

    def respond(request: Any) -> Any:
        calls.append(request)
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=wire)

    with anthropic.Anthropic(
        api_key="synthetic-not-real", max_retries=0, http_client=httpx2.Client(transport=httpx2.MockTransport(respond))
    ) as sdk:
        fake.interpret = AnthropicProvider(
            api_key="synthetic-not-real", model_id="fake-model", effort="high", refusal_fallback=False, client=sdk
        ).interpret
        response = post(client, binding, original)
        expected = {
            "schema_version": "1.0",
            "binding": binding,
            "state": "unknown",
            "result": None,
            "error_code": "PROVIDER_OUTCOME_UNKNOWN",
        }
        assert response.status_code == 202 and response.json() == expected
        assert post(client, binding, original).json() == expected
        assert (
            client.get(
                f"/v1/local-readings/{binding['operation_id']}",
                headers={"Authorization": "Bearer synthetic-device-only"},
            ).json()
            == expected
        )
    assert len(calls) == 1
    with env.db.tx(grant.user) as tx:
        assert tx.one("select status from embedding_reservations")["status"] == "reserved"
        assert tx.one("select count(*) as n from ai_usage")["n"] == 0
