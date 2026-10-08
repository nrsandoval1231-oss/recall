"""Restore an encrypted inference DB dump only to an empty database, retaining recovery hold."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import urlopen

import psycopg
from backup import MAX_BACKUP_BYTES, MAX_MANIFEST_BYTES, TABLES, digest, pg_environment
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict


def pg_restore_command(restore: str, dump: Path, database: str) -> list[str]:
    return [restore, "--dbname", database, "--exit-on-error", "--single-transaction", str(dump)]


def pg_restore_failure_code(stderr: bytes) -> str:
    """Classify selected pg_restore failures without exposing command output."""
    diagnostic = stderr.decode("utf-8", errors="replace").lower()
    if "must specify" in diagnostic and "database" in diagnostic:
        return "PG_RESTORE_DATABASE_TARGET_NOT_SELECTED"
    if "single-transaction" in diagnostic and "database" in diagnostic:
        return "PG_RESTORE_DATABASE_TARGET_NOT_SELECTED"
    if "unsupported version" in diagnostic or "archive version" in diagnostic:
        return "PG_RESTORE_ARCHIVE_VERSION_UNSUPPORTED"
    if "unrecognized configuration parameter" in diagnostic:
        return "PG_RESTORE_UNSUPPORTED_PARAMETER"
    if "role" in diagnostic and "does not exist" in diagnostic:
        return "PG_RESTORE_ROLE_MISSING"
    if "permission denied" in diagnostic:
        return "PG_RESTORE_PERMISSION_DENIED"
    if "extension" in diagnostic and "already exists" in diagnostic:
        return "PG_RESTORE_EXTENSION_CONFLICT"
    if "connection to server" in diagnostic or "could not connect" in diagnostic:
        return "PG_RESTORE_CONNECTION_FAILED"
    return "PG_RESTORE_FAILED"


def set_hold(path: Path) -> None:
    current = json.loads(path.read_text(encoding="utf-8"))
    if current.get("record_type") != "recall.do-inference.recovery-clearance.v1":
        raise SystemExit("Recovery hold record is invalid.")
    current.update(
        hold=True,
        provider_usage_reconciled=False,
        pending_vault_operations_reconciled=False,
        previous_grants_revoked=False,
        fresh_pairing_required=True,
        cleared_by="",
        clearance_ref="",
        cleared_at="",
    )
    temporary = path.with_name(path.name + ".restore.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(current, stream, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    if os.name == "posix":
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)


def require_api_shutdown() -> None:
    """Require exact Compose API container stop plus loopback refusal before target SQL."""
    project = os.environ.get("RECALL_RESTORE_COMPOSE_PROJECT", "")
    container = os.environ.get("RECALL_RESTORE_API_CONTAINER_ID", "")
    docker = shutil.which("docker")
    if not project or not container or docker is None:
        raise SystemExit("Restore requires an exact Compose API container shutdown proof.")
    inspected = subprocess.run(  # noqa: S603 -- docker path resolved locally and fixed inspect argv
        [
            docker,
            "inspect",
            "--format",
            "{{.State.Running}} {{index .Config.Labels "
            '"com.docker.compose.project"}} {{index .Config.Labels '
            '"com.docker.compose.service"}}',
            container,
        ],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    if inspected.returncode or inspected.stdout.strip() != f"false {project} api":
        raise SystemExit("API container is not stopped for the exact Compose project.")
    try:
        endpoint = urlsplit(os.environ["RECALL_RESTORE_API_FENCE_URL"])
    except (KeyError, ValueError):
        raise SystemExit("Restore requires a verified private API shutdown endpoint.") from None
    if (
        endpoint.scheme != "http"
        or endpoint.hostname != "127.0.0.1"
        or endpoint.port != 8001
        or endpoint.path != "/healthz"
        or endpoint.query
        or endpoint.fragment
    ):
        raise SystemExit("Restore API shutdown endpoint is not the private loopback health URL.")
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            urlopen(endpoint.geturl(), timeout=1)  # noqa: S310 -- validated fixed loopback health URL
        except HTTPError:
            pass
        except URLError:
            return
        time.sleep(0.25)
    raise SystemExit("API remained reachable after recovery hold; restore refused before SQL.")


def main() -> int:
    encrypted_path = Path(os.environ["RECALL_RESTORE_ARCHIVE"])
    identity = Path(os.environ["RECALL_RESTORE_AGE_IDENTITY_FILE"])
    dsn = Path(os.environ["RECALL_RESTORE_DATABASE_URL_FILE"]).read_text(encoding="utf-8").strip()
    hold_path = Path(os.environ["RECALL_RESTORE_HOLD_PATH"])
    # Every later refusal leaves this durable, external hold in place.
    set_hold(hold_path)
    sidecar = Path(str(encrypted_path) + ".sha256").read_text(encoding="utf-8").split()
    if len(sidecar) != 2 or sidecar[1] != encrypted_path.name:
        raise SystemExit("Encrypted backup checksum record is invalid.")
    if encrypted_path.stat().st_size > MAX_BACKUP_BYTES:
        raise SystemExit("Encrypted backup exceeds the documented restore bound.")
    if digest(encrypted_path) != sidecar[0]:
        raise SystemExit("Encrypted backup checksum mismatch.")
    age, restore = shutil.which("age"), shutil.which("pg_restore")
    if age is None or restore is None:
        raise SystemExit("age and pg_restore are required.")
    require_api_shutdown()
    with psycopg.connect(dsn, autocommit=True) as conn:
        if conn.execute("select count(*) from pg_tables where schemaname='public'").fetchone()[0] != 0:
            raise SystemExit("Restore target must be an empty database.")

    with tempfile.TemporaryDirectory(prefix="recall-do-inference-restore-") as scratch_name:
        scratch = Path(scratch_name)
        os.chmod(scratch, 0o700)
        archive_path, dump = scratch / "backup.zip", scratch / "database.dump"
        decrypted = subprocess.run(  # noqa: S603 -- age binary resolved by shutil and fixed argv
            [
                age,
                "--decrypt",
                "--identity",
                str(identity),
                "--output",
                str(archive_path),
                str(encrypted_path),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=600,
            check=False,
        )
        if decrypted.returncode:
            raise SystemExit("Backup decryption failed; recovery hold remains active.")
        with zipfile.ZipFile(archive_path) as archive:
            entries = archive.infolist()
            if len(entries) != 2 or {entry.filename for entry in entries} != {
                "database.dump",
                "manifest.json",
            }:
                raise SystemExit("Backup inventory is not recognized.")
            if any(entry.file_size > MAX_BACKUP_BYTES for entry in entries):
                raise SystemExit("Backup member exceeds its restore bound.")
            manifest_info = archive.getinfo("manifest.json")
            if manifest_info.file_size > MAX_MANIFEST_BYTES:
                raise SystemExit("Backup manifest exceeds its restore bound.")
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("format") != "recall.do-inference.backup.v1":
                raise SystemExit("Backup format is not recognized.")
            with archive.open("database.dump") as source, dump.open("xb") as target:
                total = 0
                while chunk := source.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_BACKUP_BYTES:
                        raise SystemExit("Database dump exceeds its restore bound.")
                    target.write(chunk)
        if digest(dump) != manifest.get("database_sha256"):
            raise SystemExit("Decrypted database checksum mismatch.")
        expected_database = conninfo_to_dict(dsn).get("dbname")
        with psycopg.connect(dsn) as conn:
            actual_database = conn.execute("select current_database()").fetchone()[0]
        if not expected_database or actual_database != expected_database:
            raise SystemExit("Restore connection is not bound to its declared target database.")
        result = subprocess.run(  # noqa: S603 -- pg_restore resolved by shutil and fixed argv
            pg_restore_command(restore, dump, expected_database),
            env=pg_environment(dsn),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=600,
            check=False,
        )
        if result.returncode:
            code = pg_restore_failure_code(result.stderr)
            raise SystemExit(f"pg_restore failed ({code}); recovery hold remains active.")
        with psycopg.connect(dsn) as conn:
            versions = [row[0] for row in conn.execute("select version from schema_migrations order by version")]
            if versions != manifest.get("migration_versions"):
                raise SystemExit("Restored migration ledger does not match the backup manifest.")
            for table, expected in manifest.get("public_table_rows", {}).items():
                if table not in TABLES or not isinstance(expected, int) or expected < 0:
                    raise SystemExit("Backup table-count manifest is invalid.")
                if conn.execute("select to_regclass(%s)", (f"public.{table}",)).fetchone()[0] is None:
                    raise SystemExit("Restored database is missing an expected table.")
                actual = conn.execute(
                    sql.SQL("select count(*) from public.{}").format(sql.Identifier(table))
                ).fetchone()[0]
                if actual != expected:
                    raise SystemExit("Restored public-table row counts differ from the encrypted manifest.")
        env = os.environ.copy()
        env["RECALL_MIGRATION_DATABASE_URL"] = dsn
        env["RECALL_MIGRATIONS_DIR"] = str(Path(__file__).resolve().parents[3] / "services" / "backend" / "migrations")
        audit = subprocess.run(  # noqa: S603 -- fixed Python executable and local audited script
            [sys.executable, str(Path(__file__).with_name("audit-database.py"))],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=60,
            check=False,
        )
        if audit.returncode:
            raise SystemExit("Restored role, migration, ownership, or forced-RLS audit failed; hold remains active.")
    print("Database restored and verified. External recovery hold remains active; operator reconciliation is required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
