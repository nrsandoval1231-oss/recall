"""Synthetic-only tests for remembered local text and photo organization."""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from conftest import make_database
from fake_provider import faithful_extraction
from recall.api.inference import create_inference_app
from recall.db.database import Database
from recall.db.inference_bootstrap import bootstrap_owner
from recall.domain.processing import estimate_cost
from recall.errors import ApiError
from recall.ingestion.local_intelligence import create_intelligence_invitation
from recall.ingestion.local_organization import parse_binding
from recall.ingestion.provider import ProviderError, ProviderResult
from recall.ingestion.worker import MAX_INTERPRET_OUTPUT_TOKENS, MAX_INTERPRET_TEXT_INPUT_TOKENS
from recall.pairing import digest
from test_inference_app import inference_settings


def test_shared_utf8_digest_fixture_matches_python_canonicalization() -> None:
    root = Path(__file__).resolve().parents[3]
    item = json.loads((root / "packages/contracts/fixtures/local-organization-synthetic.json").read_text())
    assert hashlib.sha256(item["body_text"].encode("utf-8")).hexdigest() == item["binding"]["input_sha256"]
    payload = {
        "binding": item["binding"],
        "media_type": item["media_type"],
        "input_sha256": item["binding"]["input_sha256"],
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    assert canonical == item["canonical_payload_json"]
    assert hashlib.sha256(canonical.encode("utf-8")).hexdigest() == item["payload_sha256"]


def test_context_fixture_canonical_header_and_binding_parse() -> None:
    root = Path(__file__).resolve().parents[3]
    item = json.loads((root / "packages/contracts/fixtures/local-context-synthetic.json").read_text(encoding="utf-8"))
    assert hashlib.sha256(item["body_text"].encode("utf-8")).hexdigest() == item["binding"]["input_sha256"]
    assert item["canonical_binding_utf8"].encode("utf-8") == __import__("base64").urlsafe_b64decode(
        item["organization_header"][3:] + "=" * (-len(item["organization_header"][3:]) % 4)
    )
    assert parse_binding(item["organization_header"]) == item["binding"]
    payload = {
        "binding": item["binding"],
        "media_type": item["media_type"],
        "input_sha256": item["binding"]["input_sha256"],
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    assert canonical == item["canonical_payload_json"]
    assert hashlib.sha256(canonical.encode("utf-8")).hexdigest() == item["payload_sha256"]


def test_context_binding_rejects_noncanonical_oversize_and_invalid_context() -> None:
    item = json.loads(
        (Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/local-context-synthetic.json").read_text(
            encoding="utf-8"
        )
    )
    good = item["organization_header"]
    with pytest.raises(ApiError):
        parse_binding(good + "=")
    with pytest.raises(ApiError):
        parse_binding("v2." + "A" * 3069)
    raw = json.loads(item["canonical_binding_utf8"])
    raw["context"][0]["memory_id"] = raw["memory_id"]
    encoded = (
        __import__("base64")
        .urlsafe_b64encode(json.dumps(raw, ensure_ascii=False, separators=(",", ":")).encode())
        .decode()
        .rstrip("=")
    )
    with pytest.raises(ApiError):
        parse_binding("v2." + encoded)
    with pytest.raises(ApiError):
        parse_binding(
            "v2."
            + __import__("base64")
            .urlsafe_b64encode((item["canonical_binding_utf8"] + " ").encode())
            .decode()
            .rstrip("=")
        )


@pytest.mark.parametrize(
    "raw",
    [
        '{"schema_version":"1.0","schema_version":"1.0"}',
        "{}",
        '{"schema_version":"1.0","operation_id":"00000000-0000-4000-8000-000000000011","vault_id":"00000000-0000-4000-8000-000000000002","memory_id":"00000000-0000-4000-8000-000000000003","source_kind":"text","source_sha256":"'
        + "0" * 64
        + '","expected_revision":1.0,"input_sha256":"'
        + "0" * 64
        + '","consent_epoch":1,"captured_at":"2026-10-09T12:00:00Z"}',
    ],
)
def test_binding_parser_is_strict(raw: str) -> None:
    with pytest.raises(ApiError):
        parse_binding(raw)


class TextProvider:
    def __init__(
        self,
        *,
        quote_override: str | None = None,
        failure: Exception | None = None,
        on_text: Any | None = None,
        input_tokens: int = 200,
    ) -> None:
        self.text_calls: list[Any] = []
        self.photo_calls: list[Any] = []
        self.quote_override = quote_override
        self.failure = failure
        self.on_text = on_text
        self.input_tokens = input_tokens

    def interpret_text(self, request):  # type: ignore[no-untyped-def]
        self.text_calls.append(request)
        if self.on_text is not None:
            self.on_text(request)
        if self.failure is not None:
            raise self.failure
        page_id = request.envelope["pages"][0]["page_id"]
        quote = self.quote_override if self.quote_override is not None else request.text
        data = {
            "summary": "A short synthetic note.",
            "summary_evidence": [{"page_id": page_id, "quote": quote}],
            "mentions": [],
            "statements": [],
            "action_suggestions": [],
            "uncertainties": [],
        }
        if request.context is not None:
            excerpt = request.context[0]["excerpt"]
            quote = excerpt[:1]
            return ProviderResult(
                json.dumps(
                    {
                        "extraction": data,
                        "related_context": [
                            {
                                "target_memory_id": request.context[0]["memory_id"],
                                "source_quote": quote,
                                "target_quote": quote,
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                "fake-model",
                self.input_tokens,
                40,
            )
        return ProviderResult(json.dumps(data, ensure_ascii=False), "fake-model", self.input_tokens, 40)

    def interpret(self, request):  # type: ignore[no-untyped-def]
        self.photo_calls.append(request)
        data = faithful_extraction(request, ["synthetic photo note"])
        return ProviderResult(json.dumps(data), "fake-model", 200, 40)

    def answer(self, request):  # type: ignore[no-untyped-def]
        return ProviderResult("{}", "fake-model", 1, 1)


def _binding(
    vault_id: uuid.UUID, *, operation_id: uuid.UUID | None = None, text: str = "Café — déjà vu"
) -> dict[str, Any]:
    source = b"synthetic immutable text attachment"
    return {
        "schema_version": "1.0",
        "operation_id": str(operation_id or uuid.uuid4()),
        "vault_id": str(vault_id),
        "memory_id": str(uuid.uuid4()),
        "source_kind": "text",
        "source_sha256": hashlib.sha256(source).hexdigest(),
        "expected_revision": 1,
        "input_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "consent_epoch": 1,
        "captured_at": "2026-10-09T12:00:00Z",
    }


def test_text_organization_uses_distinct_consent_and_exact_source_transcript(pg_cluster: Any) -> None:
    owner_dsn, app_dsn = make_database(pg_cluster)
    owner_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    assert bootstrap_owner(owner_dsn.replace("recall_owner@", "postgres@"), owner_id, workspace_id)
    device_id, vault_id, secret = uuid.uuid4(), uuid.uuid4(), "e" * 64
    second_device, second_vault, second_secret = uuid.uuid4(), uuid.uuid4(), "7" * 64
    with psycopg.connect(owner_dsn) as conn:
        invitation, _ = create_intelligence_invitation(
            conn,
            user_id=owner_id,
            workspace_id=workspace_id,
            device_id=device_id,
            vault_id=vault_id,
            fingerprint=digest(secret),
        )
        conn.execute(
            "insert into vault_intelligence_pair_grants(id,workspace_id,user_id,device_id,vault_id,secret_sha256) "
            "values(%s,%s,%s,%s,%s,%s)",
            (uuid.uuid4(), workspace_id, owner_id, second_device, second_vault, digest(second_secret)),
        )
    db = Database(app_dsn)
    db.open()
    settings = inference_settings(app_dsn).model_copy(
        update={
            "local_organization_enabled": True,
            "ai_provider": "anthropic",
            "ai_model_id": "fake-model",
            "ai_api_key": "synthetic-test-key",
            "ai_input_usd_per_mtok": 1.0,
            "ai_output_usd_per_mtok": 1.0,
            "ai_daily_budget_usd": 5.0,
            "ai_monthly_budget_usd": 10.0,
        }
    )
    provider = TextProvider()
    app = create_inference_app(settings, database=db, provider=provider)
    token = {"Authorization": f"Bearer {secret}"}
    note = "Café — déjà vu"
    binding = _binding(vault_id, text=note)
    with TestClient(app) as client:
        assert client.get("/v1/local-intelligence/organization-capability", headers=token).status_code == 403
        claim = client.post(f"/v1/vault-intelligence/device-pairings/{invitation}/claim", json={"secret": secret})
        assert claim.status_code == 200
        oversized_reads = 0
        oversized_messages: list[dict[str, Any]] = []

        async def oversized_receive() -> dict[str, Any]:
            nonlocal oversized_reads
            oversized_reads += 1
            return {"type": "http.request", "body": note.encode("utf-8"), "more_body": False}

        async def oversized_send(message: dict[str, Any]) -> None:
            oversized_messages.append(message)

        over_path = b"/v1/local-intelligence/organizations"
        asyncio.run(
            app(
                {
                    "type": "http",
                    "asgi": {"version": "3.0"},
                    "http_version": "1.1",
                    "method": "POST",
                    "path": over_path.decode(),
                    "raw_path": over_path,
                    "query_string": b"",
                    "headers": [
                        (b"authorization", token["Authorization"].encode()),
                        (b"content-type", b"text/plain; charset=utf-8"),
                        (b"x-recall-organization", ("v2." + "A" * 3070).encode("ascii")),
                    ],
                    "client": ("127.0.0.1", 1),
                    "server": ("test", 80),
                    "scheme": "http",
                },
                oversized_receive,
                oversized_send,
            )
        )
        assert (
            next(message["status"] for message in oversized_messages if message["type"] == "http.response.start") == 422
        )
        assert oversized_reads == 0
        body_reads = 0
        sent: list[dict[str, Any]] = []

        async def receive() -> dict[str, Any]:
            nonlocal body_reads
            body_reads += 1
            return {"type": "http.request", "body": note.encode("utf-8"), "more_body": False}

        async def send(message: dict[str, Any]) -> None:
            sent.append(message)

        path = b"/v1/local-intelligence/organizations"
        asyncio.run(
            app(
                {
                    "type": "http",
                    "asgi": {"version": "3.0"},
                    "http_version": "1.1",
                    "method": "POST",
                    "path": path.decode(),
                    "raw_path": path,
                    "query_string": b"",
                    "headers": [
                        (b"authorization", token["Authorization"].encode()),
                        (b"content-type", b"text/plain; charset=utf-8"),
                        (b"x-recall-organization", json.dumps(binding).encode()),
                    ],
                    "client": ("127.0.0.1", 1),
                    "server": ("test", 80),
                    "scheme": "http",
                },
                receive,
                send,
            )
        )
        assert next(message["status"] for message in sent if message["type"] == "http.response.start") == 403
        assert body_reads == 0
        second_token = {"Authorization": f"Bearer {second_secret}"}
        second_capability_response = client.get("/v1/local-intelligence/organization-capability", headers=second_token)
        assert second_capability_response.status_code == 200, second_capability_response.text
        second_capability = second_capability_response.json()
        assert second_capability["consent_epoch"] == 0 and second_capability["consent"] == "missing"
        second_opt_in = client.post(
            "/v1/local-intelligence/organization-consent",
            headers={**second_token, "content-type": "application/json"},
            json={
                "schema_version": "1.0",
                "policy_version": second_capability["policy_version"],
                "enabled": True,
                "expected_consent_epoch": 0,
            },
        )
        assert second_opt_in.status_code == 200 and second_opt_in.json()["consent_epoch"] == 1
        capability = client.get("/v1/local-intelligence/organization-capability", headers=token).json()
        assert capability["consent"] == "missing" and not capability["enabled"]
        stale_policy = client.post(
            "/v1/local-intelligence/organization-consent",
            headers={**token, "content-type": "application/json"},
            json={
                "schema_version": "1.0",
                "policy_version": "outdated-policy",
                "enabled": True,
                "expected_consent_epoch": 0,
            },
        )
        assert stale_policy.status_code == 409 and stale_policy.json()["error"]["code"] == "POLICY_STALE"
        stale_epoch = client.post(
            "/v1/local-intelligence/organization-consent",
            headers={**token, "content-type": "application/json"},
            json={
                "schema_version": "1.0",
                "policy_version": capability["policy_version"],
                "enabled": True,
                "expected_consent_epoch": 1,
            },
        )
        assert stale_epoch.status_code == 409 and stale_epoch.json()["error"]["code"] == "CONSENT_STALE"
        consent = client.post(
            "/v1/local-intelligence/organization-consent",
            headers={**token, "content-type": "application/json"},
            json={
                "schema_version": "1.0",
                "policy_version": capability["policy_version"],
                "enabled": True,
                "expected_consent_epoch": 0,
            },
        )
        assert consent.status_code == 200 and consent.json()["enabled"]
        response = client.post(
            "/v1/local-intelligence/organizations",
            headers={
                **token,
                "content-type": "text/plain; charset=utf-8",
                "x-recall-organization": json.dumps(binding, separators=(",", ":")),
            },
            content=note.encode("utf-8"),
        )
        assert response.status_code == 200, response.text
        receipt = response.json()
        assert receipt["state"] == "complete"
        extraction = receipt["result"]["extraction"]
        assert extraction["pages"][0]["transcription"] == note
        assert extraction["summary"] == "A short synthetic note."
        assert extraction["summary_evidence"] == [{"page_id": binding["memory_id"], "quote": note}]
        assert provider.text_calls[0].text == note
        assert set(provider.text_calls[0].schema["properties"]) == {
            "summary",
            "summary_evidence",
            "mentions",
            "statements",
            "action_suggestions",
            "uncertainties",
        }
        target_ids = [str(uuid.uuid4()) for _ in range(3)]
        context_binding = {
            **binding,
            "schema_version": "2.0",
            "operation_id": str(uuid.uuid4()),
            "context_coverage": {"eligible_count": 3, "selected_count": 3, "limited": False, "truncated_count": 0},
            "context": [
                {
                    "memory_id": target_id,
                    "memory_revision": 2,
                    "source_sha256": "a" * 64,
                    "evidence_kind": "human_note",
                    "epistemic_state": "reported",
                    "excerpt": "C" + "é" * 127 + "X",
                }
                for target_id in target_ids
            ],
        }
        context_header = (
            __import__("base64")
            .urlsafe_b64encode(json.dumps(context_binding, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            .decode("ascii")
            .rstrip("=")
        )
        assert len("v2." + context_header) <= 3072
        context_response = client.post(
            "/v1/local-intelligence/organizations",
            headers={
                **token,
                "content-type": "text/plain; charset=utf-8",
                "x-recall-organization": "v2." + context_header,
            },
            content=note.encode("utf-8"),
        )
        assert context_response.status_code == 200, context_response.text
        assert len(context_response.request.headers["x-recall-organization"]) <= 3072
        context_receipt = context_response.json()
        assert context_receipt["binding"] == context_binding
        assert context_receipt["result"]["related_context"] == [
            {"target_memory_id": target_ids[0], "source_quote": "C", "target_quote": "C"}
        ]
        assert provider.text_calls[-1].context == context_binding["context"]
        recovered = client.get(f"/v1/local-intelligence/organizations/{binding['operation_id']}", headers=token)
        assert recovered.json() == receipt
        changed = {**binding, "expected_revision": 2}
        conflict = client.post(
            "/v1/local-intelligence/organizations",
            headers={
                **token,
                "content-type": "text/plain; charset=utf-8",
                "x-recall-organization": json.dumps(changed, separators=(",", ":")),
            },
            content=note.encode("utf-8"),
        )
        assert conflict.status_code == 409
        revoked = client.post(
            "/v1/local-intelligence/organization-consent",
            headers={**token, "content-type": "application/json"},
            json={
                "schema_version": "1.0",
                "policy_version": capability["policy_version"],
                "enabled": False,
                "expected_consent_epoch": 1,
            },
        )
        assert revoked.status_code == 200 and revoked.json()["consent_epoch"] == 2
        assert (
            client.get(f"/v1/local-intelligence/organizations/{binding['operation_id']}", headers=token).status_code
            == 403
        )
        with db.tx(owner_id) as tx:
            row = tx.one(
                "select state,result,error_code from local_organization_receipts where workspace_id=%s and operation_id=%s",
                (workspace_id, binding["operation_id"]),
            )
        assert row == {"state": "failed", "result": None, "error_code": "AUTHORIZATION_CHANGED"}
        enabled_again = client.post(
            "/v1/local-intelligence/organization-consent",
            headers={**token, "content-type": "application/json"},
            json={
                "schema_version": "1.0",
                "policy_version": capability["policy_version"],
                "enabled": True,
                "expected_consent_epoch": 2,
            },
        )
        assert enabled_again.status_code == 200 and enabled_again.json()["consent_epoch"] == 3
        assert (
            client.get(f"/v1/local-intelligence/organizations/{binding['operation_id']}", headers=token).status_code
            == 403
        )
    db.close()


def test_text_organization_rejects_nonexact_quotes_and_photo_path_makes_derivative(pg_cluster: Any) -> None:
    owner_dsn, app_dsn = make_database(pg_cluster)
    owner_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    assert bootstrap_owner(owner_dsn.replace("recall_owner@", "postgres@"), owner_id, workspace_id)
    device_id, vault_id, secret = uuid.uuid4(), uuid.uuid4(), "f" * 64
    with psycopg.connect(owner_dsn) as conn:
        invitation, _ = create_intelligence_invitation(
            conn,
            user_id=owner_id,
            workspace_id=workspace_id,
            device_id=device_id,
            vault_id=vault_id,
            fingerprint=digest(secret),
        )
    db = Database(app_dsn)
    db.open()
    settings = inference_settings(app_dsn).model_copy(
        update={
            "local_organization_enabled": True,
            "ai_provider": "anthropic",
            "ai_model_id": "fake-model",
            "ai_api_key": "synthetic-test-key",
            "ai_input_usd_per_mtok": 1.0,
            "ai_output_usd_per_mtok": 1.0,
            "ai_daily_budget_usd": 5.0,
            "ai_monthly_budget_usd": 10.0,
        }
    )
    provider = TextProvider(quote_override="not in the submitted note")
    app = create_inference_app(settings, database=db, provider=provider)
    token = {"Authorization": f"Bearer {secret}"}
    binding = _binding(vault_id)
    with TestClient(app) as client:
        client.post(f"/v1/vault-intelligence/device-pairings/{invitation}/claim", json={"secret": secret})
        cap = client.get("/v1/local-intelligence/organization-capability", headers=token).json()
        opted = client.post(
            "/v1/local-intelligence/organization-consent",
            headers={**token, "content-type": "application/json"},
            json={
                "schema_version": "1.0",
                "policy_version": cap["policy_version"],
                "enabled": True,
                "expected_consent_epoch": 0,
            },
        )
        assert opted.status_code == 200
        response = client.post(
            "/v1/local-intelligence/organizations",
            headers={
                **token,
                "content-type": "text/plain; charset=utf-8",
                "x-recall-organization": json.dumps(binding),
            },
            content="Café — déjà vu".encode(),
        )
        assert response.status_code == 200
        assert response.json()["state"] == "failed"
        assert response.json()["error_code"] == "INVALID_EXTRACTION"
        assert response.json()["result"] is None
        from conftest import sha, synthetic_image

        photo = synthetic_image("JPEG", seed=41)
        photo_id = str(uuid.uuid4())
        photo_binding = {
            **_binding(vault_id),
            "memory_id": photo_id,
            "source_kind": "photo",
            "source_sha256": sha(photo),
            "input_sha256": sha(photo),
        }
        photo_response = client.post(
            "/v1/local-intelligence/organizations",
            headers={
                **token,
                "content-type": "image/jpeg",
                "x-recall-organization": json.dumps(photo_binding, separators=(",", ":")),
            },
            content=photo,
        )
        assert photo_response.status_code == 200, photo_response.text
        photo_receipt = photo_response.json()
        assert photo_receipt["state"] == "complete"
        assert photo_receipt["result"]["derivative"]["media_type"] == "image/jpeg"
        assert photo_receipt["result"]["derivative"]["sha256"] != sha(photo)
        assert provider.photo_calls and provider.photo_calls[0].pages[0].jpeg
    db.close()


def test_unknown_receipt_holds_budget_expires_without_redispatch_and_revocation_blocks_promotion(
    pg_cluster: Any,
) -> None:
    owner_dsn, app_dsn = make_database(pg_cluster)
    owner_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    assert bootstrap_owner(owner_dsn.replace("recall_owner@", "postgres@"), owner_id, workspace_id)
    device_id, vault_id, secret = uuid.uuid4(), uuid.uuid4(), "8" * 64
    with psycopg.connect(owner_dsn) as conn:
        invitation, _ = create_intelligence_invitation(
            conn,
            user_id=owner_id,
            workspace_id=workspace_id,
            device_id=device_id,
            vault_id=vault_id,
            fingerprint=digest(secret),
        )
    db = Database(app_dsn)
    db.open()
    settings = inference_settings(app_dsn).model_copy(
        update={
            "local_organization_enabled": True,
            "ai_provider": "anthropic",
            "ai_model_id": "fake-model",
            "ai_api_key": "synthetic-test-key",
            "ai_input_usd_per_mtok": 1.0,
            "ai_output_usd_per_mtok": 1.0,
            "ai_daily_budget_usd": 5.0,
            "ai_monthly_budget_usd": 10.0,
        }
    )
    provider = TextProvider(failure=RuntimeError("synthetic ambiguous provider result"))
    app = create_inference_app(settings, database=db, provider=provider)
    token = {"Authorization": f"Bearer {secret}"}
    note = "synthetic unknown outcome"
    binding = _binding(vault_id, text=note)
    with TestClient(app) as client:
        assert (
            client.post(
                f"/v1/vault-intelligence/device-pairings/{invitation}/claim", json={"secret": secret}
            ).status_code
            == 200
        )
        capability = client.get("/v1/local-intelligence/organization-capability", headers=token).json()
        enabled = client.post(
            "/v1/local-intelligence/organization-consent",
            headers={**token, "content-type": "application/json"},
            json={
                "schema_version": "1.0",
                "policy_version": capability["policy_version"],
                "enabled": True,
                "expected_consent_epoch": 0,
            },
        )
        assert enabled.status_code == 200
        headers = {
            **token,
            "content-type": "text/plain; charset=utf-8",
            "x-recall-organization": json.dumps(binding, separators=(",", ":")),
        }
        unknown = client.post("/v1/local-intelligence/organizations", headers=headers, content=note.encode())
        assert unknown.status_code == 202 and unknown.json()["state"] == "unknown"
        assert len(provider.text_calls) == 1
        with db.tx(owner_id) as tx:
            row = tx.one(
                "select reservation_id from local_organization_receipts where workspace_id=%s and operation_id=%s",
                (workspace_id, binding["operation_id"]),
            )
            assert row is not None and row["reservation_id"] is not None
            held = tx.one(
                "select status,expires_at='infinity' as permanent from embedding_reservations where id=%s",
                (row["reservation_id"],),
            )
            assert held == {"status": "reserved", "permanent": True}
        retry = client.post("/v1/local-intelligence/organizations", headers=headers, content=note.encode())
        assert retry.status_code == 202 and retry.json() == unknown.json()
        assert len(provider.text_calls) == 1
        with db.tx(owner_id) as tx:
            tx.run(
                "update local_organization_receipts set expires_at=now()-interval '1 second' "
                "where workspace_id=%s and operation_id=%s",
                (workspace_id, binding["operation_id"]),
            )
        expired = client.get(f"/v1/local-intelligence/organizations/{binding['operation_id']}", headers=token)
        assert expired.status_code == 200 and expired.json()["state"] == "expired"
        expired_retry = client.post("/v1/local-intelligence/organizations", headers=headers, content=note.encode())
        assert expired_retry.status_code == 200 and expired_retry.json()["state"] == "expired"
        assert len(provider.text_calls) == 1

        provider.failure = None

        def revoke_while_provider_is_running(_request: Any) -> None:
            with psycopg.connect(owner_dsn) as conn:
                conn.execute(
                    "update vault_intelligence_organize_consents set enabled=false,consent_epoch=consent_epoch+1 "
                    "where workspace_id=%s and device_id=%s and vault_id=%s",
                    (workspace_id, device_id, vault_id),
                )

        provider.on_text = revoke_while_provider_is_running
        in_flight_binding = _binding(vault_id, text="revoke while running")
        in_flight_headers = {
            **token,
            "content-type": "text/plain; charset=utf-8",
            "x-recall-organization": json.dumps(in_flight_binding, separators=(",", ":")),
        }
        blocked = client.post(
            "/v1/local-intelligence/organizations",
            headers=in_flight_headers,
            content=b"revoke while running",
        )
        assert blocked.status_code == 403
        assert len(provider.text_calls) == 2
        with db.tx(owner_id) as tx:
            receipt = tx.one(
                "select state,result,error_code from local_organization_receipts "
                "where workspace_id=%s and operation_id=%s",
                (workspace_id, in_flight_binding["operation_id"]),
            )
        assert receipt == {"state": "failed", "result": None, "error_code": "AUTHORIZATION_CHANGED"}
    db.close()


def test_text_utf8_reservation_covers_multibyte_usage_and_billed_error_replay(pg_cluster: Any) -> None:
    owner_dsn, app_dsn = make_database(pg_cluster)
    owner_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    assert bootstrap_owner(owner_dsn.replace("recall_owner@", "postgres@"), owner_id, workspace_id)
    device_id, vault_id, secret = uuid.uuid4(), uuid.uuid4(), "9" * 64
    with psycopg.connect(owner_dsn) as conn:
        invitation, _ = create_intelligence_invitation(
            conn,
            user_id=owner_id,
            workspace_id=workspace_id,
            device_id=device_id,
            vault_id=vault_id,
            fingerprint=digest(secret),
        )
    db = Database(app_dsn)
    db.open()
    settings = inference_settings(app_dsn).model_copy(
        update={
            "local_organization_enabled": True,
            "ai_provider": "anthropic",
            "ai_model_id": "fake-model",
            "ai_api_key": "synthetic-test-key",
            "ai_input_usd_per_mtok": 1.0,
            "ai_output_usd_per_mtok": 1.0,
            "ai_daily_budget_usd": 5.0,
            "ai_monthly_budget_usd": 10.0,
        }
    )
    multibyte_note = "界" * 1000
    billed_input = MAX_INTERPRET_TEXT_INPUT_TOKENS + 500
    assert billed_input > MAX_INTERPRET_TEXT_INPUT_TOKENS + len(multibyte_note) // 3
    reservation_seen_before_dispatch: list[float] = []

    def check_reservation(request: Any) -> None:
        binding = current_binding[0]
        with psycopg.connect(owner_dsn) as conn:
            row = conn.execute(
                "select r.estimated_cost_usd from embedding_reservations r "
                "join local_organization_receipts o on o.reservation_id=r.id "
                "where o.workspace_id=%s and o.operation_id=%s",
                (workspace_id, binding["operation_id"]),
            ).fetchone()
        assert row is not None
        reservation_seen_before_dispatch.append(row[0])
        request_bound = MAX_INTERPRET_TEXT_INPUT_TOKENS + len(request.text.encode("utf-8"))
        assert float(row[0]) == pytest.approx(estimate_cost(settings, request_bound, MAX_INTERPRET_OUTPUT_TOKENS))

    provider = TextProvider(input_tokens=billed_input, on_text=check_reservation)
    app = create_inference_app(settings, database=db, provider=provider)
    token = {"Authorization": f"Bearer {secret}"}
    current_binding: list[dict[str, Any]] = [_binding(vault_id, text=multibyte_note)]
    with TestClient(app) as client:
        assert (
            client.post(
                f"/v1/vault-intelligence/device-pairings/{invitation}/claim", json={"secret": secret}
            ).status_code
            == 200
        )
        capability = client.get("/v1/local-intelligence/organization-capability", headers=token).json()
        enabled = client.post(
            "/v1/local-intelligence/organization-consent",
            headers={**token, "content-type": "application/json"},
            json={
                "schema_version": "1.0",
                "policy_version": capability["policy_version"],
                "enabled": True,
                "expected_consent_epoch": 0,
            },
        )
        assert enabled.status_code == 200

        def submit(binding: dict[str, Any], note: str):
            return client.post(
                "/v1/local-intelligence/organizations",
                headers={
                    **token,
                    "content-type": "text/plain; charset=utf-8",
                    "x-recall-organization": json.dumps(binding, separators=(",", ":")),
                },
                content=note.encode("utf-8"),
            )

        multibyte_result = submit(current_binding[0], multibyte_note)
        assert multibyte_result.status_code == 200, multibyte_result.text
        assert multibyte_result.json()["state"] == "complete"
        assert len(reservation_seen_before_dispatch) == 1
        assert provider.text_calls[0].text == multibyte_note

        current_binding[0] = _binding(vault_id, text=multibyte_note)
        provider.failure = ProviderError(
            "PROVIDER_REFUSED",
            "synthetic billed refusal",
            retryable=False,
            usage=(billed_input, 40),
            model_id="fake-model",
        )
        failed = submit(current_binding[0], multibyte_note)
        assert failed.status_code == 200 and failed.json()["state"] == "failed"
        assert failed.json()["error_code"] == "PROVIDER_FAILED"
        assert len(provider.text_calls) == 2
        replay = submit(current_binding[0], multibyte_note)
        assert replay.status_code == 200 and replay.json() == failed.json()
        assert len(provider.text_calls) == 2

    with db.tx(owner_id) as tx:
        assert tx.one("select count(*) as n from ai_usage") == {"n": 2}
        assert tx.one(
            "select input_tokens,output_tokens,purpose from ai_usage where input_tokens=%s and output_tokens=40",
            (billed_input,),
        ) == {"input_tokens": billed_input, "output_tokens": 40, "purpose": "organize"}
        assert tx.one(
            "select count(*) as n from local_organization_receipts where state='failed' and error_code='PROVIDER_FAILED'"
        ) == {"n": 1}
    db.close()
