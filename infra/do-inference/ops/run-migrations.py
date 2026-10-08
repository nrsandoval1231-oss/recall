"""Apply and verify migrations using only the separate migration-owner secret."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import psycopg

dsn_file = Path(os.environ["RECALL_MIGRATION_DSN_FILE"])
os.environ["RECALL_MIGRATION_DATABASE_URL"] = dsn_file.read_text(encoding="utf-8").strip()
os.environ["RECALL_MIGRATIONS_DIR"] = "/app/services/backend/migrations"
subprocess.run([sys.executable, "-m", "recall.db.migrate"], check=True)
with psycopg.connect(os.environ["RECALL_MIGRATION_DATABASE_URL"], autocommit=True) as conn:
    conn.execute("grant select on table schema_migrations to recall_app")
subprocess.run([sys.executable, "/ops/audit-database.py"], check=True)
