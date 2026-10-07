"""Owner-operated consistent database + verified-original backup. No client credentials.

Run with RECALL_BACKUP_DATABASE_URL (a dedicated privileged operator connection)
and the normal storage configuration. Restore only into an empty database/store.
Archives contain private plaintext; keep them on an owner-controlled encrypted disk.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import psycopg
from psycopg.conninfo import conninfo_to_dict

from ..storage import ObjectStore, hash_stream

MAX_ARCHIVE_BYTES = 10 * 1024**3
MAX_MANIFEST_BYTES = 8 * 1024**2
MAX_ORIGINAL_BYTES = 100 * 1024**2
CHUNK = 1024 * 1024


@contextmanager
def _locked_database(dsn: str) -> Iterator[psycopg.Connection[tuple[Any, ...]]]:
    with psycopg.connect(dsn, autocommit=True) as conn:
        # Acquire before establishing the snapshot. API, worker, and byte
        # purge take the shared form; this is an explicit maintenance window.
        conn.execute("select pg_advisory_lock(7402006)")
        yield conn


def _hash_file(path: Path) -> str:
    with path.open("rb") as handle:
        return hash_stream(iter(lambda: handle.read(CHUNK), b""))[0]


def _extract(archive: zipfile.ZipFile, info: zipfile.ZipInfo, target: Path, total: list[int]) -> None:
    if info.file_size > MAX_ORIGINAL_BYTES and info.filename.startswith("originals/"):
        raise ValueError("Original exceeds restore bound.")
    with archive.open(info) as source, target.open("xb") as output:
        while chunk := source.read(CHUNK):
            total[0] += len(chunk)
            if total[0] > MAX_ARCHIVE_BYTES:
                raise ValueError("Backup exceeds restore bound.")
            output.write(chunk)


def _pg(tool: str, dsn: str, args: list[str]) -> None:
    binary = shutil.which(tool)
    if binary is None:
        raise RuntimeError(f"Install PostgreSQL client tools: {tool} is required.")
    env = os.environ.copy()
    fields = conninfo_to_dict(dsn)
    for name, variable in (
        ("host", "PGHOST"),
        ("port", "PGPORT"),
        ("user", "PGUSER"),
        ("password", "PGPASSWORD"),
        ("dbname", "PGDATABASE"),
        ("sslmode", "PGSSLMODE"),
    ):
        if name in fields:
            env[variable] = str(fields[name])
    # Credentials never appear in command arguments or captured output.
    result = subprocess.run(  # noqa: S603 - fixed PostgreSQL binary, no shell
        [binary, *args], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=600, check=False
    )
    if result.returncode:
        raise RuntimeError(f"{tool} failed; inspect operator PostgreSQL logs (exit {result.returncode}).")


def backup(dsn: str, store: ObjectStore, destination: Path) -> dict[str, Any]:
    if destination.exists():
        raise ValueError("Backup destination already exists.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="recall-backup-") as scratch:
        root = Path(scratch)
        originals: list[dict[str, Any]] = []
        with _locked_database(dsn) as conn, conn.transaction():
            conn.execute("set transaction isolation level repeatable read")
            # Same locks as API/worker mutations; keep them until all bytes are copied.
            workspaces = conn.execute("select id from workspaces order by id").fetchall()
            for (workspace,) in workspaces:
                conn.execute("select pg_advisory_xact_lock(hashtextextended(%s,0))", (f"sync:{workspace}",))
            snapshot = conn.execute("select pg_export_snapshot()").fetchone()
            assert snapshot is not None
            captured_at = conn.execute("select current_timestamp").fetchone()
            assert captured_at is not None
            snapshot_metadata = {
                "captured_at": str(captured_at[0]),
                "database_snapshot": snapshot[0],
                "schema_versions": [
                    row[0] for row in conn.execute("select version from schema_migrations order by version")
                ],
                "workspace_sync_clocks": {
                    str(row[0]): row[1] for row in conn.execute("select id,sync_clock from workspaces order by id")
                },
            }
            dump = root / "database.dump"
            _pg("pg_dump", dsn, ["--format=custom", f"--snapshot={snapshot[0]}", f"--file={dump}"])
            total_bytes = dump.stat().st_size
            if total_bytes > MAX_ARCHIVE_BYTES:
                raise ValueError("Database dump exceeds backup bound.")
            for source_id, key, expected in conn.execute(
                "select id, storage_key, server_sha256 from source_objects where verified_at is not null order by id"
            ):
                target = root / "originals" / str(source_id)
                target.parent.mkdir(exist_ok=True)
                digest = hashlib.sha256()
                size = 0
                with target.open("wb") as handle:
                    for chunk in store.iter_bytes(key):
                        size += len(chunk)
                        total_bytes += len(chunk)
                        if size > MAX_ORIGINAL_BYTES:
                            raise ValueError("Original exceeds backup bound.")
                        if total_bytes > MAX_ARCHIVE_BYTES:
                            raise ValueError("Backup exceeds cumulative byte bound.")
                        digest.update(chunk)
                        handle.write(chunk)
                if digest.hexdigest() != expected:
                    raise ValueError("Stored original does not match its verified hash.")
                originals.append(
                    {
                        "source_id": str(source_id),
                        "storage_key": key,
                        "sha256": expected,
                        "size": size,
                        "path": f"originals/{source_id}",
                    }
                )
        manifest = {
            "format": "recall.backup.v1",
            "database_sha256": _hash_file(dump),
            "snapshot": snapshot_metadata,
            "originals": originals,
        }
        (root / "manifest.json").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
        if (root / "manifest.json").stat().st_size > MAX_MANIFEST_BYTES:
            raise ValueError("Manifest exceeds backup bound.")
        if total_bytes + (root / "manifest.json").stat().st_size > MAX_ARCHIVE_BYTES:
            raise ValueError("Backup exceeds cumulative byte bound.")
        # Exclusive publication, so another operator's backup cannot be overwritten.
        with destination.open("xb") as output:
            try:
                with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                    for path in sorted(root.rglob("*")):
                        if path.is_file():
                            archive.write(path, path.relative_to(root).as_posix())
            except BaseException:
                output.close()
                destination.unlink(missing_ok=True)
                raise
    return manifest


def restore(dsn: str, store: ObjectStore, archive_path: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="recall-restore-") as scratch:
        root = Path(scratch)
        with zipfile.ZipFile(archive_path) as archive:
            entries = archive.infolist()
            if any(item.file_size > MAX_ARCHIVE_BYTES for item in entries):
                raise ValueError("Backup exceeds restore bound.")
            names = [item.filename for item in entries]
            if len(names) != len(set(names)) or "manifest.json" not in names or "database.dump" not in names:
                raise ValueError("Invalid backup inventory.")
            manifest_info = archive.getinfo("manifest.json")
            if manifest_info.file_size > MAX_MANIFEST_BYTES:
                raise ValueError("Manifest exceeds restore bound.")
            manifest: dict[str, Any] = json.loads(archive.open(manifest_info).read(MAX_MANIFEST_BYTES + 1))
            if manifest.get("format") != "recall.backup.v1":
                raise ValueError("Unsupported backup format.")
            allowed = {"manifest.json", "database.dump"}
            allowed.update(item["path"] for item in manifest["originals"])
            if set(names) != allowed:
                raise ValueError("Unexpected backup files.")
            total = [0]
            for name in names:
                target = (root / name).resolve()
                if root.resolve() not in target.parents or "\\" in name:
                    raise ValueError("Unsafe backup path.")
                target.parent.mkdir(parents=True, exist_ok=True)
                _extract(archive, archive.getinfo(name), target, total)
        dump = root / "database.dump"
        if _hash_file(dump) != manifest["database_sha256"]:
            raise ValueError("Database backup hash mismatch.")
        for item in manifest["originals"]:
            path = root / item["path"]
            with path.open("rb") as handle:
                digest, size = hash_stream(iter(lambda: handle.read(1024 * 1024), b""))
            if (digest, size) != (item["sha256"], item["size"]):
                raise ValueError("Original backup hash mismatch.")
            if store.stat(item["storage_key"]) is not None:
                raise ValueError("Restore requires an empty destination object store.")
        with psycopg.connect(dsn) as conn:
            if conn.execute("select count(*) from pg_tables where schemaname='public'").fetchone() != (0,):
                raise ValueError("Restore requires an empty destination database.")
        # Originals first; failed DB restoration can be retried in fresh destinations.
        for item in manifest["originals"]:
            store.put_if_absent(
                item["storage_key"], root / item["path"], content_type="application/octet-stream", sha256=item["sha256"]
            )
        database_name = str(conninfo_to_dict(dsn)["dbname"])
        _pg("pg_restore", dsn, ["--exit-on-error", "--single-transaction", "--dbname", database_name, str(dump)])
        with psycopg.connect(dsn) as conn:
            actual = conn.execute(
                "select id::text,storage_key,server_sha256 from source_objects "
                "where verified_at is not null order by id"
            ).fetchall()
            expected = [(item["source_id"], item["storage_key"], item["sha256"]) for item in manifest["originals"]]
            if actual != expected:
                raise RuntimeError("Restored source mapping failed verification.")
        return manifest


def main() -> None:
    from ..config import get_settings
    from ..storage.factory import build_object_store

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["backup", "restore"])
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    dsn = os.environ["RECALL_BACKUP_DATABASE_URL"]
    settings = get_settings()
    store = build_object_store(settings)
    result = backup(dsn, store, args.archive) if args.operation == "backup" else restore(dsn, store, args.archive)
    print(json.dumps({"format": result["format"], "originals": len(result["originals"])}))


if __name__ == "__main__":
    main()
