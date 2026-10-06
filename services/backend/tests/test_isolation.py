"""A12: two synthetic workspaces. Workspace A must learn nothing about, and change nothing in, B."""

from __future__ import annotations

import uuid

import psycopg

from conftest import Env, create_capture, finalize, manifest_for, stored_capture, synthetic_image, upload_all


def _two(env: Env):  # type: ignore[no-untyped-def]
    a, b = env.user(), env.user()
    secret = [synthetic_image(seed=42), synthetic_image(seed=43)]
    b_capture = stored_capture(b, secret)
    a_capture = stored_capture(a, [synthetic_image(seed=1)])
    return a, b, a_capture, b_capture, secret


def test_each_user_gets_their_own_workspace(env: Env) -> None:
    a, b = env.user(), env.user()
    wa = a.req("GET", "/v1/me").json()
    wb = b.req("GET", "/v1/me").json()
    assert wa["active_workspace_id"] != wb["active_workspace_id"]
    assert len(wa["workspaces"]) == 1 and wa["workspaces"][0]["role"] == "owner"
    assert a.req("GET", "/v1/me").json()["active_workspace_id"] == wa["active_workspace_id"]  # stable


def test_a_cannot_list_or_fetch_b(env: Env) -> None:
    a, b, a_cap, b_cap, _ = _two(env)
    listed = {c["capture_id"] for c in a.req("GET", "/v1/captures").json()["items"]}
    assert a_cap["capture_id"] in listed and b_cap["capture_id"] not in listed
    assert a.req("GET", f"/v1/captures/{b_cap['capture_id']}").status_code == 404


def test_a_cannot_fetch_b_source_bytes(env: Env) -> None:
    a, b, _, b_cap, secret = _two(env)
    for page, data in zip(b_cap["pages"], secret, strict=True):
        assert b.req("GET", f"/v1/sources/{page['source_id']}/content").content == data
        denied = a.req("GET", f"/v1/sources/{page['source_id']}/content")
        assert denied.status_code == 404 and data not in denied.content


def test_a_cannot_finalize_or_authorize_uploads_for_b(env: Env) -> None:
    a, b = env.user(), env.user()
    b.register_device()
    pages = [synthetic_image(seed=50)]
    b_cap = create_capture(b, manifest_for(b, pages)).json()
    a.register_device()
    body = {"expected_pages": [{"source_id": p["source_id"], "sha256": p["declared_sha256"]} for p in b_cap["pages"]]}
    assert (
        a.req(
            "POST",
            f"/v1/captures/{b_cap['capture_id']}/finalize",
            json=body,
            headers={"Idempotency-Key": "attacker-key-0001"},
        ).status_code
        == 404
    )
    assert a.req("POST", f"/v1/captures/{b_cap['capture_id']}/upload-authorizations").status_code == 404
    # B is unaffected and can still complete normally.
    upload_all(b, b_cap, pages)
    assert finalize(b, b_cap).status_code == 200


def test_b_upload_token_is_useless_to_a(env: Env) -> None:
    a, b = env.user(), env.user()
    b.register_device()
    a.register_device()
    data = synthetic_image(seed=51)
    b_cap = create_capture(b, manifest_for(b, [data])).json()
    auth = b.req("POST", f"/v1/captures/{b_cap['capture_id']}/upload-authorizations").json()["authorizations"][0]
    resp = a.req("PUT", auth["url"], content=data, headers=auth["required_headers"])
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "UPLOAD_AUTHORIZATION_INVALID"
    assert b.req("GET", f"/v1/captures/{b_cap['capture_id']}").json()["pages"][0]["upload_state"] == "pending"


