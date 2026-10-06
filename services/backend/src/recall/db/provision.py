"""Provision a personal workspace for an existing auth user (when auto-provisioning is off).

python -m recall.db.provision <auth-user-uuid>      # uses RECALL_MIGRATION_DATABASE_URL
"""

from __future__ import annotations

import os
import sys
import uuid

import psycopg


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    user_id = uuid.UUID(sys.argv[1])
    dsn = os.environ["RECALL_MIGRATION_DATABASE_URL"]
    with psycopg.connect(dsn) as conn, conn.transaction():
        conn.execute("select set_config('app.user_id', %s, true)", (str(user_id),))
        existing = conn.execute("select 1 from workspace_members where user_id = %s", (user_id,)).fetchone()
        if existing:
            print("already provisioned")
            return 0
        workspace_id = uuid.uuid4()
        conn.execute(
            "insert into workspaces (id, name, created_by, personal_for_user) values (%s,'Personal',%s,%s)",
            (workspace_id, user_id, user_id),
        )
        conn.execute(
            "insert into workspace_members (workspace_id, user_id, role) values (%s,%s,'owner')",
            (workspace_id, user_id),
        )
    print(f"workspace {workspace_id} created")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
