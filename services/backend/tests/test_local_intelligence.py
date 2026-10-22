"""Synthetic-only tests for the isolated vault_intelligence capability and Ask receipts."""

from __future__ import annotations

import ast
import asyncio
import copy
import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from conftest import make_database
from fake_provider import FakeProvider, outage
from recall.api.inference import create_inference_app
from recall.db.database import Database
from recall.db.inference_bootstrap import bootstrap_owner
from recall.errors import ApiError
from recall.ingestion.local_intelligence import (
    LocalIntelligenceService,
    create_intelligence_invitation,
    parse_request,
    set_ask_consent,
)
from recall.pairing import create_invitation, digest
from test_inference_app import inference_settings


def test_shared_digest_fixture_is_canonical() -> None:
    root = Path(__file__).resolve().parents[3]
    fixture = json.loads((root / "packages/contracts/fixtures/local-intelligence-synthetic.json").read_text())
    for item in fixture["requests"]:
        raw = json.dumps(
            item["request"], ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
        assert hashlib.sha256(raw).hexdigest() == parse_request(raw)[1]
        assert raw.decode() == item["canonical_json_utf8"]
        assert item["sha256"] == hashlib.sha256(raw).hexdigest()
        if item["name"] == "unicode-question":
            assert item["sha256"] == "83da2e4f0dfcfb7ee7ade51d27a25c79356cf13c0dc30673dd5d45a570683b8c"


def test_closed_inference_operator_inventory_covers_intelligence_receipts_and_grants() -> None:
    root = Path(__file__).resolve().parents[3]
    expected_tables = {
        "vault_intelligence_pair_invitations",
        "vault_intelligence_pair_grants",
        "vault_intelligence_ask_consents",
        "local_intelligence_receipts",
        "vault_intelligence_organize_consents",
        "local_organization_receipts",
    }
    expected_functions = {
        "recall_vault_intelligence_auth",
        "recall_vault_intelligence_invite",
        "recall_vault_intelligence_claim",
        "recall_vault_intelligence_revoke",
        "recall_vault_intelligence_owner_revoke",
        "recall_is_owner",
        "recall_expire_local_intelligence",
        "recall_expire_local_organizations",
    }
    ops = root / "infra/do-inference/ops"
    for filename, variable in (
        ("preflight.py", "REQUIRED_TABLES"),
        ("audit-database.py", "REQUIRED"),
        ("backup.py", "TABLES"),
    ):
        module = ast.parse((ops / filename).read_text())
        assignment = next(
            node
            for node in module.body
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == variable for target in node.targets)
        )
        assert expected_tables <= set(ast.literal_eval(assignment.value))
    audit = ast.parse((ops / "audit-database.py").read_text())
    functions = next(
        node.value
        for node in audit.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "FUNCTIONS" for target in node.targets)
    )
    assert expected_functions <= set(ast.literal_eval(functions))
    preflight = ast.parse((ops / "preflight.py").read_text())
    security = ast.unparse(preflight)
    assert all(name in security for name in expected_functions)
    restore = (ops / "verify-ci-restore.py").read_text()
    assert all(table in restore for table in expected_tables)


@pytest.mark.parametrize(
    "raw",
    [
        b'{"schema_version":"1.0","schema_version":"1.0"}',
        b'{"schema_version":"1.0","operation_id":1.0}',
        b'{"schema_version":"1.0","operation_id":NaN}',
        b"\xff",
    ],
)
def test_request_parser_rejects_duplicate_keys_noninteger_numbers_and_invalid_utf8(raw: bytes) -> None:
    with pytest.raises(ApiError):
        parse_request(raw)


