"""The checked-in capture schema is the single authoring source; examples and API agree."""

from __future__ import annotations

import json

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from conftest import REPO_ROOT, Env, manifest_for, synthetic_image

SCHEMA = json.loads((REPO_ROOT / "packages/contracts/capture.schema.json").read_text())


def test_schema_is_valid_and_synthetic_example_conforms() -> None:
    Draft202012Validator.check_schema(SCHEMA)
    example = json.loads((REPO_ROOT / "tests/fixtures/synthetic/maintenance-capture.json").read_text())
    assert not list(Draft202012Validator(SCHEMA, format_checker=FormatChecker()).iter_errors(example))


def test_manifests_used_by_tests_conform_to_the_schema(env: Env) -> None:
    user = env.user()
    manifest = manifest_for(user, [synthetic_image(seed=1), synthetic_image(seed=2)])
    assert not list(Draft202012Validator(SCHEMA, format_checker=FormatChecker()).iter_errors(manifest))


def test_openapi_publishes_the_authoritative_request_schema(env: Env) -> None:
    openapi = env.app.openapi()
    body = openapi["paths"]["/v1/captures"]["post"]["requestBody"]["content"]["application/json"]["schema"]
    assert body["title"] == SCHEMA["title"] and body["required"] == SCHEMA["required"]
    assert set(openapi["paths"]) >= {
        "/v1/me",
        "/v1/devices",
        "/v1/captures",
        "/v1/captures/{capture_id}",
        "/v1/captures/{capture_id}/upload-authorizations",
        "/v1/captures/{capture_id}/finalize",
        "/v1/sources/{source_id}/content",
    }


def test_error_envelope_shape_and_request_id(env: Env) -> None:
    resp = env.client.get("/v1/me", headers={"X-Request-ID": "trace-abcdef123"})
    assert resp.status_code == 401
    assert resp.json() == {
        "error": {
            "code": "UNAUTHENTICATED",
            "message": "Sign in again.",
            "retryable": False,
            "request_id": "trace-abcdef123",
        }
    }
    assert resp.headers["x-request-id"] == "trace-abcdef123"
    assert env.client.get("/no/such/route").json()["error"]["code"] == "NOT_FOUND"


def test_cors_is_closed_by_default_and_explicit_when_configured(env: Env) -> None:
    from fastapi.testclient import TestClient

    from recall.api.app import create_app
    from recall.api.auth import StaticKeyResolver, TokenVerifier

    preflight = {
        "Origin": "http://tauri.localhost",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
    }
    assert "access-control-allow-origin" not in env.client.options("/v1/me", headers=preflight).headers
    settings = env.settings.model_copy(update={"cors_allow_origins": ["http://tauri.localhost"]})
    verifier = TokenVerifier(StaticKeyResolver(env.key.public_key(), ["ES256"]), "i", "a")
    with TestClient(create_app(settings, verifier=verifier, store=env.store, database=env.db)) as client:
        ok = client.options("/v1/me", headers=preflight)
        assert ok.headers["access-control-allow-origin"] == "http://tauri.localhost"
        evil = client.options("/v1/me", headers={**preflight, "Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in evil.headers
    import pytest

    from recall.config import Settings

    with pytest.raises(ValueError, match="explicit origins"):
        Settings(
            database_url="x",
            auth_issuer="i",
            auth_jwks_url="https://x/j",
            signing_secret="s" * 32,
            cors_allow_origins=["*"],
        )


def test_cors_origins_accept_comma_separated_environment(monkeypatch) -> None:
    from recall.config import Settings

    monkeypatch.setenv("DATABASE_URL", "postgresql://recall@example.test/recall")
    monkeypatch.setenv("RECALL_AUTH_ISSUER", "https://issuer.example.test")
    monkeypatch.setenv("RECALL_AUTH_JWKS_URL", "https://issuer.example.test/.well-known/jwks.json")
    monkeypatch.setenv("RECALL_SIGNING_SECRET", "s" * 32)
    monkeypatch.setenv("RECALL_CORS_ORIGINS", "http://tauri.localhost, https://tauri.localhost")

    settings = Settings()

    assert settings.cors_allow_origins == ["http://tauri.localhost", "https://tauri.localhost"]


def test_cors_origins_accept_json_array_environment(monkeypatch) -> None:
    from recall.config import Settings

    monkeypatch.setenv("DATABASE_URL", "postgresql://recall@example.test/recall")
    monkeypatch.setenv("RECALL_AUTH_ISSUER", "https://issuer.example.test")
    monkeypatch.setenv("RECALL_AUTH_JWKS_URL", "https://issuer.example.test/.well-known/jwks.json")
    monkeypatch.setenv("RECALL_SIGNING_SECRET", "s" * 32)
    monkeypatch.setenv("RECALL_CORS_ORIGINS", '["http://tauri.localhost", "https://tauri.localhost"]')

    settings = Settings()

    assert settings.cors_allow_origins == ["http://tauri.localhost", "https://tauri.localhost"]


@pytest.mark.parametrize("origins", ["*", '["*"]'])
def test_cors_wildcard_is_rejected_from_environment(monkeypatch, origins: str) -> None:
    from recall.config import Settings

    monkeypatch.setenv("DATABASE_URL", "postgresql://recall@example.test/recall")
    monkeypatch.setenv("RECALL_AUTH_ISSUER", "https://issuer.example.test")
    monkeypatch.setenv("RECALL_AUTH_JWKS_URL", "https://issuer.example.test/.well-known/jwks.json")
    monkeypatch.setenv("RECALL_SIGNING_SECRET", "s" * 32)
    monkeypatch.setenv("RECALL_CORS_ORIGINS", origins)

    with pytest.raises(ValueError, match="explicit origins"):
        Settings()
