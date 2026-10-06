"""Ordered, checksummed SQL migrations. Run as the database OWNER role.

python -m recall.db.migrate            # apply pending migrations
python -m recall.db.migrate --check    # fail if anything is pending or an applied file changed
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

import psycopg

DEFAULT_DIR = Path(__file__).resolve().parents[3] / "migrations"
LOCK_ID = 7_402_001


class MigrationError(Exception):
    pass


def _files(directory: Path) -> list[Path]:
    return sorted(p for p in directory.glob("*.sql") if p.is_file())


def _checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def migrate(dsn: str, directory: Path = DEFAULT_DIR, *, check_only: bool = False) -> list[str]:
    applied_now: list[str] = []
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("select pg_advisory_lock(%s)", (LOCK_ID,))
        try:
            conn.execute(
                "create table if not exists schema_migrations ("
                " version text primary key, checksum text not null,"
                " applied_at timestamptz not null default now())"
            )
            done: dict[str, str] = {
                r[0]: r[1] for r in conn.execute("select version, checksum from schema_migrations").fetchall()
            }
            for path in _files(directory):
                checksum = _checksum(path)
                if path.name in done:
                    if done[path.name] != checksum:
                        raise MigrationError(f"{path.name} was modified after it was applied")
                    continue
                if check_only:
                    raise MigrationError(f"pending migration: {path.name}")
                with conn.transaction():
                    conn.execute(path.read_text())
                    conn.execute(
                        "insert into schema_migrations (version, checksum) values (%s, %s)",
                        (path.name, checksum),
                    )
                applied_now.append(path.name)
        finally:
            conn.execute("select pg_advisory_unlock(%s)", (LOCK_ID,))
    return applied_now


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    args = parser.parse_args()
    dsn = os.environ.get("RECALL_MIGRATION_DATABASE_URL")
    if not dsn:
        print("RECALL_MIGRATION_DATABASE_URL (owner role) is required", file=sys.stderr)
        return 2
    try:
        applied = migrate(dsn, args.dir, check_only=args.check)
    except MigrationError as exc:
        print(f"migration error: {exc}", file=sys.stderr)
        return 1
    print("applied: " + (", ".join(applied) if applied else "nothing (up to date)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
