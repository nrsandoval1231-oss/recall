"""Fail-closed schema, migration, role and forced-RLS audit for the inference realm."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

MIGRATIONS = Path(os.environ.get("RECALL_MIGRATIONS_DIR", "/app/services/backend/migrations"))
REQUIRED = {
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
OPTIONAL = {"search_chunk_embeddings"}
FUNCTIONS = {
    "recall_current_user_id",
    "recall_current_workspace_id",
    "recall_is_member",
    "recall_device_pair_auth",
    "recall_device_pair_claim",
    "recall_device_pair_revoke",
    "recall_device_pair_owner_revoke",
    "recall_expire_local_readings",
}


def api_inherits_app(connection):
    row = connection.execute("select pg_has_role('recall_api','recall_app','member') as is_app_member").fetchone()
    return row is not None and bool(row["is_app_member"])


def api_memberships(connection):
    return {
        row["parent_role"]
        for row in connection.execute(
            "select parent.rolname as parent_role from pg_auth_members membership "
            "join pg_roles member on member.oid=membership.member "
            "join pg_roles parent on parent.oid=membership.roleid "
            "where member.rolname='recall_api'"
        )
    }


dsn = os.environ["RECALL_MIGRATION_DATABASE_URL"]
with psycopg.connect(dsn, row_factory=dict_row) as conn:
    expected = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(MIGRATIONS.glob("*.sql"))}
    applied = {
        row["version"]: row["checksum"] for row in conn.execute("select version,checksum from schema_migrations")
    }
    if applied != expected:
        raise SystemExit("migration ledger differs from the checked-in migration set")

    relations = conn.execute(
        "select c.relname,c.relkind,c.relispartition,c.relrowsecurity,c.relforcerowsecurity,"
        "pg_get_userbyid(c.relowner) as owner,"
        "(select count(*) from pg_policy p where p.polrelid=c.oid) as policies "
        "from pg_class c join pg_namespace n on n.oid=c.relnamespace "
        "where n.nspname='public' and c.relkind in ('r','p','f') order by c.relname"
    ).fetchall()
    actual = {row["relname"] for row in relations}
    if actual - REQUIRED - OPTIONAL or REQUIRED - actual:
        raise SystemExit("public relation allowlist differs from the supported migration schema")
    for row in relations:
        name = row["relname"]
        if name == "schema_migrations":
            if row["owner"] != "recall_migrator":
                raise SystemExit("migration ledger has unexpected owner")
            continue
        if row["relkind"] != "r" or row["relispartition"]:
            raise SystemExit("foreign or partitioned public relation is unsupported")
        if row["owner"] != "recall_migrator" or not row["relrowsecurity"] or not row["relforcerowsecurity"]:
            raise SystemExit(f"{name} ownership or forced RLS check failed")
        if row["policies"] < 1:
            raise SystemExit(f"{name} has no row-level security policy")

    functions = {
        row["proname"]
        for row in conn.execute(
            "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"
        )
    }
    if not functions >= FUNCTIONS:
        raise SystemExit("required security and recovery functions are missing")

    roles = conn.execute(
        "select rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication "
        "from pg_roles where rolname in ("
        "'recall_api','recall_migrator','recall_worker','recall_app','recall_worker_login')"
    ).fetchall()
    by_name = {row["rolname"]: row for row in roles}
    api = by_name.get("recall_api")
    migrator = by_name.get("recall_migrator")
    worker = by_name.get("recall_worker")
    app = by_name.get("recall_app")
    if (
        not api
        or not api["rolcanlogin"]
        or any(
            api[k]
            for k in (
                "rolsuper",
                "rolbypassrls",
                "rolcreatedb",
                "rolcreaterole",
                "rolreplication",
            )
        )
    ):
        raise SystemExit("API login role is absent or has elevated PostgreSQL privileges")
    if (
        worker is None
        or worker["rolcanlogin"]
        or ("recall_worker_login" in by_name and by_name["recall_worker_login"]["rolcanlogin"])
    ):
        raise SystemExit("worker role must remain NOLOGIN")
    if (
        migrator is None
        or not migrator["rolcanlogin"]
        or any(
            migrator[k]
            for k in (
                "rolsuper",
                "rolbypassrls",
                "rolcreatedb",
                "rolcreaterole",
                "rolreplication",
            )
        )
    ):
        raise SystemExit("migration owner is absent or has unexpected role attributes")
    if app is None or not api_inherits_app(conn):
        raise SystemExit("API role does not inherit recall_app")
    memberships = api_memberships(conn)
    if memberships != {"recall_app"}:
        raise SystemExit("API role has unexpected role memberships")
    print("Database schema, migration ledger, roles, object ownership, functions and forced RLS verified.")
