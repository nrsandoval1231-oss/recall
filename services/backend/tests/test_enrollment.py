"""Operator enrollment, cookie-session bearer, and the pilot negative cases.

Synthetic identities only. The enrollment token and session token are hashed
before storage; these tests never use a live provider.
"""

from __future__ import annotations

import uuid
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from conftest import Env, manifest_for, sha, synthetic_image
from recall.api.app import create_app
from recall.api.auth import StaticKeyResolver, TokenVerifier

OPERATOR = "operator-token-for-tests-0123456789abcd"
SITE = "https://recall.example.test"


@pytest.fixture(scope="module")
def enroll_env(pg_cluster: Any, jwt_key: Any, tmp_path_factory: pytest.TempPathFactory) -> Any:
    env = Env(
        pg_cluster,
        jwt_key,
        tmp_path_factory.mktemp("enroll"),
        overrides={
            "operator_token": OPERATOR,
            "site_origins": [SITE],
            "enrollment_client_limit": 3,
            "enrollment_global_limit": 500,
            "operator_issue_limit": 500,
        },
    )
    yield env
    env.close()


def _operator(env: Env, body: dict[str, object] | None = None, token: str = OPERATOR) -> Any:
    return env.client.post(
        "/v1/operator/enrollments",
        json={} if body is None else body,
        headers={"Authorization": f"Bearer {token}"},
    )


def _redeem(env: Env, token: str, **headers: str) -> Any:
    sent = {
        "X-Recall-Enrollment": "1",
        "Origin": SITE,
        "X-Recall-Client-Key": uuid.uuid4().hex + uuid.uuid4().hex[:32],
        **headers,
    }
    return env.client.post("/v1/enrollment/redeem", json={"enrollment_token": token}, headers=sent)


def _session(env: Env, label: str | None = None) -> dict[str, str]:
    issued = _operator(env, {} if label is None else {"label": label})
    assert issued.status_code == 201, issued.text
    payload = issued.json()
    redeemed = _redeem(env, payload["enrollment_token"])
    assert redeemed.status_code == 200, redeemed.text
    body = redeemed.json()
    assert body["session_token"].startswith("rcs_")
    assert "enrollment_token" not in body
    return {**payload, **body}


