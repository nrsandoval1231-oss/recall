"""E2E: real uvicorn process + real Postgres + the TypeScript sync engine / API client.

Proves mobile bytes == cloud original bytes == desktop-viewed bytes (SHA-256), through an
interrupted upload and an app relaunch. Skipped (not faked) if Node tooling is unavailable.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx
import jwt
import pytest
from conftest import AUDIENCE, ISSUER, REPO_ROOT, PgCluster, make_database

SECRET = "e2e-hs256-secret-0123456789abcdefghijklmnop"
pytestmark = pytest.mark.e2e


def _token(user: uuid.UUID) -> str:
    now = int(time.time())
    return jwt.encode({"sub": str(user), "iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + 3600}, SECRET, "HS256")


def test_phone_to_cloud_to_desktop_bytes_are_identical(pg_cluster: PgCluster, tmp_path: Path) -> None:
    tsx = REPO_ROOT / "node_modules/.bin/tsx"
    if not tsx.exists() or not shutil.which("node"):
        pytest.skip("run `npm install` at the repo root to enable the TypeScript e2e")
    _, app_dsn = make_database(pg_cluster)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    store = tmp_path / "objects"
    env = {
        **os.environ, "DATABASE_URL": app_dsn, "RECALL_AUTH_ISSUER": ISSUER, "RECALL_AUTH_JWT_SECRET": SECRET,
        "RECALL_SIGNING_SECRET": "e2e-signing-secret-0123456789abcdefghijkl", "RECALL_LOCAL_STORAGE_DIR": str(store),
        "RECALL_CAPTURE_SCHEMA_PATH": str(REPO_ROOT / "packages/contracts/capture.schema.json"),
    }
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "recall.api.app:app_factory", "--factory", "--port", str(port), "--log-level", "warning"],
        env=env, cwd=REPO_ROOT / "services/backend",
    )
    try:
        for _ in range(100):
            try:
                if httpx.get(f"http://127.0.0.1:{port}/readyz", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.1)
        else:
            pytest.fail("server did not start")
        out = subprocess.run(
            [str(tsx), "tests/e2e/rcl001.e2e.ts"], cwd=REPO_ROOT, capture_output=True, text=True, timeout=120,
            env={**os.environ, "E2E_API_BASE": f"http://127.0.0.1:{port}", "E2E_TOKEN_A": _token(uuid.uuid4()), "E2E_TOKEN_B": _token(uuid.uuid4())},
        )
        assert out.returncode == 0, out.stderr + out.stdout
        result = json.loads(next(l for l in out.stdout.splitlines() if l.startswith("E2E_RESULT ")).removeprefix("E2E_RESULT "))
    finally:
        server.terminate()
        server.wait(10)

    assert result["interruptedState"] == "NETWORK"  # the first attempt really was interrupted
    assert result["finalPhase"] == "finalized" and result["serverStatus"] == "stored"
    assert result["capturesForOperation"] == 1 and result["ordinals"] == [1, 2, 3]
    cloud = [hashlib.sha256(next(store.glob(f"workspaces/*/captures/*/sources/{sid}/original")).read_bytes()).hexdigest()
             for sid in result["storageKeysHash"]]
    assert result["localHashes"] == result["serverHashes"] == result["desktopHashes"] == cloud
    assert result["localHashes"][0] == result["expectedFirst"]
    assert result["puts"] == 4  # p1, p2 (dropped), p2 again, p3: never a full re-upload
    assert result["bSeesCapture"] is False and result["bFetch"] == "NOT_FOUND"
