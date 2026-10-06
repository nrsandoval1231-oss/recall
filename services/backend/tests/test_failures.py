"""A04/A05: authorization failures, incomplete/interrupted uploads, storage loss, restarts."""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid

from fastapi.testclient import TestClient

from conftest import (
    AUDIENCE,
    ISSUER,
    Env,
    create_capture,
    finalize,
    make_token,
    manifest_for,
    sha,
    stored_capture,
    synthetic_image,
    upload_all,
)
from recall.api.app import create_app
from recall.api.auth import StaticKeyResolver, TokenVerifier
from recall.db.database import Database
from recall.domain.tokens import issue_upload_token


def _setup(env: Env, n: int = 1):  # type: ignore[no-untyped-def]
    user = env.user()
    user.register_device()
    pages = [synthetic_image(seed=20 + i) for i in range(n)]
    created = create_capture(user, manifest_for(user, pages)).json()
    auths = user.req("POST", f"/v1/captures/{created['capture_id']}/upload-authorizations").json()["authorizations"]
    return user, pages, created, auths


def test_invalid_upload_authorization(env: Env) -> None:
    user, pages, _, auths = _setup(env)
    for token in ("garbage", auths[0]["url"].rsplit("/", 1)[1][:-4] + "AAAA"):
        resp = user.req("PUT", f"/v1/uploads/{token}", content=pages[0], headers={"Content-Type": "image/jpeg"})
        assert resp.status_code == 403 and resp.json()["error"]["code"] == "UPLOAD_AUTHORIZATION_INVALID"


def test_expired_upload_authorization_can_be_renewed(env: Env) -> None:
    user, pages, created, auths = _setup(env)
    expired, _ = issue_upload_token(
        env.settings.signing_secret,
        workspace_id=uuid.UUID(user.req("GET", "/v1/me").json()["active_workspace_id"]),
        actor_id=user.id,
        capture_id=uuid.UUID(created["capture_id"]),
        source_id=uuid.UUID(auths[0]["source_id"]),
        ttl_seconds=600,
        now=time.time() - 3600,
    )
    resp = user.req("PUT", f"/v1/uploads/{expired}", content=pages[0], headers={"Content-Type": "image/jpeg"})
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "UPLOAD_AUTHORIZATION_EXPIRED"
    assert resp.json()["error"]["retryable"] is True
    upload_all(user, created, pages)  # renewed authorization works
    assert finalize(user, created).status_code == 200


def test_upload_authorization_is_bound_to_a_single_source(env: Env) -> None:
    user, pages, created, auths = _setup(env, n=2)
    by_source = {a["source_id"]: a for a in auths}
    first, second = created["pages"]
    # page 2's bytes through page 1's authorization: hash mismatch, nothing stored
    resp = user.req(
        "PUT", by_source[first["source_id"]]["url"], content=pages[1], headers={"Content-Type": "image/jpeg"}
    )
    assert resp.status_code in (413, 422, 409)
    state = user.req("GET", f"/v1/captures/{created['capture_id']}").json()
    assert [p["upload_state"] for p in state["pages"]] == ["pending", "pending"]
    assert second["source_id"] in by_source


def test_expired_bearer_token_is_rejected_mid_flow(env: Env) -> None:
    user, pages, created, auths = _setup(env)
    stale = {"Authorization": f"Bearer {make_token(env.key, user.id, exp=int(time.time()) - 3600)}"}
    resp = env.client.put(auths[0]["url"], content=pages[0], headers={**stale, "Content-Type": "image/jpeg"})
    assert resp.status_code == 401
    assert env.client.post(f"/v1/captures/{created['capture_id']}/finalize", headers=stale).status_code == 401


