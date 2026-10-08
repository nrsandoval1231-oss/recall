"""Real PostgreSQL + original-byte restoration; synthetic private-safe material."""

import json
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psycopg
import pytest

from conftest import Env, PgCluster, make_database
from fake_provider import FakeProvider
from recall.db.backup import backup, restore
from recall.ingestion.worker import Worker
from recall.storage.local import LocalObjectStore
from test_recall import capture_with, consent, drain

pytest_plugins = ("test_recall",)


def test_restore_preserves_sources_history_graph_corrections_and_sync(
    ai: Env, fake: FakeProvider, worker: Worker, pg_cluster: PgCluster, tmp_path: Path
) -> None:
    user = ai.user()
    capture = capture_with(ai, user, fake, ["Sarah recorded the pump at 42 psi."])
    consent(user)
    drain(worker)
    memory = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()["memory_id"]
    assert memory
    changed = user.req(
        "POST",
        f"/v1/memories/{memory}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={"target": "summary", "text": "Pump pressure: 42 psi, recorded by Sarah."},
    )
    assert changed.status_code == 200, changed.text
    tables = [
        "captures",
        "source_objects",
        "memories",
        "memory_revisions",
        "entities",
        "mentions",
        "claims",
        "claim_revisions",
        "entity_links",
        "memory_overrides",
        "change_events",
        "workspaces",
    ]
    with psycopg.connect(ai.admin_dsn) as conn:
        before = {
            table: conn.execute(f"select to_jsonb(t)::text from {table} t order by to_jsonb(t)::text").fetchall()
            for table in tables
        }
    archive = tmp_path / "private-backup.zip"
    manifest = backup(ai.admin_dsn, ai.store, archive)
    assert manifest["snapshot"]["schema_versions"][-1] == "0009_device_pairing.sql"
    assert manifest["snapshot"]["workspace_sync_clocks"]
    owner, _ = make_database(pg_cluster, apply_migrations=False)
    restored_store = LocalObjectStore(tmp_path / "restored-objects")
    admin = owner.replace("recall_owner@", "postgres@")
    assert restore(admin, restored_store, archive) == manifest
    with psycopg.connect(admin) as conn:
        after = {
            table: conn.execute(f"select to_jsonb(t)::text from {table} t order by to_jsonb(t)::text").fetchall()
            for table in tables
        }
    assert after == before
    for item in manifest["originals"]:
        assert b"".join(restored_store.iter_bytes(item["storage_key"])) == b"".join(
            ai.store.iter_bytes(item["storage_key"])
        )
    with pytest.raises(ValueError, match="already exists"):
        backup(ai.admin_dsn, ai.store, archive)
    with pytest.raises(ValueError, match="empty destination"):
        restore(admin, restored_store, archive)


def test_restore_rejects_traversal_before_any_database_or_storage_mutation(tmp_path: Path) -> None:
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as file:
        file.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format": "recall.backup.v1",
                    "originals": [{"path": "../outside", "storage_key": "escape", "sha256": "a" * 64, "size": 1}],
                }
            ),
        )
        file.writestr("database.dump", b"bad")
        file.writestr("../outside", b"x")
    with pytest.raises(ValueError, match="Unsafe backup path"):
        restore("unused", LocalObjectStore(tmp_path / "objects"), archive)
    assert not (tmp_path / "outside").exists()


def test_backup_freezes_deletion_until_originals_and_snapshot_are_copied(
    ai: Env, fake: FakeProvider, tmp_path: Path
) -> None:
    user = ai.user()
    capture = capture_with(ai, user, fake, ["Private-safe consistent backup"])
    source = capture["pages"][0]["source_id"]
    with ThreadPoolExecutor(max_workers=1) as executor:
        deletion = []

        class ConcurrentStore:
            def iter_bytes(self, key):
                future = executor.submit(
                    user.req,
                    "DELETE",
                    f"/v1/captures/{capture['capture_id']}",
                    headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(capture["version"])},
                )
                deletion.append(future)
                # A database command that takes the shared gate cannot run
                # until this backup's exclusive maintenance window ends.
                with psycopg.connect(ai.admin_dsn, autocommit=True) as contender:
                    contender.execute("set lock_timeout='100ms'")
                    with pytest.raises(psycopg.errors.LockNotAvailable):
                        contender.execute("select pg_advisory_xact_lock_shared(7402006)")
                yield from ai.store.iter_bytes(key)

        archive = tmp_path / "consistent.zip"
        manifest = backup(ai.admin_dsn, ConcurrentStore(), archive)  # type: ignore[arg-type]
        assert deletion[0].result(timeout=10).status_code == 200
    assert source in {item["source_id"] for item in manifest["originals"]}
    with zipfile.ZipFile(archive) as contents:
        assert contents.read(f"originals/{source}")
    assert user.req("GET", f"/v1/captures/{capture['capture_id']}").status_code == 404