def test_v2_history_fixture_has_canonical_digest_and_rejects_unpaired_comparison() -> None:
    root = Path(__file__).resolve().parents[3]
    fixture = json.loads((root / "packages/contracts/fixtures/local-history-synthetic.json").read_text())
    assert set(fixture["capability_dtos"]["legacy_v1_active"]) == {"scope", "consent", "enabled"}
    assert set(fixture["capability_dtos"]["history_active"]) == {
        "scope",
        "history_consent",
        "history_enabled",
        "consent_version",
        "history_policy_version",
    }
    assert set(fixture["capability_dtos"]["legacy_v1_active"]) == {"scope", "consent", "enabled"}
    assert set(fixture["capability_dtos"]["history_active"]) == {
        "scope",
        "history_consent",
        "history_enabled",
        "consent_version",
        "history_policy_version",
    }
    for name in ("history-as-of-unicode", "history-comparison-paired"):
        item = next(entry for entry in fixture["requests"] if entry["name"] == name)
        raw = json.dumps(item["request"], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        assert raw.decode() == item["canonical_json_utf8"]
        assert hashlib.sha256(raw).hexdigest() == item["sha256"] == parse_request(raw)[1]
        assert item["expected"]["receipt_schema_version"] == "1.0"
        assert item["expected"]["result_status"] == "answered"
    request = copy.deepcopy(
        next(entry["request"] for entry in fixture["requests"] if entry["name"] == "history-comparison-paired")
    )
    request["evidence"].pop()
    request["coverage"].update(eligible_count=1, selected_count=1)
    with pytest.raises(ApiError):
        parse_request(json.dumps(request).encode())
    as_of = copy.deepcopy(
        next(entry["request"] for entry in fixture["requests"] if entry["name"] == "history-as-of-unicode")
    )
    as_of["temporal"]["start_utc"] = "2026-10-01T06:00:00Z"
    with pytest.raises(ApiError):
        parse_request(json.dumps(as_of, ensure_ascii=False).encode())
    comparison = next(entry["request"] for entry in fixture["requests"] if entry["name"] == "history-comparison-paired")
    hits = [
        {"memory_id": item["memory_id"], "history_status": item["history_status"]} for item in comparison["evidence"]
    ]
    good = {
        "status": "answered",
        "sentences": [{"text": "Changed.", "citation_ids": ["c1", "c2"]}],
        "limitations": [],
    }
    assert LocalIntelligenceService._enforce_history_answer(comparison, hits, good)["status"] == "answered"
    one_sided = {**good, "sentences": [{"text": "Changed.", "citation_ids": ["c1"]}]}
    assert (
        LocalIntelligenceService._enforce_history_answer(comparison, hits, one_sided)["status"]
        == "insufficient_evidence"
    )


def test_inference_ask_is_separate_scoped_consent_budgeted_and_recoverable(
    pg_cluster: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner_dsn, app_dsn = make_database(pg_cluster)
    owner_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    assert bootstrap_owner(owner_dsn.replace("recall_owner@", "postgres@"), owner_id, workspace_id)
    device_id, vault_id = uuid.uuid4(), uuid.uuid4()
    secret = "c" * 64
    photo_secret = "d" * 64
    with psycopg.connect(owner_dsn) as conn:
        invitation, _ = create_intelligence_invitation(
            conn,
            user_id=owner_id,
            workspace_id=workspace_id,
            device_id=device_id,
            vault_id=vault_id,
            fingerprint=digest(secret),
        )
        photo_invitation, _ = create_invitation(
            conn,
            user_id=owner_id,
            workspace_id=workspace_id,
            device_id=uuid.uuid4(),
            vault_id=vault_id,
            fingerprint=digest(photo_secret),
        )
    db = Database(app_dsn)
    db.open()
    settings = inference_settings(app_dsn).model_copy(
        update={
            "local_intelligence_enabled": True,
            "ai_provider": "anthropic",
            "ai_model_id": "fake-model",
            "ai_api_key": "synthetic-test-key",
            "ai_input_usd_per_mtok": 1.0,
            "ai_output_usd_per_mtok": 1.0,
            "ai_daily_budget_usd": 5.0,
            "ai_monthly_budget_usd": 10.0,
        }
    )
    # Legacy/photo consent is intentionally active and must not authorize local Ask.
    with db.tx(owner_id) as tx:
        tx.run(
            "insert into ai_consents(workspace_id,enabled,policy_version,decided_by,provider) "
            "values(%s,true,%s,%s,'anthropic')",
            (workspace_id, settings.ai_policy_version, owner_id),
        )
    provider = FakeProvider()
    app = create_inference_app(settings, database=db, provider=provider)
    fixture_path = Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/local-intelligence-synthetic.json"
    body = json.loads(fixture_path.read_text())["requests"][0]["request"]
    body["vault_id"] = str(vault_id)
    ask_url = "/v1/local-intelligence/ask"
    denied_body_reads = 0

    async def reject_before_body() -> tuple[int, list[dict[str, Any]]]:
        nonlocal denied_body_reads
        sent: list[dict[str, Any]] = []

        async def receive() -> dict[str, Any]:
            nonlocal denied_body_reads
            denied_body_reads += 1
            return {"type": "http.request", "body": b"synthetic-private-body", "more_body": False}

        async def send(message: dict[str, Any]) -> None:
            sent.append(message)

        path = ask_url.encode()
        await app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "POST",
                "path": ask_url,
                "raw_path": path,
                "query_string": b"",
                "headers": [(b"content-type", b"application/json")],
                "client": ("127.0.0.1", 1),
                "server": ("test", 80),
                "scheme": "http",
            },
            receive,
            send,
        )
        start = next(message for message in sent if message["type"] == "http.response.start")
        return start["status"], sent

    unauthorized_status, _ = asyncio.run(reject_before_body())
    assert unauthorized_status == 403 and denied_body_reads == 0
    with TestClient(app) as client:
        assert client.post("/v1/local-intelligence/ask/consent", content=b"invalid").status_code == 403
        assert client.post(ask_url, content=b"x" * 40000).status_code == 403
        claim = client.post(f"/v1/vault-intelligence/device-pairings/{invitation}/claim", json={"secret": secret})
        assert claim.status_code == 200, claim.text
        token = {"Authorization": f"Bearer {secret}"}
        assert (
            client.post(
                ask_url, headers={**token, "Content-Type": "application/json"}, content=b"x" * 40000
            ).status_code
            == 413
        )
        assert (
            client.get("/v1/vault-intelligence/device-pairings/status", headers=token).json()["scope"]
            == "vault_intelligence"
        )
        assert client.get("/v1/local-intelligence/capability", headers=token).json() == {
            "scope": "vault_intelligence",
            "consent": "missing",
            "enabled": False,
        }
        assert client.get("/v1/local-intelligence/history-capability", headers=token).json() == {
            "scope": "vault_intelligence",
            "history_consent": "missing",
            "history_enabled": False,
            "consent_version": 0,
            "history_policy_version": f"ask-history-v1|{settings.ai_policy_version}",
        }
        wrong_vault = copy.deepcopy(body)
        wrong_vault["vault_id"] = str(uuid.uuid4())
        assert (
            client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=wrong_vault).status_code
            == 403
        )
        # Only legacy photo consent is present: budget admission is denied before provider dispatch.
        denied = client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=body)
        assert denied.status_code == 409 and denied.json()["error"]["code"] == "CONSENT_REQUIRED"
        assert not provider.answer_calls

        with psycopg.connect(owner_dsn) as conn:
            set_ask_consent(
                conn,
                user_id=owner_id,
                workspace_id=workspace_id,
                enabled=True,
                policy_version=settings.ai_policy_version,
            )
        assert client.get("/v1/local-intelligence/capability", headers=token).json()["enabled"] is True
        budget_app = create_inference_app(
            settings.model_copy(update={"ai_daily_budget_usd": 0.0}), database=db, provider=provider
        )
        budget_request = copy.deepcopy(body)
        budget_request["operation_id"] = str(uuid.uuid4())
        with TestClient(budget_app) as budget_client:
            exhausted = budget_client.post(
                ask_url, headers={**token, "Content-Type": "application/json"}, json=budget_request
            )
        assert exhausted.status_code == 409 and exhausted.json()["error"]["code"] == "BUDGET_EXHAUSTED"
        assert not provider.answer_calls
        response = client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=body)
        assert response.status_code == 200, response.text
        receipt = response.json()
        assert receipt["state"] == "complete" and receipt["result"]["status"] == "answered"
        assert receipt["payload_sha256"] == parse_request(json.dumps(body, ensure_ascii=False).encode())[1]
        assert client.get(f"{ask_url}/{body['operation_id']}", headers=token).json() == receipt
        replay = client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=body)
        assert replay.json() == receipt and len(provider.answer_calls) == 1

        conflict = copy.deepcopy(body)
        conflict["question"] += " Please be exact."
        assert (
            client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=conflict).status_code
            == 409
        )
        assert len(provider.answer_calls) == 1

        # Zero evidence is answered locally and never dispatched.
        empty = copy.deepcopy(body)
        empty["operation_id"] = str(uuid.uuid4())
        empty["coverage"] = {"eligible_count": 0, "selected_count": 0, "limited": False, "truncated_count": 0}
        empty["evidence"] = []
        no_evidence = client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=empty)
        assert no_evidence.status_code == 200
        assert no_evidence.json()["result"]["status"] == "insufficient_evidence"
        assert len(provider.answer_calls) == 1

        # Invalid citations are converted to an honest abstention; retries recover the prior receipt.
        bad = copy.deepcopy(body)
        bad["operation_id"] = str(uuid.uuid4())
        provider.answer_script = [
            json.dumps(
                {"status": "answered", "sentences": [{"text": "invented", "citation_ids": ["c9"]}], "limitations": []}
            )
        ]
        unverified = client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=bad)
        assert unverified.json()["result"]["status"] == "insufficient_evidence"

        unknown = copy.deepcopy(body)
        unknown["operation_id"] = str(uuid.uuid4())
        provider.answer_script = [outage()]
        uncertain = client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=unknown)
        assert uncertain.status_code == 202 and uncertain.json()["state"] == "unknown"
        unknown_call_count = len(provider.answer_calls)
        with db.tx(owner_id) as tx:
            held_receipt = tx.one(
                "select reservation_id from local_intelligence_receipts where workspace_id=%s and operation_id=%s",
                (workspace_id, uuid.UUID(unknown["operation_id"])),
            )
            assert held_receipt is not None and held_receipt["reservation_id"] is not None
            held_budget = tx.one(
                "select status,expires_at='infinity' as permanent from embedding_reservations where id=%s",
                (held_receipt["reservation_id"],),
            )
            assert held_budget == {"status": "reserved", "permanent": True}
        recovered = client.get(f"{ask_url}/{unknown['operation_id']}", headers=token)
        assert recovered.status_code == 202 and recovered.json() == uncertain.json()
        assert (
            client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=unknown).json()
            == uncertain.json()
        )
        assert len(provider.answer_calls) == unknown_call_count == 3

        # Consent is rechecked after provider I/O; a concurrent owner revocation must suppress output.
        consent_race = copy.deepcopy(body)
        consent_race["operation_id"] = str(uuid.uuid4())

        def revoke_during_answer(_request: Any) -> str:
            with psycopg.connect(owner_dsn) as conn:
                set_ask_consent(
                    conn,
                    user_id=owner_id,
                    workspace_id=workspace_id,
                    enabled=False,
                    policy_version=settings.ai_policy_version,
                )
            return json.dumps(
                {
                    "status": "answered",
                    "sentences": [{"text": "private synthetic answer", "citation_ids": ["c1"]}],
                    "limitations": [],
                }
            )

        provider.answer_script = [revoke_during_answer]
        race_response = client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=consent_race)
        assert race_response.status_code == 403
        assert "private synthetic answer" not in race_response.text
        with psycopg.connect(owner_dsn) as conn:
            race_receipt = conn.execute(
                "select state,result,error_code from local_intelligence_receipts "
                "where workspace_id=%s and operation_id=%s",
                (workspace_id, uuid.UUID(consent_race["operation_id"])),
            ).fetchone()
        assert race_receipt == ("failed", None, "AUTHORIZATION_CHANGED")
        assert client.get(f"{ask_url}/{body['operation_id']}", headers=token).status_code == 403

        # Expired idempotency keys become tombstones: recover and replay cannot redispatch.
        with psycopg.connect(owner_dsn) as conn:
            set_ask_consent(
                conn,
                user_id=owner_id,
                workspace_id=workspace_id,
                enabled=True,
                policy_version=settings.ai_policy_version,
            )
        assert client.get(f"{ask_url}/{consent_race['operation_id']}", headers=token).status_code == 403
        expired_request = copy.deepcopy(body)
        expired_request["operation_id"] = str(uuid.uuid4())
        fresh_before_expiry = client.post(
            ask_url, headers={**token, "Content-Type": "application/json"}, json=expired_request
        )
        assert fresh_before_expiry.status_code == 200 and fresh_before_expiry.json()["state"] == "complete"
        with psycopg.connect(owner_dsn) as conn:
            conn.execute(
                "update local_intelligence_receipts set expires_at=now()-interval '1 second' "
                "where workspace_id=%s and operation_id=%s",
                (workspace_id, uuid.UUID(expired_request["operation_id"])),
            )
        expired = client.get(f"{ask_url}/{expired_request['operation_id']}", headers=token)
        assert expired.status_code == 200
        assert expired.json()["state"] == "expired" and expired.json()["result"] is None
        expired_replay = client.post(
            ask_url, headers={**token, "Content-Type": "application/json"}, json=expired_request
        )
        assert expired_replay.status_code == 200
        assert expired_replay.json() == expired.json()
        assert len(provider.answer_calls) == unknown_call_count + 2

        # Scope separation works in both directions.
        photo_claim = client.post(f"/v1/device-pairings/{photo_invitation}/claim", json={"secret": photo_secret})
        assert photo_claim.status_code == 200
        assert (
            client.post(ask_url, headers={"Authorization": f"Bearer {photo_secret}"}, content=b"bad").status_code == 403
        )
        assert (
            client.post(
                "/v1/local-readings", headers={**token, "Content-Type": "image/jpeg"}, content=b"not an image"
            ).status_code
            == 403
        )

        # A separate intelligence grant revoked during provider I/O cannot persist its answer.
        revoked_secret = "e" * 64
        revoked_device = uuid.uuid4()
        with psycopg.connect(owner_dsn) as conn:
            revoked_invitation, _ = create_intelligence_invitation(
                conn,
                user_id=owner_id,
                workspace_id=workspace_id,
                device_id=revoked_device,
                vault_id=vault_id,
                fingerprint=digest(revoked_secret),
            )
        revoked_claim = client.post(
            f"/v1/vault-intelligence/device-pairings/{revoked_invitation}/claim", json={"secret": revoked_secret}
        )
        assert revoked_claim.status_code == 200
        revoked_request = copy.deepcopy(body)
        revoked_request["operation_id"] = str(uuid.uuid4())
        revoked_token = {"Authorization": f"Bearer {revoked_secret}"}

        def revoke_grant_during_answer(_request: Any) -> str:
            with psycopg.connect(owner_dsn) as conn:
                conn.execute("select recall_vault_intelligence_revoke(%s)", (digest(revoked_secret),))
            return json.dumps(
                {
                    "status": "answered",
                    "sentences": [{"text": "revoked synthetic answer", "citation_ids": ["c1"]}],
                    "limitations": [],
                }
            )

        provider.answer_script = [revoke_grant_during_answer]
        revoked_response = client.post(
            ask_url, headers={**revoked_token, "Content-Type": "application/json"}, json=revoked_request
        )
        assert revoked_response.status_code == 403
        assert "revoked synthetic answer" not in revoked_response.text
        with psycopg.connect(owner_dsn) as conn:
            revoked_receipt = conn.execute(
                "select state,result,error_code from local_intelligence_receipts "
                "where workspace_id=%s and operation_id=%s",
                (workspace_id, uuid.UUID(revoked_request["operation_id"])),
            ).fetchone()
        assert revoked_receipt == ("failed", None, "AUTHORIZATION_CHANGED")

        # Consent changed after reservation but before provider dispatch must prevent the call.
        pre_dispatch_request = copy.deepcopy(body)
        pre_dispatch_request["operation_id"] = str(uuid.uuid4())
        calls_before_pre_dispatch = len(provider.answer_calls)
        original_authorize = LocalIntelligenceService.authorize
        revoked_before_dispatch = False

        def revoke_before_dispatch(
            service: LocalIntelligenceService, authorization: str | None, prior: Any = None
        ) -> Any:
            nonlocal revoked_before_dispatch
            grant = original_authorize(service, authorization, prior)
            if prior is not None and authorization == token["Authorization"] and not revoked_before_dispatch:
                revoked_before_dispatch = True
                with psycopg.connect(owner_dsn) as conn:
                    set_ask_consent(
                        conn,
                        user_id=owner_id,
                        workspace_id=workspace_id,
                        enabled=False,
                        policy_version=settings.ai_policy_version,
                    )
            return grant

        monkeypatch.setattr(LocalIntelligenceService, "authorize", revoke_before_dispatch)
        pre_dispatch = client.post(
            ask_url, headers={**token, "Content-Type": "application/json"}, json=pre_dispatch_request
        )
        assert pre_dispatch.status_code == 403
        assert revoked_before_dispatch and len(provider.answer_calls) == calls_before_pre_dispatch
        with psycopg.connect(owner_dsn) as conn:
            pre_dispatch_receipt = conn.execute(
                "select state,result,error_code from local_intelligence_receipts "
                "where workspace_id=%s and operation_id=%s",
                (workspace_id, uuid.UUID(pre_dispatch_request["operation_id"])),
            ).fetchone()
        assert pre_dispatch_receipt == ("failed", None, "AUTHORIZATION_CHANGED")
        monkeypatch.setattr(LocalIntelligenceService, "authorize", original_authorize)

        with psycopg.connect(owner_dsn) as conn:
            set_ask_consent(
                conn,
                user_id=owner_id,
                workspace_id=workspace_id,
                enabled=True,
                policy_version=settings.ai_policy_version,
            )
        cap = client.get("/v1/local-intelligence/history-capability", headers=token).json()
        assert cap["history_consent"] == "outdated" and cap["history_enabled"] is False
        history_url = "/v1/local-intelligence/ask/consent"
        opted_in = client.post(
            history_url,
            headers={**token, "Content-Type": "application/json"},
            json={"enable_history": True, "expected_version": cap["consent_version"]},
        )
        assert opted_in.status_code == 200 and opted_in.headers["cache-control"] == "no-store"
        assert opted_in.json()["history_consent"] == "active" and opted_in.json()["history_enabled"] is True
        history_body = json.loads(
            (
                Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/local-history-synthetic.json"
            ).read_text()[0:]
        )["requests"][1]["request"]
        history_body["operation_id"] = str(uuid.uuid4())
        history_body["vault_id"] = str(vault_id)
        provider.answer_script = [
            json.dumps(
                {
                    "status": "answered",
                    "sentences": [{"text": "Recorded wording.", "citation_ids": ["c1"]}],
                    "limitations": [],
                }
            )
        ]
        history_answer = client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=history_body)
        assert history_answer.status_code == 200 and history_answer.json()["result"]["status"] == "answered"
        assert any("does not prove when an event occurred" in x for x in history_answer.json()["result"]["limitations"])
        assert client.get(f"{ask_url}/{history_body['operation_id']}", headers=token).json() == history_answer.json()
        stale = client.post(
            history_url,
            headers={**token, "Content-Type": "application/json"},
            json={"enable_history": False, "expected_version": cap["consent_version"]},
        )
        assert stale.status_code == 409 and stale.json()["error"]["code"] == "CONSENT_VERSION_CONFLICT"
        current_cap = opted_in.json()
        disabled_history = client.post(
            history_url,
            headers={**token, "Content-Type": "application/json"},
            json={"enable_history": False, "expected_version": current_cap["consent_version"]},
        )
        assert disabled_history.status_code == 200 and disabled_history.json()["history_consent"] == "outdated"

        # A grant revoked after body receipt cannot race the protected consent mutation.
        race_secret = "7" * 64
        with psycopg.connect(owner_dsn) as conn:
            race_invitation, _ = create_intelligence_invitation(
                conn,
                user_id=owner_id,
                workspace_id=workspace_id,
                device_id=uuid.uuid4(),
                vault_id=vault_id,
                fingerprint=digest(race_secret),
            )
        race_claim = client.post(
            f"/v1/vault-intelligence/device-pairings/{race_invitation}/claim", json={"secret": race_secret}
        )
        assert race_claim.status_code == 200, race_claim.text
        race_token = {"Authorization": f"Bearer {race_secret}"}
        before_race = client.get("/v1/local-intelligence/history-capability", headers=token).json()
        original_set_history = LocalIntelligenceService.set_history_consent

        def revoke_during_consent_body(
            service: LocalIntelligenceService,
            grant: Any,
            authorization: str | None,
            *,
            enable_history: bool,
            expected_version: int,
        ) -> dict[str, Any]:
            if authorization == race_token["Authorization"]:
                with psycopg.connect(owner_dsn) as conn:
                    conn.execute("select recall_vault_intelligence_revoke(%s)", (digest(race_secret),))
            return original_set_history(
                service,
                grant,
                authorization,
                enable_history=enable_history,
                expected_version=expected_version,
            )

        monkeypatch.setattr(LocalIntelligenceService, "set_history_consent", revoke_during_consent_body)
        raced = client.post(
            history_url,
            headers={**race_token, "Content-Type": "application/json"},
            json={"enable_history": True, "expected_version": before_race["consent_version"]},
        )
        assert raced.status_code == 403
        with psycopg.connect(owner_dsn) as conn:
            unchanged = conn.execute(
                "select policy_version,version from vault_intelligence_ask_consents where workspace_id=%s",
                (workspace_id,),
            ).fetchone()
        assert unchanged == (settings.ai_policy_version, disabled_history.json()["consent_version"])
        monkeypatch.setattr(LocalIntelligenceService, "set_history_consent", original_set_history)

        with psycopg.connect(owner_dsn) as conn:
            set_ask_consent(
                conn,
                user_id=owner_id,
                workspace_id=workspace_id,
                enabled=False,
                policy_version=settings.ai_policy_version,
            )
        revoked = client.delete("/v1/vault-intelligence/device-pairings", headers=token)
        assert revoked.status_code == 200 and revoked.json()["revoked"] is True
        assert client.get("/v1/vault-intelligence/device-pairings/status", headers=token).status_code == 403
    db.close()


