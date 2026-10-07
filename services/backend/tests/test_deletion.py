"""Deletion reaches canonical history, sync and byte storage; real PG, synthetic pages."""

import uuid

import psycopg
import pytest

from conftest import Env
from fake_provider import FakeProvider
from recall.domain import processing
from recall.domain.deletion import PurgeWorker
from recall.ingestion.worker import Worker
from test_recall import admin, capture_with, consent, drain

pytest_plugins = ("test_recall",)


def test_unprocessed_page_delete_retry_uses_only_surviving_original(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    capture = capture_with(ai, user, fake, ["Remove this page", "Keep this original"])
    source = capture["pages"][0]["source_id"]
    response = user.req(
        "DELETE",
        f"/v1/sources/{source}",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(capture["version"])},
    )
    assert response.status_code == 200, response.text
    # Fake interpretation sees exactly the remaining original, preserving its
    # accepted page ordinal rather than inventing a replacement source ID.
    fake.truth[capture["context_hint"]] = ["Keep this original"]
    retry = user.req(
        "POST", f"/v1/captures/{capture['capture_id']}/retry-processing", headers={"Idempotency-Key": str(uuid.uuid4())}
    )
    assert retry.status_code == 200, retry.text
    drain(worker)
    current = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()
    assert current["memory_id"] and len(current["pages"]) == 1
    assert current["pages"][0]["source_id"] == capture["pages"][1]["source_id"]
    memory = user.req("GET", f"/v1/memories/{current['memory_id']}").json()
    assert memory["interpretation"]["pages"][0]["transcription"] == "Keep this original"
    assert source not in str(memory)
    purge = PurgeWorker(ai.worker_dsn, ai.store)
    while purge.run_once() is not None:
        pass


def test_capture_delete_removes_canonical_derived_state_publishes_tombstones_and_purges_original(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user, other = ai.user(), ai.user()
    consent(user)
    capture = capture_with(ai, user, fake, ["Private pressure 42 psi"])
    foreign = capture_with(ai, other, fake, ["Other workspace pressure 77 psi"])
    drain(worker)
    current = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()
    snapshot = user.req("POST", "/v1/sync/snapshots", json={}).json()
    source = capture["pages"][0]["source_id"]
    key = admin(ai, "select storage_key from source_objects where id=%s", (source,))[0][0]
    assert ai.store.stat(key)
    operation = str(uuid.uuid4())
    path = f"/v1/captures/{capture['capture_id']}"
    assert user.req("DELETE", path, headers={"Idempotency-Key": operation, "If-Match": "1"}).status_code == 409
    assert (
        other.req(
            "DELETE", path, headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(current["version"])}
        ).status_code
        == 404
    )
    headers = {"Idempotency-Key": operation, "If-Match": str(current["version"])}
    deleted = user.req("DELETE", path, headers=headers)
    assert deleted.status_code == 200, deleted.text
    replay = user.req("DELETE", path, headers=headers)
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert user.req("GET", path).status_code == 404
    assert user.req("GET", f"/v1/sources/{source}/content").status_code == 404
    assert user.req("GET", f"/v1/memories/{current['memory_id']}").status_code == 404
    assert user.req("GET", "/v1/search", params={"q": "42"}).json()["results"] == []
    assert other.req("GET", f"/v1/captures/{foreign['capture_id']}").status_code == 200
    for table in ("memories", "memory_revisions", "search_chunks", "claims", "claim_revisions", "mentions", "actions"):
        field = "id" if table == "memories" else "memory_id"
        assert admin(ai, f"select count(*) from {table} where {field}=%s", (current["memory_id"],))[0][0] == 0
    feed = user.req("GET", "/v1/sync/changes", params={"cursor": snapshot["cursor"], "limit": 100}).json()
    tombstones = {(item["kind"], item["id"]) for item in feed["events"] if item["deleted"]}
    assert ("capture", capture["capture_id"]) in tombstones
    assert ("source", source) in tombstones and ("memory", current["memory_id"]) in tombstones
    purge = PurgeWorker(ai.worker_dsn, ai.store)
    assert purge.run_once()
    assert ai.store.stat(key) is None
    assert purge.run_once() is None


