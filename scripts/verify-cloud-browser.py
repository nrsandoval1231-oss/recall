"""Run the approved UI against a disposable real cloud API/database (no native IPC)."""
import os
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/backend/tests"))
from conftest import Env, PgCluster  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
import uvicorn  # noqa: E402

cluster = PgCluster()
try:
    with tempfile.TemporaryDirectory(prefix="megraph-browser-") as directory:
        operator = secrets.token_hex(32)
        env = Env(cluster, ec.generate_private_key(ec.SECP256R1()), Path(directory),
                  overrides={"operator_token": operator, "site_origins": ["http://127.0.0.1:1420"]})
        server = uvicorn.Server(uvicorn.Config(env.app, host="127.0.0.1", port=8000, log_level="warning", access_log=False))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        try:
            for _ in range(100):
                if server.started:
                    break
                time.sleep(.05)
            if not server.started:
                raise RuntimeError("Cloud test server did not start")
            enrollment = env.client.post("/v1/operator/enrollments", json={}, headers={"Authorization": f"Bearer {operator}"})
            enrollment.raise_for_status()
            subprocess.run(["node", "apps/desktop/scripts/verify-cloud.mjs"], cwd=ROOT,
                           env={**os.environ, "MEGRAPH_TEST_ENROLLMENT": enrollment.json()["enrollment_token"]}, check=True)
        finally:
            server.should_exit = True
            thread.join(timeout=15)
            env.close()
finally:
    cluster.stop()
