"""Create or verify the explicit owner workspace for a fresh inference-only realm."""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import uuid
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from .migrate import DEFAULT_DIR

REQUIRED_PUBLIC_TABLES = frozenset(
    {
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
    }
)
OPTIONAL_PUBLIC_TABLES = frozenset({"search_chunk_embeddings"})


class BootstrapError(ValueError):
    pass


def _bootstrap_owner(
    dsn: str,
    owner_id: uuid.UUID,
    workspace_id: uuid.UUID,
    *,
    name: str = "Recall",
    migration_dir: Path = DEFAULT_DIR,
) -> bool:
    """Return True on creation and False for an exact idempotent replay."""
    name = name.strip()
    if not name or len(name) > 200:
        raise BootstrapError("workspace name must be 1-200 characters")
    with psycopg.connect(dsn, autocommit=True, row_factory=dict_row) as conn:
        conn.execute("select pg_advisory_lock(7402007)")
        try:
            with conn.transaction():
                _verify_operator(conn)
                _verify_migrations(conn, migration_dir)
                table_rows = _public_table_rows(conn)
                workspace = conn.execute(
                    "select id,name,created_by,personal_for_user from workspaces where id=%s",
                    (workspace_id,),
                ).fetchone()
                memberships = conn.execute(
                    "select workspace_id,role from workspace_members where user_id=%s order by workspace_id",
                    (owner_id,),
                ).fetchall()
                nonempty = {
                    table: count
                    for table, count in table_rows.items()
                    if count and table not in {"schema_migrations", "workspaces", "workspace_members"}
                }
                if nonempty:
                    raise BootstrapError("database is not an empty inference realm")
                if workspace is not None or memberships:
                    exact = (
                        workspace is not None
                        and len(memberships) == 1
                        and table_rows["workspaces"] == 1
                        and table_rows["workspace_members"] == 1
                        and workspace["name"] == name
                        and workspace["created_by"] == owner_id
                        and workspace["personal_for_user"] == owner_id
                        and memberships[0]["workspace_id"] == workspace_id
                        and memberships[0]["role"] == "owner"
                    )
                    if exact:
                        return False
                    raise BootstrapError("database contains conflicting owner or workspace data")
                if any(table_rows[table] for table in ("workspaces", "workspace_members")):
                    raise BootstrapError("database contains conflicting workspace data")
                conn.execute(
                    "insert into workspaces(id,name,created_by,personal_for_user) values(%s,%s,%s,%s)",
                    (workspace_id, name, owner_id, owner_id),
                )
                conn.execute(
                    "insert into workspace_members(workspace_id,user_id,role) values(%s,%s,'owner')",
                    (workspace_id, owner_id),
                )
        finally:
            conn.execute("select pg_advisory_unlock(7402007)")
    return True


def _verify_operator(conn: psycopg.Connection[dict[str, Any]]) -> None:
    row = conn.execute("select rolsuper, rolbypassrls from pg_roles where rolname=current_user").fetchone()
    if row is None or not (row["rolsuper"] or row["rolbypassrls"]):
        raise BootstrapError("bootstrap requires a separately protected BYPASSRLS or superuser connection")


def _verify_migrations(conn: psycopg.Connection[dict[str, Any]], directory: Path) -> None:
    schema = conn.execute("select to_regclass('public.schema_migrations') as migration_table").fetchone()
    if schema is None or schema["migration_table"] is None:
        raise BootstrapError("migration state is missing")
    expected = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(directory.glob("*.sql"))
        if path.is_file()
    }
    rows = conn.execute("select version,checksum from schema_migrations").fetchall()
    actual = {row["version"]: row["checksum"] for row in rows}
    if actual != expected:
        raise BootstrapError("migration state is pending, modified, or differs from this source tree")


def _public_table_rows(conn: psycopg.Connection[dict[str, Any]]) -> dict[str, int]:
    names = conn.execute(
        "select c.relname,c.relkind,c.relispartition,exists("
        "select 1 from pg_inherits i where i.inhparent=c.oid) as has_partitions "
        "from pg_class c join pg_namespace n on n.oid=c.relnamespace "
        "where n.nspname='public' and c.relkind in ('r','p','f') order by c.relname"
    ).fetchall()
    actual_tables = {row["relname"] for row in names}
    missing = REQUIRED_PUBLIC_TABLES - actual_tables
    unexpected = actual_tables - REQUIRED_PUBLIC_TABLES - OPTIONAL_PUBLIC_TABLES
    if missing or unexpected:
        raise BootstrapError("public table inventory differs from the supported inference schema")
    counts: dict[str, int] = {}
    for row in names:
        table = row["relname"]
        assert isinstance(table, str)
        if row["relkind"] == "f" or row["relkind"] == "p" or row["relispartition"] or row["has_partitions"]:
            raise BootstrapError("public foreign or partitioned tables are not supported by inference bootstrap")
        # Identifiers come only from pg_catalog and are quoted by psycopg's SQL helper.
        count = conn.execute(
            sql.SQL("select count(*) as row_count from public.{}").format(sql.Identifier(table))
        ).fetchone()
        assert count is not None
        counts[table] = count["row_count"]
    return counts


def bootstrap_owner(
    dsn: str,
    owner_id: uuid.UUID,
    workspace_id: uuid.UUID,
    *,
    name: str = "Recall",
    migration_dir: Path = DEFAULT_DIR,
) -> bool:
    """Retry an exact concurrent insert after PostgreSQL has resolved its unique-key race."""
    try:
        return _bootstrap_owner(dsn, owner_id, workspace_id, name=name, migration_dir=migration_dir)
    except psycopg.errors.UniqueViolation:
        # PostgreSQL may start a statement snapshot before another operator's advisory
        # lock is released. Re-read on a fresh transaction, then accept only exact replay.
        try:
            return _bootstrap_owner(dsn, owner_id, workspace_id, name=name, migration_dir=migration_dir)
        except psycopg.errors.UniqueViolation as exc:
            raise BootstrapError("owner or workspace already has conflicting operational data") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-id", required=True, type=uuid.UUID)
    parser.add_argument("--workspace-id", required=True, type=uuid.UUID)
    parser.add_argument("--name", default="Recall")
    parser.add_argument("--profile", required=True, choices=("inference",))
    parser.add_argument("--approve", action="store_true", help="confirm this exact fresh operational owner/workspace")
    args = parser.parse_args()
    dsn = os.environ.get("RECALL_BOOTSTRAP_DATABASE_URL")
    if not dsn:
        print("RECALL_BOOTSTRAP_DATABASE_URL (protected BYPASSRLS/superuser role) is required", file=sys.stderr)
        return 2
    if not args.approve:
        print(
            "No bootstrap performed. Re-run with --approve after confirming owner and workspace IDs.", file=sys.stderr
        )
        return 2
    try:
        created = bootstrap_owner(dsn, args.owner_id, args.workspace_id, name=args.name)
    except (BootstrapError, psycopg.Error, RuntimeError, ValueError):
        print("Bootstrap failed; verify migration state and that this is a fresh, unconflicted realm.", file=sys.stderr)
        return 1
    print("Owner workspace created." if created else "Exact owner workspace already exists; no change made.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
