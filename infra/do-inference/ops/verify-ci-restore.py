"""Assert restored synthetic evidence and database authority boundaries in CI."""

from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row

secrets = Path(__file__).resolve().parents[1] / "secrets"
connections = json.loads(Path(os.environ["DO_OPS_TEST_CONNECTION_FILE"]).read_text(encoding="utf-8"))
restored = conninfo_to_dict((secrets / "ci_restore_database_url.local").read_text(encoding="utf-8").strip())
source_operator = conninfo_to_dict(connections["operator"])
restored_operator = dict(source_operator)
for key in ("host", "port", "dbname"):
    if key not in restored:
        raise AssertionError(f"restore target omits {key}")
    restored_operator[key] = restored[key]
with psycopg.connect(**restored_operator) as conn:
    restored_identity = conn.execute("select inet_server_addr()::text,inet_server_port(),current_database()").fetchone()
    assert restored_identity[2] == "recall_restore"
    roles = {
        row["rolname"]: row
        for row in conn.execute(
            "select rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole "
            "from pg_roles where rolname in ('recall_api','recall_migrator','recall_worker','recall_app')",
            row_factory=dict_row,
        )
    }
    assert set(roles) == {
        "recall_api",
        "recall_migrator",
        "recall_worker",
        "recall_app",
    }
    assert roles["recall_worker"]["rolcanlogin"] is False
    assert roles["recall_api"]["rolcanlogin"] is True
    assert not any(roles["recall_api"][key] for key in ("rolsuper", "rolbypassrls", "rolcreatedb", "rolcreaterole"))
    assert conn.execute("select pg_has_role('recall_api','recall_app','member')").fetchone()[0]

with psycopg.connect(connections["operator"]) as source, psycopg.connect(**restored_operator) as restored_conn:
    source_identity = source.execute("select inet_server_addr()::text,inet_server_port(),current_database()").fetchone()
    assert source_identity != restored_identity
    relations = restored_conn.execute(
        "select relname,relrowsecurity,relforcerowsecurity from pg_class c "
        "join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' "
        "and c.relkind='r' and c.relname <> 'schema_migrations'"
    ).fetchall()
    assert relations and all(row[1] and row[2] for row in relations)
    evidence_tables = (
        "workspaces",
        "workspace_members",
        "devices",
        "device_pair_invitations",
        "device_pair_grants",
        "ai_consents",
        "local_reading_receipts",
        "ai_usage",
        "embedding_reservations",
    )
    for table in evidence_tables:
        query = sql.SQL(
            "select coalesce(jsonb_agg(to_jsonb(source_row) "
            "order by to_jsonb(source_row)::text), '[]'::jsonb) from public.{} source_row"
        ).format(sql.Identifier(table))
        assert source.execute(query).fetchone()[0] == restored_conn.execute(query).fetchone()[0]
print("Synthetic restored data, forced RLS, least-privilege roles and grant membership verified.")
