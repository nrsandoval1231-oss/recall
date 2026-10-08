"""Create a consistent PostgreSQL dump and encrypt it with an operator-owned age recipient."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

TABLES = (
    "schema_migrations",
    "workspaces",
    "workspace_members",
    "devices",
    "captures",
    "source_objects",
    "idempotency_records",
    "ai_consents",
    "processing_jobs",
    "memories",
    "memory_revisions",
    "search_chunks",
    "ai_usage",
    "entities",
    "identity_operations",
    "entity_aliases",
    "mentions",
    "entity_links",
    "claims",
    "claim_revisions",
    "actions",
    "memory_overrides",
    "change_events",
    "retrieval_index_config",
    "embedding_reservations",
    "object_purge_jobs",
    "memory_suppressions",
    "local_reading_receipts",
    "device_pair_invitations",
    "device_pair_grants",
    "search_chunk_embeddings",
)
MAX_BACKUP_BYTES = 10 * 1024**3
MAX_MANIFEST_BYTES = 64 * 1024


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def pg_environment(dsn: str) -> dict[str, str]:
    env = os.environ.copy()
    fields = conninfo_to_dict(dsn)
    for key, name in (
        ("host", "PGHOST"),
        ("port", "PGPORT"),
        ("user", "PGUSER"),
        ("password", "PGPASSWORD"),
        ("dbname", "PGDATABASE"),
        ("sslmode", "PGSSLMODE"),
    ):
        if key in fields:
            env[name] = str(fields[key])
    return env


def main() -> int:
    destination = Path(os.environ["RECALL_BACKUP_DESTINATION"])
    dsn = Path(os.environ["RECALL_BACKUP_DATABASE_URL_FILE"]).read_text(encoding="utf-8").strip()
    recipient = os.environ["RECALL_BACKUP_AGE_RECIPIENT"].strip()
    if destination.exists() or Path(str(destination) + ".sha256").exists():
        raise SystemExit("Backup destination already exists.")
    if not recipient.startswith("age1") or any(ch.isspace() for ch in recipient):
        raise SystemExit("Supply the owner-provided age recipient in RECALL_BACKUP_AGE_RECIPIENT.")
    pg_dump, age = shutil.which("pg_dump"), shutil.which("age")
    if pg_dump is None or age is None:
        raise SystemExit("pg_dump and age are required.")
    destination.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="recall-do-inference-backup-") as scratch_name:
        scratch = Path(scratch_name)
        os.chmod(scratch, 0o700)
        dump = scratch / "database.dump"
        archive_path = scratch / "backup.zip"
        with psycopg.connect(dsn, autocommit=True) as conn:
            conn.execute("select pg_advisory_lock(7402006)")
            try:
                with conn.transaction():
                    conn.execute("set transaction isolation level repeatable read")
                    snapshot = conn.execute("select pg_export_snapshot()").fetchone()[0]
                    captured = conn.execute("select current_timestamp").fetchone()[0]
                    migrations = [
                        row[0] for row in conn.execute("select version from schema_migrations order by version")
                    ]
                    present = {
                        row[0] for row in conn.execute("select tablename from pg_tables where schemaname='public'")
                    }
                    if present - set(TABLES) or "schema_migrations" not in present:
                        raise SystemExit("Public table inventory is not supported by this backup tool.")
                    counts = {
                        table: conn.execute(
                            sql.SQL("select count(*) from public.{}").format(sql.Identifier(table))
                        ).fetchone()[0]
                        for table in TABLES
                        if table in present
                    }
                    result = subprocess.run(  # noqa: S603 -- binaries resolved by shutil and fixed argv
                        [
                            pg_dump,
                            "--format=custom",
                            f"--snapshot={snapshot}",
                            f"--file={dump}",
                        ],
                        env=pg_environment(dsn),
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.PIPE,
                        timeout=600,
                        check=False,
                    )
                    if result.returncode:
                        raise SystemExit(f"pg_dump failed (exit {result.returncode}); inspect operator logs.")
                    if dump.stat().st_size > MAX_BACKUP_BYTES:
                        raise SystemExit("Database dump exceeds the documented 10 GiB restore bound.")
                    manifest = {
                        "format": "recall.do-inference.backup.v1",
                        "captured_at": str(captured),
                        "database_sha256": digest(dump),
                        "migration_versions": migrations,
                        "public_table_rows": counts,
                    }
                    manifest_path = scratch / "manifest.json"
                    manifest_path.write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
                    if manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
                        raise SystemExit("Backup manifest exceeds its size bound.")
            finally:
                conn.execute("select pg_advisory_unlock(7402006)")

        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(dump, "database.dump")
            archive.write(scratch / "manifest.json", "manifest.json")
        if archive_path.stat().st_size > MAX_BACKUP_BYTES:
            raise SystemExit("Encrypted backup input exceeds the documented 10 GiB bound.")
        staged = scratch / "encrypted.age"
        encrypted = subprocess.run(  # noqa: S603 -- age binary resolved by shutil and fixed argv
            [
                age,
                "--encrypt",
                "--recipient",
                recipient,
                "--output",
                str(staged),
                str(archive_path),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=600,
            check=False,
        )
        if encrypted.returncode:
            raise SystemExit("age encryption failed; inspect the local operator environment.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation prevents replacing an earlier recovery point.
        with destination.open("xb") as output, staged.open("rb") as source:
            shutil.copyfileobj(source, output)
        sidecar = Path(str(destination) + ".sha256")
        with sidecar.open("x", encoding="utf-8") as output:
            output.write(f"{digest(destination)}  {destination.name}\n")
    print("Encrypted inference database backup created; plaintext temporary files were removed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
