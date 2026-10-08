"""Write host-test DSNs for the isolated CI container without logging their values."""

from __future__ import annotations

import json
import os
from pathlib import Path

from psycopg.conninfo import conninfo_to_dict, make_conninfo

directory = Path(__file__).resolve().parents[1] / "secrets"
host = os.environ["DO_OPS_TEST_DATABASE_HOST"]
connections: dict[str, str] = {}
for name, file_name in (
    ("operator", "ci_operator_database_url.local"),
    ("api", "ci_api_database_url.local"),
):
    fields = conninfo_to_dict((directory / file_name).read_text(encoding="utf-8").strip())
    fields["host"] = host
    dsn = make_conninfo(**fields)
    connections[name] = dsn
    (directory / file_name).write_text(dsn + "\n", encoding="utf-8")
    os.chmod(directory / file_name, 0o400)
target = directory / "ci-test-connections.local"
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o400)
with os.fdopen(fd, "w", encoding="utf-8") as stream:
    json.dump(connections, stream)
    stream.write("\n")
os.chmod(target, 0o400)
print("Host-test connection file prepared.")
