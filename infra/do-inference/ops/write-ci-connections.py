"""Write host-test DSNs for the isolated CI container without logging their values."""

from __future__ import annotations

import json
import os
from pathlib import Path

from psycopg.conninfo import conninfo_to_dict, make_conninfo

directory = Path(__file__).resolve().parents[1] / "secrets"
host = os.environ["DO_OPS_TEST_DATABASE_HOST"]


def replace_runner_file(path: Path, content: str) -> None:
    """Atomically replace a runner-owned CI file without widening its final mode."""
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o400)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


connections: dict[str, str] = {}
for name, file_name in (
    ("operator", "ci_operator_database_url.local"),
    ("api", "ci_api_database_url.local"),
):
    fields = conninfo_to_dict((directory / file_name).read_text(encoding="utf-8").strip())
    fields["host"] = host
    dsn = make_conninfo(**fields)
    connections[name] = dsn
    replace_runner_file(directory / file_name, dsn + "\n")
target = directory / "ci-test-connections.local"
replace_runner_file(target, json.dumps(connections) + "\n")
print("Host-test connection file prepared.")