def test_purge_retry_does_not_restore_visibility_or_leak_error_content(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    capture = capture_with(ai, user, fake, ["Synthetic deletion retry"])
    response = user.req(
        "DELETE",
        f"/v1/captures/{capture['capture_id']}",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(capture["version"])},
    )
    assert response.status_code == 200, response.text

    class FailingStore:
        def delete(self, key: str) -> None:
            raise OSError("Private provider response must not persist")

    purge = PurgeWorker(ai.worker_dsn, FailingStore())  # type: ignore[arg-type]
    job = purge.run_once()
    assert job
    assert admin(ai, "select status,last_error from object_purge_jobs where id=%s", (job,)) == [("queued", "OSError")]
    assert purge.run_once() is None  # bounded retry backoff
    with psycopg.connect(ai.admin_dsn) as conn:
        conn.execute("update object_purge_jobs set not_before=now() where id=%s", (job,))
    assert PurgeWorker(ai.worker_dsn, ai.store).run_once() == job
    assert admin(ai, "select status from object_purge_jobs where id=%s", (job,)) == [("succeeded",)]


def test_delete_during_provider_io_never_recreates_memory_or_crashes_usage_recording(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    capture = capture_with(ai, user, fake, ["Private processing deletion race"])

    def delete_while_provider_returns(proposal: dict) -> None:
        current = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()
        response = user.req(
            "DELETE",
            f"/v1/captures/{capture['capture_id']}",
            headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(current["version"])},
        )
        assert response.status_code == 200, response.text

    fake.mutate = delete_while_provider_returns
    try:
        assert worker.run_once()
    finally:
        fake.mutate = None
    assert admin(ai, "select count(*) from memories where capture_id=%s", (capture["capture_id"],)) == [(0,)]
    assert admin(ai, "select count(*) from processing_jobs where capture_id=%s", (capture["capture_id"],)) == [(0,)]
    assert user.req("GET", f"/v1/captures/{capture['capture_id']}").status_code == 404


def test_memory_delete_suppresses_retry_and_future_processor_enqueue(
    ai: Env, fake: FakeProvider, worker: Worker, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = ai.user()
    consent(user)
    capture = capture_with(ai, user, fake, ["Synthetic memory that must stay deleted"])
    drain(worker)
    view = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()
    memory_id = view["memory_id"]

    deleted = user.req(
        "DELETE",
        f"/v1/memories/{memory_id}",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
    )
    assert deleted.status_code == 200, deleted.text
    assert admin(ai, "select count(*) from memory_suppressions where capture_id=%s", (capture["capture_id"],)) == [(1,)]

    retry = user.req(
        "POST",
        f"/v1/captures/{capture['capture_id']}/retry-processing",
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert retry.status_code == 409 and retry.json()["error"]["code"] == "NOT_RETRYABLE"

    # A deployment with a new processor version would normally create a new
    # unique job for this stored capture when AI is enabled again.
    monkeypatch.setattr(processing, "PROCESSOR_VERSION", "deletion-regression-next")
    consent(user, False)
    consent(user, True)
    assert admin(ai, "select count(*) from processing_jobs where capture_id=%s", (capture["capture_id"],)) == [(1,)]
    drain(worker)
    assert admin(ai, "select count(*) from memories where capture_id=%s", (capture["capture_id"],)) == [(0,)]


def test_partial_source_delete_returns_409_and_preserves_correction_history_and_bytes(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    capture = capture_with(ai, user, fake, ["Page one synthetic", "Page two original reading 42 psi"])
    drain(worker)
    capture_view = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()
    memory_id = capture_view["memory_id"]
    kept_source = capture["pages"][1]["source_id"]
    corrected = user.req(
        "POST",
        f"/v1/memories/{memory_id}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={"target": "transcription", "page_id": kept_source, "text": "Page two corrected reading 43 psi"},
    )
    assert corrected.status_code == 200, corrected.text
    before = admin(
        ai,
        "select (select count(*) from memory_revisions where memory_id=%s),"
        "(select count(*) from memory_overrides where memory_id=%s),"
        "(select version from captures where id=%s)",
        (memory_id, memory_id, capture["capture_id"]),
    )[0]
    sources = admin(
        ai,
        "select id::text,storage_key from source_objects where capture_id=%s order by ordinal",
        (capture["capture_id"],),
    )
    assert len(sources) == 2 and all(ai.store.stat(key) is not None for _, key in sources)

    rejected = user.req(
        "DELETE",
        f"/v1/sources/{capture['pages'][0]['source_id']}",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(before[2])},
    )
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "SOURCE_DELETE_REQUIRES_CAPTURE_DELETE"
    after = admin(
        ai,
        "select (select count(*) from memory_revisions where memory_id=%s),"
        "(select count(*) from memory_overrides where memory_id=%s),"
        "(select version from captures where id=%s)",
        (memory_id, memory_id, capture["capture_id"]),
    )[0]
    assert after == before
    assert admin(ai, "select count(*) from source_objects where capture_id=%s", (capture["capture_id"],)) == [(2,)]
    assert all(ai.store.stat(key) is not None for _, key in sources)


def test_memory_delete_retains_ai_entity_referenced_by_identity_history(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)

    def one_mention(data: dict) -> None:
        page = data["pages"][0]["page_id"]
        data["mentions"] = [
            {
                "local_id": "m1",
                "kind": "person",
                "raw_text": "Synthetic Alex",
                "evidence": [{"page_id": page, "quote": "Synthetic Alex"}],
            }
        ]

    fake.mutate = one_mention
    try:
        capture = capture_with(ai, user, fake, ["Synthetic Alex met the team"])
        drain(worker)
    finally:
        fake.mutate = None
    memory_id = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()["memory_id"]
    mention_id, ai_entity = admin(ai, "select id::text,entity_id::text from mentions where memory_id=%s", (memory_id,))[
        0
    ]
    created = user.req(
        "POST",
        "/v1/entities",
        headers={"Idempotency-Key": str(uuid.uuid4())},
        json={"kind": "person", "canonical_name": "User reviewed source identity"},
    )
    assert created.status_code == 201, created.text
    user_entity = created.json()["entity_id"]
    accepted = user.req(
        "POST",
        f"/v1/memories/{memory_id}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={
            "target": "mention_identity",
            "mention_id": mention_id,
            "entity_id": user_entity,
            "resolution": "accepted",
        },
    )
    assert accepted.status_code == 200, accepted.text
    merged = user.req(
        "POST",
        f"/v1/entities/{user_entity}/identity/{ai_entity}",
        headers={"Idempotency-Key": str(uuid.uuid4())},
        json={"source_version": 1, "target_version": 1, "mention_ids": []},
    )
    assert merged.status_code == 200, merged.text

    deleted = user.req(
        "DELETE",
        f"/v1/memories/{memory_id}",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "2"},
    )
    assert deleted.status_code == 200, deleted.text
    assert admin(ai, "select count(*) from identity_operations where target_entity_id=%s", (ai_entity,)) == [(1,)]
    assert admin(ai, "select created_by is null from entities where id=%s", (ai_entity,)) == [(True,)]


