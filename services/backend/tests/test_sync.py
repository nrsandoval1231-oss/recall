"""Real PostgreSQL sync isolation, bootstrap, replay, and cursor ordering."""

import uuid

import psycopg

from conftest import Env, stored_capture, synthetic_image
from fake_provider import FakeProvider
from recall.ingestion.worker import Worker
from test_recall import capture_with, consent, drain

pytest_plugins = ("test_recall",)


def test_outbox_replay_conflict_and_cross_workspace_mutation_are_explicit(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user, foreign = ai.user(), ai.user()
    consent(user)
    capture = capture_with(ai, user, fake, ["Synthetic offline correction"])
    drain(worker)
    memory = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()["memory_id"]
    operation = {
        "operation_id": str(uuid.uuid4()),
        "kind": "memory.correction",
        "target_id": memory,
        "expected_version": 1,
        "payload": {"target": "summary", "text": "Human corrected memory."},
    }

    def push(actor, item):
        return actor.req("POST", "/v1/sync/push", json={"operations": [item]}).json()["results"][0]

    assert push(user, operation)["status"] == "applied"
    assert push(user, operation)["status"] == "already_applied"
    stale = {**operation, "operation_id": str(uuid.uuid4()), "payload": {"target": "summary", "text": "Stale edit"}}
    assert push(user, stale)["status"] == "conflict"
    foreign.req("GET", "/v1/me")
    assert push(foreign, stale)["status"] == "rejected"
    current = user.req("GET", f"/v1/memories/{memory}").json()
    assert current["revision"] == 2 and current["summary"] == "Human corrected memory."


def test_snapshot_feed_contains_verified_capture_and_no_private_storage_path(env: Env) -> None:
    user = env.user()
    user.req("GET", "/v1/me")
    snapshot = user.req("POST", "/v1/sync/snapshots", json={})
    assert snapshot.status_code == 200, snapshot.text
    initial = snapshot.json()
    assert initial["records"] == []
    capture = stored_capture(user, [synthetic_image(seed=2)])
    cursor = initial["cursor"]
    events = []
    while True:
        page = user.req("GET", "/v1/sync/changes", params={"cursor": cursor, "limit": 2})
        assert page.status_code == 200, page.text
        result = page.json()
        events.extend(result["events"])
        cursor = result["next_cursor"]
        if not result["has_more"]:
            break
    sequences = [e["sequence"] for e in events]
    assert sequences == sorted(set(sequences))
    captures = [e for e in events if e["kind"] == "capture"]
    assert captures and all(e["data"]["capture_id"] == capture["capture_id"] for e in captures)
    assert all(e["data"]["status"] == "stored" for e in captures)  # current projection, never stale event content
    sources = [e for e in events if e["kind"] == "source"]
    assert sources and all("storage_key" not in e["data"] for e in sources)
    replay = user.req("GET", "/v1/sync/changes", params={"cursor": initial["cursor"], "limit": 2}).json()
    assert replay["events"] == events[:2]
    assert user.req("GET", "/v1/sync/changes", params={"cursor": cursor}).json()["events"] == []


def test_sync_cursor_is_workspace_bound_and_revocation_prevents_snapshot(env: Env) -> None:
    a, b = env.user(), env.user()
    for user in (a, b):
        user.req("GET", "/v1/me")
    snap = a.req("POST", "/v1/sync/snapshots", json={}).json()
    assert b.req("GET", "/v1/sync/changes", params={"cursor": snap["cursor"]}).status_code == 422
    assert a.req("GET", "/v1/sync/changes", params={"cursor": snap["cursor"] + "x"}).status_code == 422
    assert a.req("GET", "/v1/sync/changes").status_code == 410
    with psycopg.connect(env.admin_dsn, autocommit=True) as conn:
        conn.execute("delete from workspace_members where user_id=%s", (a.id,))
    assert a.req("POST", "/v1/sync/snapshots", json={}).status_code == 403


def test_expired_cursor_requires_snapshot_and_push_rejects_unknown_mutations(env: Env) -> None:
    user = env.user()
    user.req("GET", "/v1/me")
    initial = user.req("POST", "/v1/sync/snapshots", json={}).json()
    stored_capture(user, [synthetic_image(seed=3)])
    with psycopg.connect(env.admin_dsn, autocommit=True) as conn:
        conn.execute("update workspaces set sync_floor=sync_clock where id=%s", (initial["workspace_id"],))
    assert user.req("GET", "/v1/sync/changes", params={"cursor": initial["cursor"]}).status_code == 410
    result = user.req(
        "POST",
        "/v1/sync/push",
        json={
            "operations": [
                {
                    "operation_id": str(uuid.uuid4()),
                    "kind": "sql.execute",
                    "target_id": str(uuid.uuid4()),
                    "expected_version": 1,
                    "payload": {},
                }
            ]
        },
    ).json()
    assert result["results"][0]["status"] == "rejected"
