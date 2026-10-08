"""Address the independently initialized empty CI restore cluster without recreating roles."""

from __future__ import annotations

import json
import os
from pathlib import Path

from psycopg.conninfo import conninfo_to_dict, make_conninfo

secrets_dir = Path(__file__).resolve().parents[1] / "secrets"
connections = json.loads(Path(os.environ["DO_OPS_TEST_CONNECTION_FILE"]).read_text(encoding="utf-8"))
fields = conninfo_to_dict(connections["operator"])
fields["host"] = os.environ["DO_OPS_RESTORE_DATABASE_HOST"]
fields["dbname"] = "recall_restore"
target = secrets_dir / "ci_restore_database_url.local"
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
with os.fdopen(fd, "w", encoding="utf-8") as stream:
    stream.write(make_conninfo(**fields) + "\n")
os.chmod(target, 0o400)
print("Empty synthetic restore database prepared.")