def test_workspace_erase_removes_canonical_state_and_replays_without_resurrection(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    capture = capture_with(ai, user, fake, ["Synthetic workspace erasure original"])
    drain(worker)
    view = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()
    source_id = capture["pages"][0]["source_id"]
    storage_key = admin(ai, "select storage_key from source_objects where id=%s", (source_id,))[0][0]
    removed_memory = user.req(
        "DELETE",
        f"/v1/memories/{view['memory_id']}",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
    )
    assert removed_memory.status_code == 200, removed_memory.text
    preview = user.req("GET", "/v1/workspace/deletion-preview").json()
    operation = str(uuid.uuid4())
    headers = {"Idempotency-Key": operation, "If-Match": str(preview["version"])}
    erased = user.req("DELETE", "/v1/workspace/data", headers=headers)
    assert erased.status_code == 200, erased.text
    replay = user.req("DELETE", "/v1/workspace/data", headers=headers)
    assert replay.status_code == 200 and replay.json()["replayed"] is True

    workspace = preview["workspace_id"]
    for table in (
        "captures",
        "source_objects",
        "processing_jobs",
        "memories",
        "memory_revisions",
        "search_chunks",
        "claims",
        "claim_revisions",
        "mentions",
        "actions",
        "memory_overrides",
        "memory_suppressions",
        "entities",
        "entity_aliases",
        "identity_operations",
        "devices",
        "ai_usage",
    ):
        assert admin(ai, f"select count(*) from {table} where workspace_id=%s", (workspace,)) == [(0,)], table
    assert admin(ai, "select enabled from ai_consents where workspace_id=%s", (workspace,)) == [(False,)]
    assert ai.store.stat(storage_key) is not None
    purge = PurgeWorker(ai.worker_dsn, ai.store)
    for _ in range(10):
        assert purge.run_once()
        if ai.store.stat(storage_key) is None:
            break
    assert ai.store.stat(storage_key) is None
