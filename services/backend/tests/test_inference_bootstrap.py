from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest

from recall.db import inference_bootstrap
from recall.db.inference_bootstrap import BootstrapError, bootstrap_owner


def test_inference_bootstrap_is_atomic_idempotent_and_refuses_conflicts(pg_cluster) -> None:  # type: ignore[no-untyped-def]
    from conftest import make_database

    owner_dsn, app_dsn = make_database(pg_cluster)
    bootstrap_dsn = owner_dsn.replace("recall_owner@", "postgres@")
    owner_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    with pytest.raises(BootstrapError, match="BYPASSRLS or superuser"):
        bootstrap_owner(owner_dsn, owner_id, workspace_id)
    with pytest.raises(BootstrapError, match="BYPASSRLS or superuser"):
        bootstrap_owner(app_dsn, owner_id, workspace_id)
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: bootstrap_owner(bootstrap_dsn, owner_id, workspace_id), range(2)))
    assert sorted(outcomes) == [False, True]
    assert bootstrap_owner(bootstrap_dsn, owner_id, workspace_id) is False
    with psycopg.connect(owner_dsn) as conn:
        assert (
            conn.execute(
                "select count(*) from workspace_members where user_id=%s and workspace_id=%s and role='owner'",
                (owner_id, workspace_id),
            ).fetchone()[0]
            == 1
        )
    with pytest.raises(BootstrapError, match="conflicting"):
        bootstrap_owner(bootstrap_dsn, owner_id, uuid.uuid4())
    with pytest.raises(BootstrapError, match="conflicting"):
        bootstrap_owner(bootstrap_dsn, uuid.uuid4(), workspace_id)
    with psycopg.connect(bootstrap_dsn) as conn:
        conn.execute(
            "insert into device_pair_grants(id,workspace_id,user_id,device_id,vault_id,secret_sha256,scope) "
            "values(%s,%s,%s,%s,%s,%s,'photo_inference')",
            (uuid.uuid4(), workspace_id, owner_id, uuid.uuid4(), uuid.uuid4(), "e" * 64),
        )
    with pytest.raises(BootstrapError, match="empty inference realm"):
        bootstrap_owner(bootstrap_dsn, owner_id, workspace_id)


def test_bootstrap_requires_verified_migration_state(pg_cluster) -> None:  # type: ignore[no-untyped-def]
    from conftest import make_database

    owner_dsn, _ = make_database(pg_cluster, apply_migrations=False)
    bootstrap_dsn = owner_dsn.replace("recall_owner@", "postgres@")
    with pytest.raises(BootstrapError, match="migration state is missing"):
        bootstrap_owner(bootstrap_dsn, uuid.uuid4(), uuid.uuid4())
    with psycopg.connect(bootstrap_dsn) as conn:
        assert conn.execute("select to_regclass('public.schema_migrations')").fetchone()[0] is None


def test_bootstrap_rejects_unexpected_empty_table_without_changing_rows(pg_cluster) -> None:  # type: ignore[no-untyped-def]
    from conftest import make_database

    owner_dsn, _ = make_database(pg_cluster)
    bootstrap_dsn = owner_dsn.replace("recall_owner@", "postgres@")
    with psycopg.connect(bootstrap_dsn) as conn:
        conn.execute("create table public.unexpected_empty_table (id integer primary key)")

    def row_counts() -> tuple[int, int, int, int]:
        with psycopg.connect(bootstrap_dsn) as conn:
            return (
                conn.execute("select count(*) from schema_migrations").fetchone()[0],
                conn.execute("select count(*) from workspaces").fetchone()[0],
                conn.execute("select count(*) from workspace_members").fetchone()[0],
                conn.execute("select count(*) from unexpected_empty_table").fetchone()[0],
            )

    before = row_counts()
    with pytest.raises(BootstrapError, match="table inventory"):
        bootstrap_owner(bootstrap_dsn, uuid.uuid4(), uuid.uuid4())
    assert row_counts() == before


def test_bootstrap_cli_requires_owner_dsn_and_explicit_approval(monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("RECALL_BOOTSTRAP_DATABASE_URL", raising=False)
    monkeypatch.setattr(
        "sys.argv",
        [
            "recall-inference-bootstrap",
            "--owner-id",
            str(uuid.uuid4()),
            "--workspace-id",
            str(uuid.uuid4()),
            "--profile",
            "inference",
            "--approve",
        ],
    )
    assert inference_bootstrap.main() == 2
    assert "RECALL_BOOTSTRAP_DATABASE_URL" in capsys.readouterr().err
    monkeypatch.setenv("RECALL_BOOTSTRAP_DATABASE_URL", "postgresql://synthetic.invalid/unused")
    monkeypatch.setattr(
        "sys.argv",
        [
            "recall-inference-bootstrap",
            "--owner-id",
            str(uuid.uuid4()),
            "--workspace-id",
            str(uuid.uuid4()),
            "--profile",
            "inference",
        ],
    )
    assert inference_bootstrap.main() == 2
    assert "No bootstrap performed" in capsys.readouterr().err
