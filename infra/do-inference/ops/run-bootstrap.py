"""Run the explicit operator bootstrap with a mounted, separate database credential."""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Accept the pre-rename RECALL_* variable names: a MONOLITH_* value always wins.
for _legacy in [k for k in os.environ if k.startswith("RECALL_")]:
    os.environ.setdefault("MONOLITH_" + _legacy[len("RECALL_") :], os.environ[_legacy])

dsn = Path(os.environ["MONOLITH_BOOTSTRAP_DSN_FILE"]).read_text(encoding="utf-8").strip()
if not dsn:
    raise SystemExit("Operator bootstrap DSN file is empty.")
os.environ["MONOLITH_BOOTSTRAP_DATABASE_URL"] = dsn
os.execv(  # noqa: S606 -- fixed interpreter and module, no shell
    sys.executable,
    [sys.executable, "-m", "monolith.db.inference_bootstrap", *sys.argv[1:]],
)
