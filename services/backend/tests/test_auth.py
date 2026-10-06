"""Authentication: provider-issued tokens only; workspace is derived, never supplied."""

from __future__ import annotations

import base64
import json
import time
import uuid

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from conftest import AUDIENCE, ISSUER, Env, make_token
from recall.api.auth import StaticKeyResolver, TokenVerifier
from recall.config import Settings


def _b64(obj: dict[str, object]) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()


def _bad_tokens(env: Env) -> dict[str, str]:
    uid = uuid.uuid4()
    other = ec.generate_private_key(ec.SECP256R1())
    public_pem = env.key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    unsigned = f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64({'sub': str(uid), 'iss': ISSUER, 'aud': AUDIENCE, 'exp': int(time.time()) + 600})}."
    return {
        "wrong_signing_key": make_token(other, uid),
        "expired": make_token(env.key, uid, exp=int(time.time()) - 3600),
        "wrong_audience": make_token(env.key, uid, aud="anon"),
        "wrong_issuer": make_token(env.key, uid, iss="https://evil.example/auth/v1"),
        "alg_none": unsigned,
        "hs256_with_public_key_as_secret": jwt.encode(
            {"sub": str(uid), "iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 600},
            public_pem,
            algorithm="HS256",
        )
        if False
        else _hs256_forgery(public_pem, uid),
        "non_uuid_subject": make_token(env.key, uid, sub="admin"),
        "missing_subject": make_token(env.key, uid, sub=None),
        "missing_expiry": make_token(env.key, uid, exp=None),
        "garbage": "not-a-jwt",
    }


def _hs256_forgery(public_pem: bytes, uid: uuid.UUID) -> str:
    import hashlib
    import hmac

    header = _b64({"alg": "HS256", "typ": "JWT"})
    body = _b64({"sub": str(uid), "iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 600})
    sig = hmac.new(public_pem, f"{header}.{body}".encode(), hashlib.sha256).digest()
    return f"{header}.{body}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"


def test_invalid_credentials_are_rejected_everywhere(env: Env) -> None:
    for name, token in _bad_tokens(env).items():
        for path in ("/v1/me", "/v1/captures"):
            resp = env.client.get(path, headers={"Authorization": f"Bearer {token}"})
            assert resp.status_code == 401, (name, path)
            assert resp.json()["error"]["code"] == "UNAUTHENTICATED"


def test_every_v1_route_requires_authentication(env: Env) -> None:
    sid = uuid.uuid4()
    calls = [
        ("GET", "/v1/me"),
        ("POST", "/v1/devices"),
        ("POST", "/v1/captures"),
        ("GET", "/v1/captures"),
        ("GET", f"/v1/captures/{sid}"),
        ("POST", f"/v1/captures/{sid}/upload-authorizations"),
        ("POST", f"/v1/captures/{sid}/finalize"),
        ("PUT", "/v1/uploads/whatever"),
        ("GET", f"/v1/sources/{sid}/content"),
    ]
    for method, path in calls:
        for headers in ({}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer"}):
            assert env.client.request(method, path, headers=headers).status_code == 401, (method, path, headers)


def test_valid_token_works_and_health_is_public(env: Env) -> None:
    user = env.user()
    me = user.req("GET", "/v1/me")
    assert me.status_code == 200 and me.json()["user_id"] == str(user.id)
    assert env.client.get("/healthz").json() == {"status": "ok"}
    assert env.client.get("/readyz").json() == {"status": "ready"}


def test_hs256_projects_accept_only_hs256_and_correct_secret() -> None:
    secret = "legacy-shared-secret-0123456789-abcdefghij"
    settings = Settings(
        database_url="postgresql://x",
        auth_issuer=ISSUER,
        auth_jwt_secret=secret,
        signing_secret="s" * 32,
    )
    verifier = TokenVerifier.from_settings(settings)
    uid = uuid.uuid4()
    good = jwt.encode({"sub": str(uid), "iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 60}, secret, "HS256")
    assert verifier.verify(good).user_id == uid
    from recall.errors import ApiError

    bad = jwt.encode({"sub": str(uid), "iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 60}, "x" * 40, "HS256")
    with pytest.raises(ApiError):
        verifier.verify(bad)
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    rs = jwt.encode({"sub": str(uid), "iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 60}, rsa_key, "RS256")
    with pytest.raises(ApiError):
        verifier.verify(rs)
    assert isinstance(StaticKeyResolver, type)


def test_settings_reject_unsafe_configuration() -> None:
    base = {"database_url": "postgresql://x", "auth_issuer": ISSUER}
    with pytest.raises(ValueError, match="exactly one"):
        Settings(**base, signing_secret="s" * 32)
    with pytest.raises(ValueError, match="at least 32"):
        Settings(**base, auth_jwks_url="https://x/jwks", signing_secret="short")
    with pytest.raises(ValueError, match="supabase storage"):
        Settings(**base, auth_jwks_url="https://x/jwks", signing_secret="s" * 32, storage_backend="supabase")


def test_auto_provisioning_can_be_disabled(env: Env) -> None:
    from fastapi.testclient import TestClient

    from conftest import REPO_ROOT
    from recall.api.app import create_app

    settings = env.settings.model_copy(update={"auto_provision_workspaces": False})
    verifier = TokenVerifier(StaticKeyResolver(env.key.public_key(), ["ES256"]), ISSUER, AUDIENCE)
    app = create_app(settings, verifier=verifier, store=env.store, database=env.db)
    uid = uuid.uuid4()
    with TestClient(app) as client:
        headers = {"Authorization": f"Bearer {make_token(env.key, uid)}"}
        resp = client.get("/v1/me", headers=headers)
        assert resp.status_code == 403 and resp.json()["error"]["code"] == "FORBIDDEN"
        ws = uuid.uuid4()
        with psycopg.connect(env.admin_dsn) as conn:
            conn.execute(
                "insert into workspaces (id, name, created_by, personal_for_user) values (%s,'P',%s,%s)", (ws, uid, uid)
            )
            conn.execute(
                "insert into workspace_members (workspace_id, user_id, role) values (%s,%s,'owner')", (ws, uid)
            )
        assert client.get("/v1/me", headers=headers).status_code == 200
    assert REPO_ROOT.exists()


def test_concurrent_first_requests_provision_exactly_one_workspace(env: Env) -> None:
    from concurrent.futures import ThreadPoolExecutor

    from recall.domain.captures import CaptureService

    service = CaptureService(env.db, env.store, env.settings)
    uid = uuid.uuid4()
    with ThreadPoolExecutor(6) as pool:
        ids = list(pool.map(lambda _: service.me(uid, None)["active_workspace_id"], range(6)))
    assert len(set(ids)) == 1
    with psycopg.connect(env.admin_dsn) as conn:
        assert conn.execute("select count(*) from workspace_members where user_id=%s", (uid,)).fetchone()[0] == 1  # type: ignore[index]
