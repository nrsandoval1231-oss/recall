"""Private object storage: write-once keys, no traversal, Supabase adapter request shape."""

from __future__ import annotations

import hashlib
import threading
from pathlib import Path

import httpx
import pytest

from recall.storage import ObjectNotFound, StoredObjectConflict, hash_stream
from recall.storage.local import LocalObjectStore
from recall.storage.supabase import SupabaseObjectStore


def _file(tmp_path: Path, name: str, data: bytes) -> tuple[Path, str]:
    path = tmp_path / name
    path.write_bytes(data)
    return path, hashlib.sha256(data).hexdigest()


def test_local_store_is_write_once(tmp_path: Path) -> None:
    store = LocalObjectStore(tmp_path / "root")
    a, a_sha = _file(tmp_path, "a", b"original-bytes")
    b, b_sha = _file(tmp_path, "b", b"different-bytes")
    assert store.put_if_absent("ws/1/original", a, content_type="image/jpeg", sha256=a_sha) is True
    assert store.put_if_absent("ws/1/original", a, content_type="image/jpeg", sha256=a_sha) is False
    with pytest.raises(StoredObjectConflict):
        store.put_if_absent("ws/1/original", b, content_type="image/jpeg", sha256=b_sha)
    assert hash_stream(store.iter_bytes("ws/1/original")) == (a_sha, len(b"original-bytes"))
    assert not list((tmp_path / "root").rglob(".incoming-*"))
    assert store.stat("ws/1/original") is not None and store.stat("missing") is None
    with pytest.raises(ObjectNotFound):
        list(store.iter_bytes("missing"))


@pytest.mark.parametrize("key", ["../escape", "/abs/path", "a/../../b", "a\\b", "nul\x00byte"])
def test_local_store_rejects_traversal_keys(tmp_path: Path, key: str) -> None:
    store = LocalObjectStore(tmp_path / "root")
    src, sha = _file(tmp_path, "s", b"x")
    with pytest.raises(ValueError):
        store.put_if_absent(key, src, content_type="image/jpeg", sha256=sha)


def test_concurrent_writers_of_the_same_key_store_exactly_one_object(tmp_path: Path) -> None:
    store = LocalObjectStore(tmp_path / "root")
    src, sha = _file(tmp_path, "s", b"same-bytes" * 1000)
    results: list[bool] = []
    threads = [
        threading.Thread(target=lambda: results.append(store.put_if_absent("k/o", src, content_type="x", sha256=sha)))
        for _ in range(8)
    ]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count(True) == 1 and results.count(False) == 7


def test_supabase_adapter_uses_private_authenticated_endpoints_only(tmp_path: Path) -> None:
    """Contract-level check against a stub transport. NOT live Supabase verification."""
    seen: list[httpx.Request] = []
    blobs: dict[str, bytes] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        if request.method == "POST":
            key = path.removeprefix("/storage/v1/object/")
            if key in blobs:
                return httpx.Response(409, json={"error": "Duplicate", "message": "The resource already exists"})
            blobs[key] = request.read()
            return httpx.Response(200, json={"Key": key})
        key = path.removeprefix("/storage/v1/object/authenticated/")
        if key not in blobs:
            return httpx.Response(404, json={"error": "not_found"})
        return httpx.Response(200, content=blobs[key], headers={"content-length": str(len(blobs[key]))})

    store = SupabaseObjectStore(
        "https://proj.supabase.example",
        "service-key-for-test",
        "private-bucket",
        transport=httpx.MockTransport(handler),
    )
    a, a_sha = _file(tmp_path, "a", b"abc")
    b, b_sha = _file(tmp_path, "b", b"xyz")
    assert store.put_if_absent("ws/1/o", a, content_type="image/jpeg", sha256=a_sha) is True
    assert store.put_if_absent("ws/1/o", a, content_type="image/jpeg", sha256=a_sha) is False
    with pytest.raises(StoredObjectConflict):
        store.put_if_absent("ws/1/o", b, content_type="image/jpeg", sha256=b_sha)
    assert b"".join(store.iter_bytes("ws/1/o")) == b"abc"
    assert store.stat("ws/1/o").size == 3  # type: ignore[union-attr]
    assert store.stat("nope") is None
    with pytest.raises(ObjectNotFound):
        list(store.iter_bytes("nope"))
    posts = [r for r in seen if r.method == "POST"]
    assert all(r.headers["x-upsert"] == "false" for r in posts)  # never overwrite
    assert all(r.headers["authorization"] == "Bearer service-key-for-test" for r in seen)
    assert not any("/public/" in r.url.path or "/sign/" in r.url.path for r in seen)  # no bearer URLs
    with pytest.raises(ValueError):
        store._object_path("../x")