def test_completed_receipts_cannot_resurrect_after_consent_reopt_in_or_policy_change(pg_cluster: Any) -> None:
    owner_dsn, app_dsn = make_database(pg_cluster)
    owner_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    assert bootstrap_owner(owner_dsn.replace("recall_owner@", "postgres@"), owner_id, workspace_id)
    device_id, vault_id = uuid.uuid4(), uuid.uuid4()
    secret = "f" * 64
    with psycopg.connect(owner_dsn) as conn:
        invitation, _ = create_intelligence_invitation(
            conn,
            user_id=owner_id,
            workspace_id=workspace_id,
            device_id=device_id,
            vault_id=vault_id,
            fingerprint=digest(secret),
        )
    settings = inference_settings(app_dsn).model_copy(
        update={
            "local_intelligence_enabled": True,
            "ai_provider": "anthropic",
            "ai_model_id": "fake-model",
            "ai_api_key": "synthetic-test-key",
            "ai_input_usd_per_mtok": 1.0,
            "ai_output_usd_per_mtok": 1.0,
            "ai_daily_budget_usd": 5.0,
            "ai_monthly_budget_usd": 10.0,
        }
    )
    settings_v2 = settings.model_copy(update={"ai_provider": "openai"})
    policy_v1, policy_v2 = settings.ai_policy_version, settings_v2.ai_policy_version
    db = Database(app_dsn)
    db.open()
    with psycopg.connect(owner_dsn) as conn:
        set_ask_consent(conn, user_id=owner_id, workspace_id=workspace_id, enabled=True, policy_version=policy_v1)
    provider = FakeProvider()
    app = create_inference_app(settings, database=db, provider=provider)
    fixture_path = Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/local-intelligence-synthetic.json"
    body = json.loads(fixture_path.read_text())["requests"][0]["request"]
    body["vault_id"] = str(vault_id)
    ask_url = "/v1/local-intelligence/ask"
    token = {"Authorization": f"Bearer {secret}"}

    with TestClient(app) as client:
        assert (
            client.post(
                f"/v1/vault-intelligence/device-pairings/{invitation}/claim", json={"secret": secret}
            ).status_code
            == 200
        )
        first = client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=body)
        assert first.status_code == 200 and first.json()["state"] == "complete", first.text
        assert first.json()["result"]["status"] == "answered" and len(provider.answer_calls) == 1
        with psycopg.connect(owner_dsn) as conn:
            first_decision = conn.execute(
                "select consent_policy_version,consent_version from local_intelligence_receipts "
                "where workspace_id=%s and operation_id=%s",
                (workspace_id, uuid.UUID(body["operation_id"])),
            ).fetchone()

        # Revoke and opt in again under the same policy. No read is made during revocation.
        with psycopg.connect(owner_dsn) as conn:
            set_ask_consent(conn, user_id=owner_id, workspace_id=workspace_id, enabled=False, policy_version=policy_v1)
            set_ask_consent(conn, user_id=owner_id, workspace_id=workspace_id, enabled=True, policy_version=policy_v1)
        assert client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=body).status_code == 403
        assert client.get(f"{ask_url}/{body['operation_id']}", headers=token).status_code == 403
        assert len(provider.answer_calls) == 1
        with psycopg.connect(owner_dsn) as conn:
            old_receipt = conn.execute(
                "select state,result,error_code from local_intelligence_receipts "
                "where workspace_id=%s and operation_id=%s",
                (workspace_id, uuid.UUID(body["operation_id"])),
            ).fetchone()
        assert old_receipt == ("failed", None, "AUTHORIZATION_CHANGED")

        fresh_v1 = copy.deepcopy(body)
        fresh_v1["operation_id"] = str(uuid.uuid4())
        fresh_response = client.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=fresh_v1)
        assert fresh_response.status_code == 200 and fresh_response.json()["result"]["status"] == "answered"
        assert len(provider.answer_calls) == 2

    # A new active consent under a different policy cannot recover the v1 receipt.
    with psycopg.connect(owner_dsn) as conn:
        set_ask_consent(conn, user_id=owner_id, workspace_id=workspace_id, enabled=False, policy_version=policy_v2)
        set_ask_consent(conn, user_id=owner_id, workspace_id=workspace_id, enabled=True, policy_version=policy_v2)
    app_v2 = create_inference_app(settings_v2, database=db, provider=provider)
    with TestClient(app_v2) as client_v2:
        assert (
            client_v2.post(ask_url, headers={**token, "Content-Type": "application/json"}, json=fresh_v1).status_code
            == 403
        )
        assert client_v2.get(f"{ask_url}/{fresh_v1['operation_id']}", headers=token).status_code == 403
        assert len(provider.answer_calls) == 2
        fresh_v2 = copy.deepcopy(body)
        fresh_v2["operation_id"] = str(uuid.uuid4())
        new_policy_answer = client_v2.post(
            ask_url, headers={**token, "Content-Type": "application/json"}, json=fresh_v2
        )
        assert new_policy_answer.status_code == 200 and new_policy_answer.json()["result"]["status"] == "answered"
        assert len(provider.answer_calls) == 3
    with psycopg.connect(owner_dsn) as conn:
        invalidated_v1 = conn.execute(
            "select state,result,error_code from local_intelligence_receipts where workspace_id=%s and operation_id=%s",
            (workspace_id, uuid.UUID(fresh_v1["operation_id"])),
        ).fetchone()
        new_policy_decision = conn.execute(
            "select consent_policy_version,consent_version from local_intelligence_receipts "
            "where workspace_id=%s and operation_id=%s",
            (workspace_id, uuid.UUID(fresh_v2["operation_id"])),
        ).fetchone()
    assert invalidated_v1 == ("failed", None, "AUTHORIZATION_CHANGED")
    assert first_decision is not None and first_decision[0] == policy_v1
    assert new_policy_decision is not None and new_policy_decision[0] == policy_v2
    assert first_decision[1] < new_policy_decision[1]
    db.close()