def _auth(session: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {session['session_token']}"}


def test_unprovisioned_requests_do_not_read_private_memory(enroll_env: Env) -> None:
    assert enroll_env.client.get("/v1/me").status_code == 401
    source = enroll_env.client.get(f"/v1/sources/{uuid.uuid4()}/content")
    assert source.status_code == 401
    assert enroll_env.client.get("/v1/captures").status_code == 401
    issued = _operator(enroll_env, token="not-the-operator-token-0123456789abcd")
    assert issued.status_code == 401


def test_operator_routes_are_hidden_until_configured(enroll_env: Env) -> None:
    settings = enroll_env.settings.model_copy(update={"operator_token": None})
    verifier = TokenVerifier(
        StaticKeyResolver(enroll_env.key.public_key(), ["ES256"]), settings.auth_issuer, settings.auth_audience
    )
    app = create_app(settings, verifier=verifier, store=enroll_env.store, database=enroll_env.db)
    with TestClient(app) as client:
        hidden = client.post("/v1/operator/enrollments", json={})
        assert hidden.status_code == 404
        assert client.post("/v1/operator/kill-switch").status_code == 404


def test_redeem_is_single_use_and_a_replay_does_not_mint_another_session(enroll_env: Env) -> None:
    issued = _operator(enroll_env, {"label": "pilot phone"})
    token = issued.json()["enrollment_token"]
    assert token.startswith("enr_")
    client_key = "ab" * 32
    first = _redeem(enroll_env, token, **{"X-Recall-Client-Key": client_key})
    assert first.status_code == 200
    replay = _redeem(enroll_env, token, **{"X-Recall-Client-Key": client_key})
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "UNAUTHENTICATED"
    assert (
        enroll_env.client.get(
            "/v1/me", headers={"Authorization": f"Bearer {first.json()['session_token']}"}
        ).status_code
        == 200
    )
    with psycopg.connect(enroll_env.admin_dsn) as conn:
        sessions = conn.execute(
            "select count(*) from device_sessions where user_id=%s", (issued.json()["user_id"],)
        ).fetchone()
        outcome = conn.execute(
            "select outcome from auth_audit_events where action='enrollment.redeem' and enrollment_id=%s order by id",
            (issued.json()["enrollment_id"],),
        ).fetchall()
    assert sessions is not None and sessions[0] == 1
    assert [row[0] for row in outcome] == ["redeemed", "replayed"]
    with psycopg.connect(enroll_env.admin_dsn) as conn:
        stored = conn.execute(
            "select token_hash from device_enrollments where id=%s", (issued.json()["enrollment_id"],)
        ).fetchone()
    assert stored is not None and token not in stored[0]


def test_expired_revoked_and_rate_limited_capabilities_do_not_enroll(enroll_env: Env) -> None:
    expired = _operator(enroll_env).json()
    with psycopg.connect(enroll_env.admin_dsn) as conn:
        conn.execute(
            "update device_enrollments set expires_at = now() - interval '1 minute' where id=%s",
            (expired["enrollment_id"],),
        )
    assert _redeem(enroll_env, expired["enrollment_token"]).status_code == 401

    stolen = _operator(enroll_env).json()
    revoked = enroll_env.client.post(
        f"/v1/operator/enrollments/{stolen['enrollment_id']}/revoke",
        headers={"Authorization": f"Bearer {OPERATOR}"},
    )
    assert revoked.status_code == 200
    assert _redeem(enroll_env, stolen["enrollment_token"]).status_code == 401

    stranger = uuid.uuid4()
    workspace = uuid.uuid4()
    with psycopg.connect(enroll_env.admin_dsn) as conn:
        conn.execute(
            "insert into workspaces (id, name, created_by) values (%s, 'Other', %s)",
            (workspace, stranger),
        )
    denied = _operator(enroll_env, {"user_id": str(uuid.uuid4()), "workspace_id": str(workspace)})
    assert denied.status_code == 403

    limited_key = "cd" * 32
    for _ in range(3):
        assert _redeem(enroll_env, "enr_" + "a" * 20, **{"X-Recall-Client-Key": limited_key}).status_code == 401
    blocked = _redeem(enroll_env, "enr_" + "b" * 20, **{"X-Recall-Client-Key": limited_key})
    assert blocked.status_code == 429
    fresh = _operator(enroll_env).json()
    held = _redeem(enroll_env, fresh["enrollment_token"], **{"X-Recall-Client-Key": limited_key})
    assert held.status_code == 429
    later = _redeem(enroll_env, fresh["enrollment_token"], **{"X-Recall-Client-Key": "ef" * 32})
    assert later.status_code == 200


def test_csrf_does_not_consume_an_enrollment_capability(enroll_env: Env) -> None:
    issued = _operator(enroll_env).json()
    token = issued["enrollment_token"]
    missing = enroll_env.client.post("/v1/enrollment/redeem", json={"enrollment_token": token})
    assert missing.status_code == 403
    cross = _redeem(enroll_env, token, **{"Sec-Fetch-Site": "cross-site"})
    assert cross.status_code == 403
    evil = _redeem(enroll_env, token, Origin="https://evil.example")
    assert evil.status_code == 403
    redeemed = _redeem(enroll_env, token)
    assert redeemed.status_code == 200
    with psycopg.connect(enroll_env.admin_dsn) as conn:
        csrf = conn.execute(
            "select count(*) from auth_audit_events where action='enrollment.redeem' and outcome='csrf' and enrollment_id is null"
        ).fetchone()
    assert csrf is not None and csrf[0] >= 3


def test_revoked_device_loses_api_and_original_access(enroll_env: Env) -> None:
    session = _session(enroll_env, "desk")
    headers = _auth(session)
    assert enroll_env.client.get("/v1/me", headers=headers).status_code == 200
    user = enroll_env.user()
    user.id = uuid.UUID(session["user_id"])
    user.device_id = uuid.uuid4()
    # Register and store through the device session, not a provider JWT.
    registered = enroll_env.client.post(
        "/v1/devices",
        json={"device_id": str(user.device_id), "platform": "web"},
        headers=headers,
    )
    assert registered.status_code == 201, registered.text
    pages = [synthetic_image(seed=4)]
    manifest = manifest_for(user, pages)
    created = enroll_env.client.post(
        "/v1/captures",
        json=manifest,
        headers={**headers, "Idempotency-Key": str(manifest["client_capture_id"])},
    )
    assert created.status_code == 201, created.text
    capture = created.json()
    auths = enroll_env.client.post(
        f"/v1/captures/{capture['capture_id']}/upload-authorizations", headers=headers
    ).json()["authorizations"]
    uploaded = enroll_env.client.put(
        auths[0]["url"], content=pages[0], headers={**headers, **auths[0]["required_headers"]}
    )
    assert uploaded.status_code == 200, uploaded.text
    finalized = enroll_env.client.post(
        f"/v1/captures/{capture['capture_id']}/finalize",
        json={"expected_pages": [{"source_id": capture["pages"][0]["source_id"], "sha256": sha(pages[0])}]},
        headers={**headers, "Idempotency-Key": f"fin-{capture['capture_id']}"},
    )
    assert finalized.status_code == 200, finalized.text
    source_id = capture["pages"][0]["source_id"]
    original = enroll_env.client.get(f"/v1/sources/{source_id}/content", headers=headers)
    assert original.status_code == 200 and original.content == pages[0]

    revoke = enroll_env.client.post(
        f"/v1/operator/sessions/{session['session_id']}/revoke",
        headers={"Authorization": f"Bearer {OPERATOR}"},
    )
    assert revoke.status_code == 200
    assert enroll_env.client.get("/v1/me", headers=headers).status_code == 401
    assert enroll_env.client.get(f"/v1/sources/{source_id}/content", headers=headers).status_code == 401
    assert enroll_env.client.get(f"/v1/captures/{capture['capture_id']}", headers=headers).status_code == 401


def test_device_session_cannot_read_or_write_another_workspace(enroll_env: Env) -> None:
    first = _session(enroll_env)
    headers_a = _auth(first)
    owner = enroll_env.user()
    owner.id = uuid.UUID(first["user_id"])
    owner.device_id = uuid.uuid4()
    registered = enroll_env.client.post(
        "/v1/devices",
        json={"device_id": str(owner.device_id), "platform": "web", "name": "phone"},
        headers=headers_a,
    )
    assert registered.status_code == 201, registered.text
    pages = [synthetic_image(seed=9)]
    manifest = manifest_for(owner, pages, hint="workspace-a-only")
    created = enroll_env.client.post(
        "/v1/captures",
        json=manifest,
        headers={
            **headers_a,
            "Idempotency-Key": str(manifest["client_capture_id"]),
            "X-Workspace-Id": str(uuid.uuid4()),
        },
    )
    assert created.status_code == 201, created.text
    capture = created.json()
    with psycopg.connect(enroll_env.admin_dsn) as conn:
        stored_ws = conn.execute("select workspace_id from captures where id=%s", (capture["capture_id"],)).fetchone()
    assert stored_ws is not None and str(stored_ws[0]) == first["workspace_id"]

    other_workspace = uuid.uuid4()
    with psycopg.connect(enroll_env.admin_dsn) as conn:
        conn.execute(
            "insert into workspaces (id, name, created_by) values (%s, 'Second', %s)",
            (other_workspace, owner.id),
        )
        conn.execute(
            "insert into workspace_members (workspace_id, user_id, role) values (%s, %s, 'owner')",
            (other_workspace, owner.id),
        )
    issued_b = _operator(enroll_env, {"user_id": first["user_id"], "workspace_id": str(other_workspace)})
    assert issued_b.status_code == 201, issued_b.text
    redeemed_b = _redeem(enroll_env, issued_b.json()["enrollment_token"])
    assert redeemed_b.status_code == 200, redeemed_b.text
    headers_b = {"Authorization": f"Bearer {redeemed_b.json()['session_token']}"}
    me = enroll_env.client.get("/v1/me", headers=headers_b)
    assert me.status_code == 200
    assert me.json()["active_workspace_id"] == str(other_workspace)
    assert enroll_env.client.get("/v1/captures", headers=headers_b).json()["items"] == []
    assert enroll_env.client.get(f"/v1/captures/{capture['capture_id']}", headers=headers_b).status_code == 404
    assert (
        enroll_env.client.post(
            f"/v1/captures/{capture['capture_id']}/upload-authorizations", headers=headers_b
        ).status_code
        == 404
    )
    write = enroll_env.client.post(
        f"/v1/captures/{capture['capture_id']}/finalize",
        json={"expected_pages": [{"source_id": capture["pages"][0]["source_id"], "sha256": sha(pages[0])}]},
        headers={**headers_b, "Idempotency-Key": "cross-workspace-write-01"},
    )
    assert write.status_code == 404
    assert (
        enroll_env.client.get("/v1/captures", headers=headers_a).json()["items"][0]["capture_id"]
        == capture["capture_id"]
    )


def test_kill_switch_revokes_live_sessions(enroll_env: Env) -> None:
    one = _session(enroll_env)
    two = _session(enroll_env)
    killed = enroll_env.client.post("/v1/operator/kill-switch", headers={"Authorization": f"Bearer {OPERATOR}"})
    assert killed.status_code == 200 and killed.json()["revoked_sessions"] >= 2
    assert enroll_env.client.get("/v1/me", headers=_auth(one)).status_code == 401
    assert enroll_env.client.get("/v1/me", headers=_auth(two)).status_code == 401


def test_api_role_cannot_read_enrollment_secrets(enroll_env: Env) -> None:
    for table in ("device_sessions", "device_enrollments", "auth_audit_events"):
        with psycopg.connect(enroll_env.app_dsn) as conn, pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(f"select * from {table}")
