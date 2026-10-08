"""Validate a reviewed activation record, external recovery clearance and runtime role."""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

REQUIRED_TABLES = {
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
OPTIONAL_TABLES = {"search_chunk_embeddings"}


def fail() -> None:
    # Never include setting values, provider identifiers, paths, or database errors.
    raise SystemExit("Inference preflight failed; verify the private activation, role, and recovery records.")


def read_json(name: str) -> dict[str, Any]:
    try:
        value = json.loads(Path(os.environ[name]).read_text(encoding="utf-8"))
    except (KeyError, OSError, json.JSONDecodeError):
        fail()
    if not isinstance(value, dict):
        fail()
    return value


def decimal(value: object) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        fail()
    if not result.is_finite() or result < 0:
        fail()
    return result


try:
    activation = read_json("RECALL_ACTIVATION_RECORD_FILE")
    hold = read_json("RECALL_RECOVERY_HOLD_FILE")
    dsn_path = Path(os.environ["RECALL_API_DATABASE_URL_FILE"])
    dsn = dsn_path.read_text(encoding="utf-8").strip()
    key_path = Path(os.environ["RECALL_AI_API_KEY_FILE"])
    api_key = key_path.read_text(encoding="utf-8").strip()
except (KeyError, OSError):
    fail()

required = {
    "record_type": "recall.do-inference.activation.v1",
    "status": "reviewed",
    "scope": "inference-only",
    "device_scope": "photo_inference",
    "provider": "anthropic",
}
if any(activation.get(key) != value for key, value in required.items()):
    fail()
for field in (
    "review_id",
    "new_production_approval_ref",
    "reviewed_at",
    "owner_id",
    "workspace_id",
    "device_id",
    "vault_id",
    "consent_version",
    "provider_account",
    "model_id",
):
    if not isinstance(activation.get(field), str) or not activation[field].strip():
        fail()
for field in ("owner_id", "workspace_id", "device_id", "vault_id"):
    try:
        uuid.UUID(activation[field])
    except ValueError:
        fail()

origin = os.environ.get("RECALL_PUBLIC_ORIGIN", "")
try:
    parsed_origin = urlsplit(origin)
except ValueError:
    fail()
if (
    parsed_origin.scheme != "https"
    or not parsed_origin.hostname
    or parsed_origin.path
    or parsed_origin.query
    or parsed_origin.fragment
):
    fail()
if activation.get("origin") != origin or os.environ.get("RECALL_SERVICE_PROFILE") != "inference":
    fail()
if (
    os.environ.get("RECALL_AUTO_PROVISION_WORKSPACES") != "false"
    or os.environ.get("RECALL_DEVICE_PAIRING_ENABLED") != "true"
):
    fail()
if os.environ.get("AI_PROVIDER") != activation["provider"] or os.environ.get("AI_MODEL_ID") != activation["model_id"]:
    fail()
if not api_key or not dsn:
    fail()
for env_name, record_name in (
    ("AI_INPUT_USD_PER_MTOK", "input_usd_per_mtok"),
    ("AI_OUTPUT_USD_PER_MTOK", "output_usd_per_mtok"),
    ("RECALL_AI_DAILY_BUDGET_USD", "daily_budget_usd"),
    ("RECALL_AI_MONTHLY_BUDGET_USD", "monthly_budget_usd"),
):
    if decimal(os.environ.get(env_name, "")) != decimal(activation.get(record_name)):
        fail()

# The authorized provider account is workspace-scoped. If the operator configures the
# SDK's documented custom-header passthrough, require its value to match this record.
header = os.environ.get("ANTHROPIC_CUSTOM_HEADERS", "")
if header:
    match = re.fullmatch(r"\s*anthropic-workspace-id:\s*([^\s,]+)\s*", header, flags=re.IGNORECASE)
    if match is None or match.group(1) != activation["provider_account"]:
        fail()

if any(
    os.environ.get(name)
    for name in (
        "RECALL_AUTH_ISSUER",
        "RECALL_AUTH_JWKS_URL",
        "RECALL_AUTH_JWT_SECRET",
        "RECALL_SIGNING_SECRET",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "RECALL_MIGRATION_DATABASE_URL",
        "RECALL_WORKER_DATABASE_URL",
        "RECALL_EMBEDDING_PROVIDER",
        "RECALL_EMBEDDING_MODEL_ID",
        "RECALL_EMBEDDING_API_KEY",
    )
):
    fail()
if any(name.startswith("AI_") and "EMBEDDING" in name and value for name, value in os.environ.items()):
    fail()

recovery_required = {
    "record_type": "recall.do-inference.recovery-clearance.v1",
    "hold": False,
    "provider_usage_reconciled": True,
    "pending_vault_operations_reconciled": True,
    "previous_grants_revoked": True,
    "fresh_pairing_required": True,
}
if any(hold.get(key) != value for key, value in recovery_required.items()):
    fail()
for field in ("cleared_by", "clearance_ref", "cleared_at"):
    if not isinstance(hold.get(field), str) or not hold[field].strip():
        fail()

try:
    import psycopg
    from psycopg.conninfo import conninfo_to_dict
    from psycopg.rows import dict_row

    fields = conninfo_to_dict(dsn)
    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=5) as conn:
        role = conn.execute(
            "select r.rolcanlogin,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication,"
            "pg_has_role(current_user,'recall_app','member') as is_app_member,"
            "exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace "
            "where n.nspname='public' and c.relkind in ('r','p') "
            "and c.relowner=(select oid from pg_roles where rolname=current_user)) as owns_tables "
            "from pg_roles r where r.rolname=current_user"
        ).fetchone()
        if (
            fields.get("user") != "recall_api"
            or role is None
            or not role["rolcanlogin"]
            or not role["is_app_member"]
            or role["owns_tables"]
        ):
            fail()
        if any(
            role[key]
            for key in (
                "rolsuper",
                "rolbypassrls",
                "rolcreatedb",
                "rolcreaterole",
                "rolreplication",
            )
        ):
            fail()
        if not fields.get("dbname"):
            fail()
        migrations_dir = Path("/app/services/backend/migrations")
        expected_ledger = {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(migrations_dir.glob("*.sql"))
        }
        actual_ledger = {
            row["version"]: row["checksum"] for row in conn.execute("select version,checksum from schema_migrations")
        }
        if not expected_ledger or actual_ledger != expected_ledger:
            fail()
        memberships = {
            row[0]
            for row in conn.execute(
                "select parent.rolname from pg_auth_members membership "
                "join pg_roles member on member.oid=membership.member "
                "join pg_roles parent on parent.oid=membership.roleid "
                "where member.rolname=current_user"
            )
        }
        if memberships != {"recall_app"}:
            fail()
        relations = conn.execute(
            "select c.relname,c.relkind,c.relispartition,c.relrowsecurity,c.relforcerowsecurity,"
            "pg_get_userbyid(c.relowner) as owner,"
            "(select count(*) from pg_policy p where p.polrelid=c.oid) as policies "
            "from pg_class c join pg_namespace n on n.oid=c.relnamespace "
            "where n.nspname='public' and c.relkind in ('r','p','f') order by c.relname"
        ).fetchall()
        actual_tables = {row["relname"] for row in relations}
        if REQUIRED_TABLES - actual_tables or actual_tables - REQUIRED_TABLES - OPTIONAL_TABLES:
            fail()
        for relation in relations:
            if relation["relname"] == "schema_migrations":
                if relation["owner"] != "recall_migrator":
                    fail()
                continue
            if (
                relation["relkind"] != "r"
                or relation["relispartition"]
                or relation["owner"] != "recall_migrator"
                or not relation["relrowsecurity"]
                or not relation["relforcerowsecurity"]
                or relation["policies"] < 1
            ):
                fail()
        functions = {
            row["proname"]
            for row in conn.execute(
                "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"
            )
        }
        if (
            not {
                "recall_device_pair_auth",
                "recall_device_pair_claim",
                "recall_device_pair_revoke",
                "recall_expire_local_readings",
            }
            <= functions
        ):
            fail()
        worker = conn.execute("select rolcanlogin from pg_roles where rolname='recall_worker'").fetchone()
        if worker is None or worker["rolcanlogin"]:
            fail()
except (psycopg.Error, ValueError):
    fail()

print("Inference activation and recovery preflight passed.")