# --- Audio transcript evidence (synthetic only; no audio, consent, route or organization changes) ---------------------

_FIXTURES = Path(__file__).resolve().parents[3] / "packages/contracts/fixtures"


def _fixture_request(filename: str, name: str) -> dict[str, Any]:
    fixture = json.loads((_FIXTURES / filename).read_text(encoding="utf-8"))
    return copy.deepcopy(next(entry["request"] for entry in fixture["requests"] if entry["name"] == name))


def _parse(request: dict[str, Any]) -> tuple[dict[str, Any], str]:
    return parse_request(json.dumps(request, ensure_ascii=False).encode())


def _audio_v1(kind: str, state: str) -> dict[str, Any]:
    request = _fixture_request("local-intelligence-synthetic.json", "audio-machine-transcript-question")
    request["evidence"][0].update(evidence_kind=kind, epistemic_state=state)
    return request


@pytest.mark.parametrize(
    ("name", "kind", "state"),
    [
        ("audio-machine-transcript-question", "machine_audio_transcript", "unreviewed"),
        ("audio-human-correction-question", "human_audio_correction", "reported"),
    ],
)
def test_audio_kinds_are_accepted_only_with_their_pinned_epistemic_state(name: str, kind: str, state: str) -> None:
    request = _fixture_request("local-intelligence-synthetic.json", name)
    assert request["evidence"][0]["evidence_kind"] == kind
    assert request["evidence"][0]["epistemic_state"] == state
    parsed, digest_value = _parse(request)
    assert parsed["evidence"][0]["evidence_kind"] == kind
    assert len(digest_value) == 64


