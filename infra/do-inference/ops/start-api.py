"""Run the API only while the durable external recovery record remains cleared."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

for file_env, target_env in (
    ("RECALL_API_DATABASE_URL_FILE", "DATABASE_URL"),
    ("RECALL_AI_API_KEY_FILE", "AI_API_KEY"),
):
    path = Path(os.environ[file_env])
    value = path.read_text(encoding="utf-8").strip()
    if not value:
        raise SystemExit("Inference secret file is empty.")
    os.environ[target_env] = value

subprocess.run(  # noqa: S603 -- fixed interpreter and audited local script
    [sys.executable, "/ops/preflight.py"], check=True
)


def recovery_is_clear(path: Path) -> bool:
    """Fail closed if the atomically replaced external record cannot be read."""
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return (
        isinstance(record, dict)
        and record.get("hold") is False
        and record.get("record_type") == "recall.do-inference.recovery-clearance.v1"
    )


hold_path = Path(os.environ["RECALL_RECOVERY_HOLD_FILE"])
if not recovery_is_clear(hold_path):
    raise SystemExit("External recovery hold blocks API launch.")

process = subprocess.Popen(  # noqa: S603 -- fixed Python module and constant argv
    [
        sys.executable,
        "-m",
        "uvicorn",
        "recall.api.inference:app_factory",
        "--factory",
        "--host",
        "0.0.0.0",  # noqa: S104 -- Compose publishes this container only to loopback
        "--port",
        "8000",
        "--no-access-log",
    ],
    env=os.environ,
)
while process.poll() is None:
    if not recovery_is_clear(hold_path):
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
        raise SystemExit("External recovery hold activated; API fenced.")
    time.sleep(0.25)
raise SystemExit(process.returncode or 0)
