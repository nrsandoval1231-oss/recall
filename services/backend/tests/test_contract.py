"""The checked-in capture schema is the single authoring source; examples and API agree."""

from __future__ import annotations

import json

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