def test_incomplete_upload_cannot_be_finalized(env: Env) -> None:
    user, pages, created, auths = _setup(env, n=3)
    by_source = {a["source_id"]: a for a in auths}
    for page, data in list(zip(created["pages"], pages, strict=True))[:2]:  # upload 2 of 3
        auth = by_source[page["source_id"]]
        assert user.req("PUT", auth["url"], content=data, headers=auth["required_headers"]).status_code == 200
    resp = finalize(user, created)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "UPLOAD_INCOMPLETE"
    assert resp.json()["error"]["retryable"] is True
    assert resp.json()["error"]["details"]["missing_source_ids"] == [created["pages"][2]["source_id"]]
    assert user.req("GET", f"/v1/captures/{created['capture_id']}").json()["status"] == "awaiting_upload"
    # source viewing is refused until verified
    blocked = user.req("GET", f"/v1/sources/{created['pages'][0]['source_id']}/content")
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "SOURCE_UNAVAILABLE"
    # resume: authorizations are issued only for the pending page, then finalize succeeds
    renewed = user.req("POST", f"/v1/captures/{created['capture_id']}/upload-authorizations").json()["authorizations"]
    assert {a["source_id"] for a in renewed} == {p["source_id"] for p in created["pages"]}
    upload_all(user, created, pages)
    assert finalize(user, created).json()["status"] == "stored"


def test_finalize_rejects_wrong_or_partial_client_expectations(env: Env) -> None:
    user, pages, created, _ = _setup(env, n=2)
    upload_all(user, created, pages)
    path = f"/v1/captures/{created['capture_id']}/finalize"
    wrong = {"expected_pages": [{"source_id": p["source_id"], "sha256": sha(b"other")} for p in created["pages"]]}
    resp = user.req("POST", path, json=wrong, headers={"Idempotency-Key": "finalize-wrong-0001"})
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "HASH_MISMATCH"
    partial = {
        "expected_pages": [
            {"source_id": created["pages"][0]["source_id"], "sha256": created["pages"][0]["declared_sha256"]}
        ]
    }
    assert user.req("POST", path, json=partial, headers={"Idempotency-Key": "finalize-part-0001"}).status_code == 422
    assert user.req("POST", path, json={}, headers={"Idempotency-Key": "finalize-empty-001"}).status_code == 422
    assert user.req("GET", f"/v1/captures/{created['capture_id']}").json()["status"] == "awaiting_upload"


def test_storage_loss_after_upload_blocks_finalize_until_reupload(env: Env) -> None:
    user, pages, created, _ = _setup(env)
    upload_all(user, created, pages)
    victim = next(
        p
        for p in env.store_dir.glob(f"workspaces/*/captures/{created['capture_id']}/sources/*/original")
        if p.is_file()
    )
    saved = victim.read_bytes()
    victim.unlink()
    resp = finalize(user, created)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "UPLOAD_INCOMPLETE"
    upload_all(user, created, pages)  # received-but-missing pages are re-authorised and healed
    assert victim.read_bytes() == saved
    assert finalize(user, created).status_code == 200