@pytest.mark.parametrize(
    ("kind", "state"),
    [
        ("machine_audio_transcript", "reported"),
        ("machine_audio_transcript", "uncertain"),
        ("machine_audio_transcript", "question"),
        ("human_audio_correction", "unreviewed"),
        ("human_audio_correction", "uncertain"),
        ("human_audio_correction", "question"),
    ],
)
def test_audio_kinds_with_mismatched_epistemic_state_are_rejected(kind: str, state: str) -> None:
    with pytest.raises(ApiError) as caught:
        _parse(_audio_v1(kind, state))
    assert "Ask evidence labels are invalid" in str(caught.value.message)


@pytest.mark.parametrize(
    "kind",
    [
        "machine_audio",
        "audio_transcript",
        "human_audio",
        "machine_audio_reading",
        "voice_note",
        "",
        "MACHINE_AUDIO_TRANSCRIPT",
    ],
)
def test_unknown_and_near_miss_evidence_kinds_are_still_rejected(kind: str) -> None:
    with pytest.raises(ApiError) as caught:
        _parse(_audio_v1(kind, "unreviewed"))
    assert "Ask evidence labels are invalid" in str(caught.value.message)


def test_non_string_evidence_kind_is_rejected() -> None:
    request = _audio_v1("machine_audio_transcript", "unreviewed")
    request["evidence"][0]["evidence_kind"] = 7
    with pytest.raises(ApiError):
        _parse(request)


