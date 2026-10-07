"""Migration validation and database-level invariants (hold even for the table owner)."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import psycopg
import pytest

from conftest import PgCluster, make_database
from recall.db.database import Database
from recall.db.migrate import DEFAULT_DIR, MigrationError, migrate

TABLES = [
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
    "entity_aliases",
    "mentions",
    "entity_links",
    "claims",
    "claim_revisions",
    "actions",
    "memory_overrides",
    "change_events",
    "identity_operations",
]

MIGRATIONS = [
    "0001_trusted_capture.sql",
    "0002_first_useful_recall.sql",
    "0003_trusted_memory_projection.sql",
    "0004_resilient_sync.sql",
    "0005_hybrid_retrieval.sql",
    "0006_portability.sql",
]


@pytest.fixture
def fresh(pg_cluster: PgCluster) -> tuple[str, str, str]:
    owner, app = make_database(pg_cluster, apply_migrations=False)
    return owner, app, owner.replace("recall_owner@", "postgres@")


def test_empty_database_migrates_and_reruns_as_noop(fresh: tuple[str, str, str]) -> None:
    owner, _, _ = fresh
    assert migrate(owner) == MIGRATIONS
    assert migrate(owner) == []
    assert migrate(owner, check_only=True) == []
    with psycopg.connect(owner) as conn:
        assert [
            r[0] for r in conn.execute("select version from schema_migrations order by version").fetchall()
        ] == MIGRATIONS


def test_upgrade_from_accepted_rcl002_keeps_existing_original_rows(fresh: tuple[str, str, str], tmp_path: Path) -> None:
    owner, _, admin = fresh
    baseline = tmp_path / "baseline"
    baseline.mkdir()
    for name in MIGRATIONS[:2]:
        shutil.copyfile(DEFAULT_DIR / name, baseline / name)
    assert migrate(owner, baseline) == MIGRATIONS[:2]
    with psycopg.connect(admin) as conn:
        ids = _seed(conn)
        before = conn.execute("select to_jsonb(s) from source_objects s where id=%s", (ids["src"],)).fetchone()
    assert migrate(owner) == MIGRATIONS[2:]
    with psycopg.connect(admin) as conn:
        assert conn.execute("select to_jsonb(s) from source_objects s where id=%s", (ids["src"],)).fetchone() == before


def test_check_mode_flags_pending_and_tampered_migrations(fresh: tuple[str, str, str], tmp_path: Path) -> None:
    owner, _, _ = fresh
    with pytest.raises(MigrationError, match="pending"):
        migrate(owner, check_only=True)
    work = tmp_path / "m"
    shutil.copytree(DEFAULT_DIR, work)
    migrate(owner, work)
    (work / "0001_trusted_capture.sql").write_text((work / "0001_trusted_capture.sql").read_text() + "\n-- edited\n")
    with pytest.raises(MigrationError, match="modified after"):
        migrate(owner, work)


def test_future_migration_applies_on_top_of_existing_schema(fresh: tuple[str, str, str], tmp_path: Path) -> None:
    owner, _, _ = fresh
    work = tmp_path / "m"
    shutil.copytree(DEFAULT_DIR, work)
    migrate(owner, work)
    (work / "0099_example.sql").write_text("alter table devices add column note text;")
    assert migrate(owner, work) == ["0099_example.sql"]


def test_failed_migration_rolls_back_completely(fresh: tuple[str, str, str], tmp_path: Path) -> None:
    owner, _, _ = fresh
    work = tmp_path / "m"
    work.mkdir()
    (work / "0001_bad.sql").write_text("create table half_done (id int); select 1/0;")
    with pytest.raises(psycopg.errors.DivisionByZero):
        migrate(owner, work)
    with psycopg.connect(owner) as conn:
        assert conn.execute("select to_regclass('half_done')").fetchone()[0] is None  # type: ignore[index]
        assert conn.execute("select count(*) from schema_migrations").fetchone()[0] == 0  # type: ignore[index]


def test_every_table_has_forced_rls_and_the_app_role_cannot_delete(fresh: tuple[str, str, str]) -> None:
    owner, _, admin = fresh
    migrate(owner)
    with psycopg.connect(admin) as conn:
        for table in TABLES:
            enabled, forced = conn.execute(
                "select relrowsecurity, relforcerowsecurity from pg_class where oid = %s::regclass", (table,)
            ).fetchone()  # type: ignore[misc]
            assert enabled and forced, table
            assert conn.execute("select count(*) from pg_policies where tablename = %s", (table,)).fetchone()[0] >= 1  # type: ignore[index]
            for privilege in ("DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"):
                assert not conn.execute(
                    "select has_table_privilege('recall_app', %s, %s)", (table, privilege)
                ).fetchone()[0], (table, privilege)  # type: ignore[index]
        assert conn.execute("select rolsuper, rolbypassrls from pg_roles where rolname='recall_app'").fetchone() == (
            False,
            False,
        )


def test_api_role_least_privilege_check(pg_cluster: PgCluster) -> None:
    owner, app = make_database(pg_cluster)
    db = Database(app)
    db.open()
    try:
        db.assert_least_privilege()  # the non-owner API role passes
    finally:
        db.close()
    for dsn in (owner, owner.replace("recall_owner@", "postgres@")):  # owner and superuser must be refused
        bad = Database(dsn)
        bad.open()
        try:
            with pytest.raises(RuntimeError, match="must not"):
                bad.assert_least_privilege()
        finally:
            bad.close()


def _seed(conn: psycopg.Connection) -> dict[str, uuid.UUID]:  # type: ignore[type-arg]
    user, ws, cap, src, dev = (uuid.uuid4() for _ in range(5))
    conn.execute("select set_config('app.workspace_id', %s, false)", (str(ws),))
    conn.execute("insert into workspaces (id,name,created_by) values (%s,'W',%s)", (ws, user))
    conn.execute("insert into devices (workspace_id,id,user_id,platform) values (%s,%s,%s,'ios')", (ws, dev, user))
    conn.execute(
        "insert into captures (id,workspace_id,client_capture_id,device_id,created_by,source_kind,captured_at,"
        "timezone,page_count,request_digest) values (%s,%s,%s,%s,%s,'handwritten_note',now(),'UTC',1,%s)",
        (cap, ws, uuid.uuid4(), dev, user, "a" * 64),
    )
    conn.execute(
        "insert into source_objects (id,workspace_id,capture_id,client_page_id,ordinal,media_type,declared_byte_size,"
        "declared_sha256,storage_key) values (%s,%s,%s,%s,1,'image/jpeg',10,%s,%s)",
        (src, ws, cap, uuid.uuid4(), "b" * 64, f"k/{src}"),
    )
    return {"ws": ws, "cap": cap, "src": src}


def test_database_refuses_to_store_an_unverified_capture(fresh: tuple[str, str, str]) -> None:
    owner, _, admin = fresh
    migrate(owner)
    with psycopg.connect(admin, autocommit=True) as conn:
        ids = _seed(conn)
        with pytest.raises(psycopg.errors.CheckViolation, match="0 of 1 pages verified"):
            conn.execute("update captures set status='stored', stored_at=now() where id=%s", (ids["cap"],))
        conn.execute(
            "update source_objects set received_at=now(), received_byte_size=10, server_sha256=%s, verified_at=now() "
            "where id=%s",
            ("b" * 64, ids["src"]),
        )
        conn.execute("update captures set status='stored', stored_at=now() where id=%s", (ids["cap"],))
        with pytest.raises((psycopg.errors.RestrictViolation, psycopg.errors.CheckViolation)):  # cannot regress
            conn.execute("update captures set status='awaiting_upload', stored_at=null where id=%s", (ids["cap"],))


def test_database_makes_accepted_originals_write_once_and_hashes_authentic(fresh: tuple[str, str, str]) -> None:
    owner, _, admin = fresh
    migrate(owner)
    with psycopg.connect(admin, autocommit=True) as conn:
        ids = _seed(conn)
        with pytest.raises(psycopg.errors.CheckViolation):  # server hash must equal the declared hash
            conn.execute(
                "update source_objects set received_at=now(), received_byte_size=10, server_sha256=%s where id=%s",
                ("c" * 64, ids["src"]),
            )
        conn.execute(
            "update source_objects set received_at=now(), received_byte_size=10, server_sha256=%s where id=%s",
            ("b" * 64, ids["src"]),
        )
        for sql in (
            "update source_objects set server_sha256 = repeat('d', 64) where id = %s",
            "update source_objects set declared_sha256 = repeat('d', 64) where id = %s",
            "update source_objects set storage_key = 'elsewhere' where id = %s",
            "update source_objects set ordinal = 2 where id = %s",
            "update source_objects set received_at = now() - interval '1 day' where id = %s",
            "delete from source_objects where id = %s",
        ):
            with pytest.raises((psycopg.errors.RestrictViolation, psycopg.errors.CheckViolation)):
                conn.execute(sql, (ids["src"],))  # type: ignore[arg-type]
        with pytest.raises(psycopg.errors.RestrictViolation):
            conn.execute("delete from captures where id = %s", (ids["cap"],))


def test_composite_foreign_keys_prevent_cross_workspace_mixing(fresh: tuple[str, str, str]) -> None:
    owner, _, admin = fresh
    migrate(owner)
    with psycopg.connect(admin, autocommit=True) as conn:
        a, b = _seed(conn), _seed(conn)
        with pytest.raises(psycopg.errors.ForeignKeyViolation):  # B's page pointing at A's capture
            conn.execute(
                "insert into source_objects (id,workspace_id,capture_id,client_page_id,ordinal,media_type,"
                "declared_byte_size,declared_sha256,storage_key) values (%s,%s,%s,%s,2,'image/jpeg',1,%s,%s)",
                (uuid.uuid4(), b["ws"], a["cap"], uuid.uuid4(), "e" * 64, "k/mix"),
            )
