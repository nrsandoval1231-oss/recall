"""Apply and verify migrations using only the separate migration-owner secret."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import psycopg

# Accept the pre-rename RECALL_* variable names: a MONOLITH_* value always wins.
for _legacy in [k for k in os.environ if k.startswith("RECALL_")]:
    os.environ.setdefault("MONOLITH_" + _legacy[len("RECALL_") :], os.environ[_legacy])

dsn_file = Path(os.environ["MONOLITH_MIGRATION_DSN_FILE"])
os.environ["MONOLITH_MIGRATION_DATABASE_URL"] = dsn_file.read_text(encoding="utf-8").strip()
os.environ["MONOLITH_MIGRATIONS_DIR"] = "/app/services/backend/migrations"
subprocess.run([sys.executable, "-m", "monolith.db.migrate"], check=True)
with psycopg.connect(os.environ["MONOLITH_MIGRATION_DATABASE_URL"], autocommit=True) as conn:
    conn.execute("grant select on table schema_migrations to recall_app")
subprocess.run([sys.executable, "/ops/audit-database.py"], check=True)