def test_reusing_b_ids_reveals_nothing(env: Env) -> None:
    a, b, _, b_cap, _ = _two(env)
    ghost = uuid.uuid4()
    real = a.req("GET", f"/v1/captures/{b_cap['capture_id']}")
    fake = a.req("GET", f"/v1/captures/{ghost}")
    assert real.status_code == fake.status_code == 404
    strip = lambda r: {k: v for k, v in r.json()["error"].items() if k != "request_id"}  # noqa: E731
    assert strip(real) == strip(fake)
    # A can create a capture reusing B's client capture id and idempotency key without any collision signal.
    a.register_device()
    b_client_id = uuid.UUID(b_cap["client_capture_id"])
    manifest = manifest_for(a, [synthetic_image(seed=60)], client_capture_id=b_client_id)
    resp = create_capture(a, manifest, key=b_cap["client_capture_id"])
    assert resp.status_code == 201 and resp.json()["capture_id"] != b_cap["capture_id"]


def test_client_supplied_workspace_never_grants_access(env: Env) -> None:
    a, b, _, b_cap, _ = _two(env)
    b_workspace = b.req("GET", "/v1/me").json()["active_workspace_id"]
    for headers in ({"X-Workspace-Id": b_workspace}, {"X-Recall-Workspace": b_workspace}):
        assert a.req("GET", f"/v1/captures/{b_cap['capture_id']}", headers=headers).status_code == 404
        listed = a.req("GET", "/v1/captures", headers=headers, params={"workspace_id": b_workspace}).json()["items"]
        assert b_cap["capture_id"] not in {c["capture_id"] for c in listed}
    a.register_device()
    manifest = {**manifest_for(a, [synthetic_image(seed=61)]), "workspace_id": b_workspace}
    assert create_capture(a, manifest).status_code == 422  # schema forbids it


def test_a_cannot_register_a_device_into_b(env: Env) -> None:
    a, b = env.user(), env.user()
    assert b.register_device().status_code == 201
    a.device_id = b.device_id  # same device UUID, different workspace: independent, no leak
    assert a.register_device().status_code == 201


def test_database_rls_blocks_cross_workspace_reads_and_writes(env: Env) -> None:
    """Defence in depth: even raw SQL as the API role cannot cross workspaces."""
    a, b, a_cap, b_cap, _ = _two(env)
    a_ws = a.req("GET", "/v1/me").json()["active_workspace_id"]
    b_ws = b.req("GET", "/v1/me").json()["active_workspace_id"]
    with psycopg.connect(env.app_dsn) as conn:

        def as_user(user: object, ws: str) -> None:
            conn.rollback()
            conn.execute(
                "select set_config('app.user_id', %s, true), set_config('app.workspace_id', %s, true)",
                (str(user.id), ws),
            )  # type: ignore[attr-defined]

        # A, pointing the request at B's workspace: nothing visible (not a member).
        as_user(a, b_ws)
        for table in ("captures", "source_objects", "devices", "idempotency_records"):
            assert conn.execute(f"select count(*) from {table}").fetchone()[0] == 0, table  # type: ignore[index]  # noqa: S608
        assert (
            conn.execute("select count(*) from workspace_members where workspace_id = %s", (b_ws,)).fetchone()[0] == 0
        )  # type: ignore[index]
        # A in own workspace sees only own rows.
        as_user(a, a_ws)
        assert {str(r[0]) for r in conn.execute("select id from captures").fetchall()} == {a_cap["capture_id"]}
        # A cannot insert into B's workspace, nor change B's rows.
        as_user(a, b_ws)
        try:
            conn.execute(
                "insert into devices (workspace_id, id, user_id, platform) values (%s, %s, %s, 'ios')",
                (b_ws, uuid.uuid4(), a.id),
            )
            raise AssertionError("insert into foreign workspace should fail")
        except psycopg.errors.InsufficientPrivilege:
            conn.rollback()
        as_user(a, b_ws)
        assert conn.execute("update captures set version = 99 where id = %s", (b_cap["capture_id"],)).rowcount == 0
        # No context at all: nothing visible.
        conn.rollback()
        assert conn.execute("select count(*) from captures").fetchone()[0] == 0  # type: ignore[index]
        # No deletes, even in own workspace.
        as_user(a, a_ws)
        try:
            conn.execute("delete from captures where id = %s", (a_cap["capture_id"],))
            raise AssertionError("delete should be denied")
        except psycopg.errors.InsufficientPrivilege:
            conn.rollback()