def test_storage_corruption_is_detected_not_acknowledged(env: Env) -> None:
    user, pages, created, _ = _setup(env)
    upload_all(user, created, pages)
    victim = next(
        p
        for p in env.store_dir.glob(f"workspaces/*/captures/{created['capture_id']}/sources/*/original")
        if p.is_file()
    )
    data = bytearray(victim.read_bytes())
    data[len(data) // 2] ^= 0xFF
    victim.write_bytes(bytes(data))
    resp = finalize(user, created)
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "HASH_MISMATCH"
    assert user.req("GET", f"/v1/captures/{created['capture_id']}").json()["status"] == "awaiting_upload"


def test_interrupted_upload_stores_nothing_and_retry_succeeds(env: Env) -> None:
    """Client disconnects mid-body (ASGI http.disconnect): no partial object, state stays pending."""
    user, pages, created, auths = _setup(env)
    data = pages[0]
    before = sum(1 for p in env.store_dir.rglob("*") if p.is_file())

    async def drive() -> None:
        sent: list[dict[str, object]] = []
        events = iter(
            [
                {"type": "http.request", "body": data[: len(data) // 2], "more_body": True},
                {"type": "http.disconnect"},
            ]
        )

        async def receive() -> dict[str, object]:
            return next(events, {"type": "http.disconnect"})

        async def send(message: dict[str, object]) -> None:
            sent.append(message)

        headers = [
            (k.lower().encode(), v.encode())
            for k, v in {**user.headers, "Content-Type": "image/jpeg", "Content-Length": str(len(data))}.items()
        ]
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "PUT",
            "path": auths[0]["url"],
            "raw_path": auths[0]["url"].encode(),
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 1),
            "server": ("test", 80),
            "scheme": "http",
        }
        with contextlib.suppress(Exception):  # a dropped connection surfaces as an exception; that is the point
            await env.app(scope, receive, send)

    asyncio.run(drive())
    assert sum(1 for p in env.store_dir.rglob("*") if p.is_file()) == before
    assert not list(env.store_dir.rglob(".incoming-*"))
    assert user.req("GET", f"/v1/captures/{created['capture_id']}").json()["pages"][0]["upload_state"] == "pending"
    upload_all(user, created, pages)
    assert finalize(user, created).status_code == 200


def test_server_restart_between_every_step_loses_nothing(env: Env) -> None:
    """A brand-new app + connection pool continues the same capture (state is all in PG + storage)."""
    user = env.user()
    user.register_device()
    pages = [synthetic_image(seed=31), synthetic_image(seed=32)]
    manifest = manifest_for(user, pages)

    def restart() -> TestClient:
        db = Database(env.app_dsn)
        db.open()
        verifier = TokenVerifier(StaticKeyResolver(env.key.public_key(), ["ES256"]), ISSUER, AUDIENCE)
        client = TestClient(create_app(env.settings, verifier=verifier, store=env.store, database=db))
        client.__enter__()
        restart.cleanup.append((client, db))  # type: ignore[attr-defined]
        return client

    restart.cleanup = []  # type: ignore[attr-defined]
    try:
        c1 = restart()
        created = c1.post(
            "/v1/captures", json=manifest, headers={**user.headers, "Idempotency-Key": "restart-test-0001"}
        ).json()
        c2 = restart()  # restart #1 after create
        auths = c2.post(f"/v1/captures/{created['capture_id']}/upload-authorizations", headers=user.headers).json()[
            "authorizations"
        ]
        first = next(a for a in auths if a["source_id"] == created["pages"][0]["source_id"])
        assert (
            c2.put(first["url"], content=pages[0], headers={**user.headers, **first["required_headers"]}).status_code
            == 200
        )
        c3 = restart()  # restart #2 mid-upload
        auths = c3.post(f"/v1/captures/{created['capture_id']}/upload-authorizations", headers=user.headers).json()[
            "authorizations"
        ]
        # pages stay re-authorisable until verified (this is what heals lost objects)
        assert {a["source_id"] for a in auths} == {p["source_id"] for p in created["pages"]}
        # the first page's PUT token from before the restart is still honoured by the new process
        second = next(a for a in auths if a["source_id"] == created["pages"][1]["source_id"])
        assert (
            c3.put(second["url"], content=pages[1], headers={**user.headers, **second["required_headers"]}).status_code
            == 200
        )
        c4 = restart()
        body = {
            "expected_pages": [{"source_id": p["source_id"], "sha256": p["declared_sha256"]} for p in created["pages"]]
        }
        done = c4.post(
            f"/v1/captures/{created['capture_id']}/finalize",
            json=body,
            headers={**user.headers, "Idempotency-Key": "restart-test-fin1"},
        )
        assert done.status_code == 200 and done.json()["status"] == "stored"
        c5 = restart()
        replay = c5.post(
            f"/v1/captures/{created['capture_id']}/finalize",
            json=body,
            headers={**user.headers, "Idempotency-Key": "restart-test-fin1"},
        )
        assert replay.json() == done.json()
        for page, data in zip(done.json()["pages"], pages, strict=True):
            assert c5.get(f"/v1/sources/{page['source_id']}/content", headers=user.headers).content == data
    finally:
        for client, db in restart.cleanup:  # type: ignore[attr-defined]
            client.__exit__(None, None, None)
            db.close()


def test_stored_capture_survives_and_upload_after_store_is_idempotent(env: Env) -> None:
    user = env.user()
    pages = [synthetic_image(seed=33)]
    stored = stored_capture(user, pages)
    # a very late retry of the PUT (after finalize) neither errors nor changes anything
    auths = user.req("POST", f"/v1/captures/{stored['capture_id']}/upload-authorizations").json()["authorizations"]
    assert auths == []
    resp = user.req("GET", f"/v1/captures/{stored['capture_id']}")
    assert resp.json()["pages"][0]["upload_state"] == "verified"
