"""Connection pool and the per-request security context.

Every transaction sets `app.user_id` / `app.workspace_id` with set_config(..., true), so the
values are transaction-local and cleared at COMMIT/ROLLBACK even on a pooled connection.
The workspace is derived from verified membership, never from client input.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

Row = dict[str, Any]


@dataclass
class Tx:
    conn: psycopg.Connection[Row]
    user_id: uuid.UUID
    workspace_id: uuid.UUID

    def one(self, sql: str, params: tuple[Any, ...] | dict[str, Any] = ()) -> Row | None:
        return self.conn.execute(sql, params).fetchone()

    def all(self, sql: str, params: tuple[Any, ...] | dict[str, Any] = ()) -> list[Row]:
        return self.conn.execute(sql, params).fetchall()

    def run(self, sql: str, params: tuple[Any, ...] | dict[str, Any] = ()) -> int:
        return self.conn.execute(sql, params).rowcount


class Database:
    def __init__(self, dsn: str, *, min_size: int = 1, max_size: int = 10) -> None:
        self.pool: ConnectionPool[psycopg.Connection[Row]] = ConnectionPool(
            dsn,
            min_size=min_size,
            max_size=max_size,
            kwargs={"row_factory": dict_row},
            open=False,
        )

    def open(self) -> None:
        self.pool.open(wait=True, timeout=15)

    def close(self) -> None:
        self.pool.close()

    @contextmanager
    def tx(self, user_id: uuid.UUID, *, provision: bool = False) -> Iterator[Tx]:
        """One transaction scoped to `user_id`'s workspace.

        Raises LookupError when the user has no workspace and `provision` is False.
        """
        with self.pool.connection() as conn, conn.transaction():
            conn.execute(
                "select set_config('app.user_id', %s, true), set_config('app.workspace_id', '', true)",
                (str(user_id),),
            )
            row = conn.execute(
                "select workspace_id from workspace_members where user_id = %s "
                "order by created_at, workspace_id limit 1",
                (user_id,),
            ).fetchone()
            if row is None:
                if not provision:
                    raise LookupError("no workspace")
                workspace_id = _provision_workspace(conn, user_id)
            else:
                workspace_id = row["workspace_id"]
            conn.execute("select set_config('app.workspace_id', %s, true)", (str(workspace_id),))
            yield Tx(conn=conn, user_id=user_id, workspace_id=workspace_id)

    def assert_least_privilege(self) -> None:
        """Fail fast if the API role could bypass RLS (superuser, BYPASSRLS, or table owner)."""
        with self.pool.connection() as conn:
            row = conn.execute(
                """
                select r.rolsuper, r.rolbypassrls,
                       (select pg_get_userbyid(c.relowner) = current_user
                          from pg_class c where c.oid = 'public.captures'::regclass) as owns_tables
                from pg_roles r where r.rolname = current_user
                """
            ).fetchone()
            conn.rollback()
        assert row is not None
        if row["rolsuper"] or row["rolbypassrls"] or row["owns_tables"]:
            raise RuntimeError("DATABASE_URL role must not be a superuser, have BYPASSRLS, or own the tables")


def _provision_workspace(conn: psycopg.Connection[Row], user_id: uuid.UUID) -> uuid.UUID:
    # Serialise first-touch provisioning per user; the unique index is the backstop.
    conn.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"provision:{user_id}",))
    row = conn.execute(
        "select workspace_id from workspace_members where user_id = %s order by created_at limit 1",
        (user_id,),
    ).fetchone()
    if row is not None:
        return row["workspace_id"]  # type: ignore[no-any-return]
    workspace_id = uuid.uuid4()
    conn.execute(
        "insert into workspaces (id, name, created_by, personal_for_user) values (%s, %s, %s, %s)",
        (workspace_id, "Personal", user_id, user_id),
    )
    conn.execute(
        "insert into workspace_members (workspace_id, user_id, role) values (%s, %s, 'owner')",
        (workspace_id, user_id),
    )
    return workspace_id
