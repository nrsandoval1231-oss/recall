"""Run the explicit operator bootstrap with a mounted, separate database credential."""

from __future__ import annotations

import os
import sys
from pathlib import Path

dsn = Path(os.environ["RECALL_BOOTSTRAP_DSN_FILE"]).read_text(encoding="utf-8").strip()
if not dsn:
    raise SystemExit("Operator bootstrap DSN file is empty.")
os.environ["RECALL_BOOTSTRAP_DATABASE_URL"] = dsn
os.execv(  # noqa: S606 -- fixed interpreter and module, no shell
    sys.executable,
    [sys.executable, "-m", "recall.db.inference_bootstrap", *sys.argv[1:]],
)
