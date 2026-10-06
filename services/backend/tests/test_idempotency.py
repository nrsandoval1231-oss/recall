"""A03: retries, lost acknowledgements, and mismatched replays never duplicate records."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor

from conftest import Env, create_capture, finalize, manifest_for, synthetic_image, upload_all


def _count(env: Env, table: str) -> int:
    import psycopg

    with psycopg.connect(env.admin_dsn) as conn:
        return conn.execute(f"select count(*) from {table}").fetchone()[0]  # type: ignore[index,no-any-return]  # noqa: S608


def test_duplicate_create_returns_original_capture(env: Env) -> None:
    user = env.user()
    user.register_device()
    manifest = manifest_for(user, [synthetic_image(seed=1), synthetic_image(seed=2)])
    first = create_capture(user, manifest)
    again = create_capture(user, manifest)
    assert (first.status_code, again.status_code) == (201, 200)
    a, b = first.json(), again.json()
    assert a["capture_id"] == b["capture_id"]
    assert [p["source_id"] for p in a["pages"]] == [p["source_id"] for p in b["pages"]]
    assert len(user.req("GET", "/v1/captures").json()["items"]) == 1


def test_same_key_different_payload_conflicts(env: Env) -> None:
    user = env.user()
    user.register_device()
    manifest = manifest_for(user, [synthetic_image(seed=1)])
    key = "same-operation-id-123"
    assert create_capture(user, manifest, key).status_code == 201
    changed = {**manifest, "context_hint": "different"}
    resp = create_capture(user, changed, key)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert len(user.req("GET", "/v1/captures").json()["items"]) == 1


def test_same_capture_id_different_payload_conflicts_even_with_new_key(env: Env) -> None:
    user = env.user()
    user.register_device()
    manifest = manifest_for(user, [synthetic_image(seed=1)])
    assert create_capture(user, manifest, "key-number-one").status_code == 201
    resp = create_capture(user, {**manifest, "context_hint": "edited"}, "key-number-two")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_same_capture_id_same_payload_new_key_reuses_capture(env: Env) -> None:
    user = env.user()
    user.register_device()
    manifest = manifest_for(user, [synthetic_image(seed=1)])
    first = create_capture(user, manifest, "key-number-one").json()
    again = create_capture(user, manifest, "key-number-two")
    assert again.status_code == 200 and again.json()["capture_id"] == first["capture_id"]
    assert len(user.req("GET", "/v1/captures").json()["items"]) == 1


def test_page_array_order_is_not_semantic(env: Env) -> None:
    user = env.user()
    user.register_device()
    manifest = manifest_for(user, [synthetic_image(seed=1), synthetic_image(seed=2)])
    first = create_capture(user, manifest, "order-insensitive-key")
    shuffled = {**manifest, "pages": list(reversed(manifest["pages"]))}  # type: ignore[call-overload]
    assert create_capture(user, shuffled, "order-insensitive-key").status_code == 200
    assert first.status_code == 201


def test_idempotency_key_is_required_and_validated(env: Env) -> None:
    user = env.user()
    user.register_device()
    manifest = manifest_for(user, [synthetic_image()])
    assert user.req("POST", "/v1/captures", json=manifest).status_code == 422
    assert user.req("POST", "/v1/captures", json=manifest, headers={"Idempotency-Key": "short"}).status_code == 422


def test_lost_create_response_then_retry_after_upload(env: Env) -> None:
    """Server succeeded, client never saw the 201, uploaded later via a replayed create."""
    user = env.user()
    user.register_device()
    pages = [synthetic_image(seed=7)]
    manifest = manifest_for(user, pages)
    create_capture(user, manifest)  # response "lost"
    replay = create_capture(user, manifest).json()
    upload_all(user, replay, pages)
    assert finalize(user, replay).status_code == 200
    assert _count(env, "source_objects") >= 1


def test_retry_after_upload_reuploading_same_bytes_is_harmless(env: Env) -> None:
    user = env.user()
    user.register_device()
    pages = [synthetic_image(seed=8)]
    created = create_capture(user, manifest_for(user, pages)).json()
    upload_all(user, created, pages)
    objects_before = sum(1 for p in env.store_dir.rglob("*") if p.is_file())
    upload_all(user, created, pages)  # client retries the PUT after a lost 200
    assert sum(1 for p in env.store_dir.rglob("*") if p.is_file()) == objects_before
    assert finalize(user, created).status_code == 200


def test_finalize_replay_with_same_key_returns_same_stored_capture(env: Env) -> None:
    user = env.user()
    user.register_device()
    pages = [synthetic_image(seed=9)]
    created = create_capture(user, manifest_for(user, pages)).json()
    upload_all(user, created, pages)
    first = finalize(user, created, "finalize-key-0001").json()
    again = finalize(user, created, "finalize-key-0001")  # ack lost; client retries
    assert again.status_code == 200 and again.json() == first
    assert first["version"] == 2 and again.json()["version"] == 2  # not bumped twice


def test_finalize_after_finalize_with_new_key_is_a_replay_not_a_second_effect(env: Env) -> None:
    user = env.user()
    user.register_device()
    pages = [synthetic_image(seed=10)]
    created = create_capture(user, manifest_for(user, pages)).json()
    upload_all(user, created, pages)
    first = finalize(user, created, "finalize-key-aaaa").json()
    second = finalize(user, created, "finalize-key-bbbb")
    assert second.status_code == 200 and second.json()["stored_at"] == first["stored_at"]
    assert second.json()["version"] == first["version"]


def test_finalize_same_key_different_payload_conflicts(env: Env) -> None:
    user = env.user()
    user.register_device()
    pages = [synthetic_image(seed=11)]
    created = create_capture(user, manifest_for(user, pages)).json()
    upload_all(user, created, pages)
    assert finalize(user, created, "finalize-key-cccc").status_code == 200
    other = [synthetic_image(seed=12)]
    created2 = create_capture(user, manifest_for(user, other)).json()
    upload_all(user, created2, other)
    resp = finalize(user, created2, "finalize-key-cccc")  # same key, different capture
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_concurrent_identical_creates_produce_one_capture(env: Env) -> None:
    from recall.domain.captures import CaptureService

    user = env.user()
    user.register_device()
    manifest = manifest_for(user, [synthetic_image(seed=1), synthetic_image(seed=2)])
    service = CaptureService(env.db, env.store, env.settings)

    def go(_: int) -> tuple[str, bool]:
        view, created = service.create_capture(user.id, "concurrent-key-01", manifest)
        return view["capture_id"], created

    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(go, range(8)))
    assert len({cid for cid, _ in results}) == 1
    assert sum(1 for _, created in results if created) == 1
    import psycopg

    with psycopg.connect(env.admin_dsn) as conn:
        pages = conn.execute(
            "select count(*) from source_objects where capture_id = %s", (uuid.UUID(results[0][0]),)
        ).fetchone()[0]  # type: ignore[index]
    assert pages == 2


def test_concurrent_finalizes_store_once(env: Env) -> None:
    from recall.domain.captures import CaptureService

    user = env.user()
    user.register_device()
    pages = [synthetic_image(seed=3)]
    created = create_capture(user, manifest_for(user, pages)).json()
    upload_all(user, created, pages)
    service = CaptureService(env.db, env.store, env.settings)
    body = {"expected_pages": [{"source_id": p["source_id"], "sha256": p["declared_sha256"]} for p in created["pages"]]}

    def go(i: int) -> dict[str, object]:
        return service.finalize(user.id, uuid.UUID(created["capture_id"]), f"concurrent-fin-{i:03d}", body)

    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(go, range(6)))
    assert {r["status"] for r in results} == {"stored"} and {r["version"] for r in results} == {2}
    assert len({r["stored_at"] for r in results}) == 1