def test_existing_evidence_kind_and_state_acceptance_is_unchanged() -> None:
    for kind, state in (
        ("text_source", "reported"),
        ("human_note", "question"),
        ("human_reading_correction", "reported"),
        ("machine_reading", "unreviewed"),
    ):
        assert _parse(_audio_v1(kind, state))[0]["evidence"][0]["evidence_kind"] == kind


def _history_audio() -> dict[str, Any]:
    return _fixture_request("local-history-synthetic.json", "history-audio-correction-paired")


def test_audio_history_fixture_has_canonical_digest_and_pairs_machine_with_human_correction() -> None:
    fixture = json.loads((_FIXTURES / "local-history-synthetic.json").read_text(encoding="utf-8"))
    item = next(entry for entry in fixture["requests"] if entry["name"] == "history-audio-correction-paired")
    raw = json.dumps(item["request"], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    assert raw.decode() == item["canonical_json_utf8"]
    assert hashlib.sha256(raw).hexdigest() == item["sha256"] == parse_request(raw)[1]
    kinds = {(x["history_status"], x["evidence_kind"], x["epistemic_state"]) for x in item["request"]["evidence"]}
    assert kinds == {
        ("as_of_later_corrected", "machine_audio_transcript", "unreviewed"),
        ("current_counterpart", "human_audio_correction", "reported"),
    }


def test_audio_history_correction_must_pair_with_the_human_correction_lane() -> None:
    request = _history_audio()
    assert _parse(request)[0]["temporal"]["mode"] == "as_of"
    # The retained machine reading was corrected, so the counterpart cannot be another machine reading.
    machine_counterpart = copy.deepcopy(request)
    machine_counterpart["evidence"][1].update(evidence_kind="machine_audio_transcript", epistemic_state="unreviewed")
    with pytest.raises(ApiError):
        _parse(machine_counterpart)
    # Nor can a non-audio lane stand in for the human correction.
    other_lane = copy.deepcopy(request)
    other_lane["evidence"][1].update(evidence_kind="human_note", epistemic_state="reported")
    with pytest.raises(ApiError):
        _parse(other_lane)
    mixed = copy.deepcopy(request)
    mixed["evidence"][0].update(evidence_kind="machine_reading", epistemic_state="unreviewed")
    with pytest.raises(ApiError):
        _parse(mixed)
    # Pinned audio states still apply inside a correctly shaped pair.
    bad_state = copy.deepcopy(request)
    bad_state["evidence"][1]["epistemic_state"] = "unreviewed"
    with pytest.raises(ApiError):
        _parse(bad_state)
    # Existing text-lane history pairs stay valid.
    assert _parse(_fixture_request("local-history-synthetic.json", "history-comparison-paired"))[1]


def test_audio_history_comparison_allows_same_lane_reprocessing_but_not_lane_switching() -> None:
    request = _history_audio()
    request["temporal"]["mode"] = "compare_to_current"
    request["evidence"][0]["history_status"] = "as_of"
    request["evidence"][1].update(evidence_kind="machine_audio_transcript", epistemic_state="unreviewed")
    request["evidence"][1]["excerpt"] = "Synthetic recording: the pump reads forty five psi."
    assert _parse(request)[0]["evidence"][1]["evidence_kind"] == "machine_audio_transcript"
    # A human correction never reverts to a machine reading.
    reverted = copy.deepcopy(request)
    reverted["evidence"][0].update(evidence_kind="human_audio_correction", epistemic_state="reported")
    with pytest.raises(ApiError):
        _parse(reverted)
    # A comparison that still lacks its counterpart is rejected exactly as before.
    unpaired = copy.deepcopy(request)
    unpaired["evidence"].pop()
    unpaired["coverage"].update(eligible_count=1, selected_count=1)
    with pytest.raises(ApiError):
        _parse(unpaired)


def _audio_hits(kind: str = "machine_audio_transcript", state: str = "unreviewed") -> list[dict[str, Any]]:
    return LocalIntelligenceService._request_hits(_parse(_audio_v1(kind, state))[0])


def test_audio_evidence_is_presented_as_untrusted_unreviewed_machine_transcription() -> None:
    from recall.ingestion.prompts import ANSWER_SYSTEM
    from recall.retrieval.ask import answer_max_input_tokens, build_packet

    machine = build_packet(_audio_hits())[0]
    assert machine["kind"] == "machine_audio_transcript" and machine["epistemic_state"] == "unreviewed"
    assert "Unreviewed" in machine["handling"] and "not verified fact" in machine["handling"]
    human = build_packet(_audio_hits("human_audio_correction", "reported"))[0]
    assert human["kind"] == "human_audio_correction" and "overrides the machine transcript" in human["handling"]
    # Other kinds keep their exact packet shape, and the token bound is computed over the real packet.
    text_hits = _audio_hits("human_note", "reported")
    assert "handling" not in build_packet(text_hits)[0]
    assert answer_max_input_tokens("q", _audio_hits()) > answer_max_input_tokens("q", text_hits)
    assert "`machine_audio_transcript`" in ANSWER_SYSTEM and "untrusted machine transcription" in ANSWER_SYSTEM
    assert "never state" in ANSWER_SYSTEM and "`human_audio_correction`" in ANSWER_SYSTEM


def test_citations_to_audio_evidence_are_quote_validated_against_the_supplied_excerpt() -> None:
    from recall.retrieval.ask import verify_answer

    hits = _audio_hits()
    excerpt = hits[0]["excerpt"]
    answered = json.dumps(
        {
            "status": "answered",
            "sentences": [{"text": "The transcript suggests a pump reading.", "citation_ids": ["c1"]}],
            "limitations": [],
        }
    )
    verified = verify_answer(answered, hits)
    assert verified is not None
    citation = verified["citations"][0]
    assert citation["quote"] == excerpt[:300] and citation["quote"] in excerpt
    assert citation["kind"] == "machine_audio_transcript" and citation["epistemic_state"] == "unreviewed"
    # An invented or out-of-packet citation rejects the whole answer, exactly as for other evidence.
    assert verify_answer(answered.replace('"c1"', '"c2"'), hits) is None
    # The model cannot supply its own quote or evidence fields.
    forged = json.dumps(
        {
            "status": "answered",
            "sentences": [{"text": "x", "citation_ids": ["c1"], "quote": "invented words"}],
            "limitations": [],
        }
    )
    assert verify_answer(forged, hits) is None


def test_reliance_on_machine_audio_transcript_adds_one_deterministic_limitation() -> None:
    hits = _audio_hits()
    verified = {
        "status": "answered",
        "sentences": [{"text": "It suggests a reading.", "citation_ids": ["c1"]}],
        "limitations": ["Model limitation."],
    }
    limitations = LocalIntelligenceService._audio_limitations(hits, verified)
    assert limitations[0].startswith("Some cited evidence is an automatic audio transcript")
    assert limitations[1:] == ["Model limitation."]
    assert LocalIntelligenceService._audio_limitations(hits, {**verified, "limitations": limitations}) == limitations
    full = {**verified, "limitations": [f"limit {i}" for i in range(6)]}
    capped = LocalIntelligenceService._audio_limitations(hits, full)
    assert len(capped) == 6 and capped[0] == limitations[0] and all(len(x) <= 500 for x in capped)
    human = _audio_hits("human_audio_correction", "reported")
    assert LocalIntelligenceService._audio_limitations(human, verified) == ["Model limitation."]
    text = _audio_hits("human_note", "reported")
    assert LocalIntelligenceService._audio_limitations(text, verified) == ["Model limitation."]


def test_abstention_over_audio_evidence_is_unchanged() -> None:
    from recall.retrieval.ask import verify_answer

    hits = _audio_hits()
    raw = json.dumps({"status": "insufficient_evidence", "sentences": [], "limitations": ["Transcript unclear."]})
    verified = verify_answer(raw, hits)
    assert verified is not None
    assert verified["status"] == "insufficient_evidence" and verified["sentences"] == [] and verified["citations"] == []
    assert LocalIntelligenceService._audio_limitations(hits, verified) == ["Transcript unclear."]
    # An answered status without sentences is still unverifiable.
    assert verify_answer(json.dumps({"status": "answered", "sentences": [], "limitations": []}), hits) is None
