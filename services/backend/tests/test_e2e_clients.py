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
    return jwt.encode(
        {"sub": str(user), "iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + 3600}, SECRET, "HS256"
    )


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
        **os.environ,
        "DATABASE_URL": app_dsn,
        "RECALL_AUTH_ISSUER": ISSUER,
        "RECALL_AUTH_JWT_SECRET": SECRET,
        "RECALL_SIGNING_SECRET": "e2e-signing-secret-0123456789abcdefghijkl",
        "RECALL_LOCAL_STORAGE_DIR": str(store),
        "RECALL_CAPTURE_SCHEMA_PATH": str(REPO_ROOT / "packages/contracts/capture.schema.json"),
    }
    server = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "recall.api.app:app_factory",
            "--factory",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        env=env,
        cwd=REPO_ROOT / "services/backend",
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
            [str(tsx), "tests/e2e/rcl001.e2e.ts"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=120,
            env={
                **os.environ,
                "E2E_API_BASE": f"http://127.0.0.1:{port}",
                "E2E_TOKEN_A": _token(uuid.uuid4()),
                "E2E_TOKEN_B": _token(uuid.uuid4()),
            },
        )
        assert out.returncode == 0, out.stderr + out.stdout
        result = json.loads(
            next(ln for ln in out.stdout.splitlines() if ln.startswith("E2E_RESULT ")).removeprefix("E2E_RESULT ")
        )
    finally:
        server.terminate()
        server.wait(10)

    assert result["interruptedState"] == "NETWORK"  # the first attempt really was interrupted
    assert result["finalPhase"] == "finalized" and result["serverStatus"] == "stored"
    assert result["capturesForOperation"] == 1 and result["ordinals"] == [1, 2, 3]
    cloud = [
        hashlib.sha256(next(store.glob(f"workspaces/*/captures/*/sources/{sid}/original")).read_bytes()).hexdigest()
        for sid in result["storageKeysHash"]
    ]
    assert result["localHashes"] == result["serverHashes"] == result["desktopHashes"] == cloud
    assert result["localHashes"][0] == result["expectedFirst"]
    assert result["puts"] == 4  # p1, p2 (dropped), p2 again, p3: never a full re-upload
    assert result["bSeesCapture"] is False and result["bFetch"] == "NOT_FOUND"


def test_rcl002_phone_upload_worker_reading_and_desktop_ask(pg_cluster: PgCluster, tmp_path: Path) -> None:
    """Real server process + real worker + TypeScript clients. The MODEL is the labelled synthetic fake."""
    from fake_provider import FakeProvider
    from recall.config import Settings
    from recall.ingestion.worker import Worker
    from recall.storage.local import LocalObjectStore

    tsx = REPO_ROOT / "node_modules/.bin/tsx"
    if not tsx.exists() or not shutil.which("node"):
        pytest.skip("run `npm install` at the repo root to enable the TypeScript e2e")
    owner_dsn, app_dsn = make_database(pg_cluster)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    store = tmp_path / "objects"
    ai_env = {
        "AI_PROVIDER": "anthropic",
        "AI_MODEL_ID": "fake-model",
        "AI_API_KEY": "test-key-not-real",
        "AI_INPUT_USD_PER_MTOK": "4",
        "AI_OUTPUT_USD_PER_MTOK": "20",
        "RECALL_AI_DAILY_BUDGET_USD": "10",
        "RECALL_AI_MONTHLY_BUDGET_USD": "100",
    }
    env = {
        **os.environ,
        **ai_env,
        "DATABASE_URL": app_dsn,
        "RECALL_AUTH_ISSUER": ISSUER,
        "RECALL_AUTH_JWT_SECRET": SECRET,
        "RECALL_SIGNING_SECRET": "e2e-signing-secret-0123456789abcdefghijkl",
        "RECALL_LOCAL_STORAGE_DIR": str(store),
        "RECALL_CAPTURE_SCHEMA_PATH": str(REPO_ROOT / "packages/contracts/capture.schema.json"),
        "PYTHONPATH": str(Path(__file__).parent),
    }
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "e2e_app:make", "--factory", "--port", str(port), "--log-level", "warning"],
        env=env,
        cwd=REPO_ROOT / "services/backend",
    )
    token = _token(uuid.uuid4())
    base = f"http://127.0.0.1:{port}"

    def node(phase: str) -> dict:
        out = subprocess.run(
            [str(tsx), "tests/e2e/rcl002.e2e.ts"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=120,
            env={
                **os.environ,
                "E2E_API_BASE": base,
                "E2E_TOKEN": token,
                "E2E_PHASE": phase,
                "E2E_HINT": "e2e solar note",
                "E2E_ROOT": str(tmp_path / "phone"),
            },
        )
        assert out.returncode == 0, out.stderr + out.stdout
        line = next(ln for ln in out.stdout.splitlines() if ln.startswith("E2E_RESULT "))
        return json.loads(line.removeprefix("E2E_RESULT "))  # type: ignore[no-any-return]

    try:
        for _ in range(100):
            try:
                if httpx.get(f"{base}/readyz", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.1)
        headers = {"Authorization": f"Bearer {token}"}
        assert httpx.put(f"{base}/v1/settings/ai", json={"enabled": True}, headers=headers).status_code == 200
        uploaded = node("upload")
        assert uploaded["phase"] == "finalized" and uploaded["processing"]["state"] == "queued"

        settings = Settings(
            database_url=app_dsn,
            auth_issuer=ISSUER,
            auth_jwt_secret=SECRET,
            signing_secret="e2e-signing-secret-0123456789abcdefghijkl",
            local_storage_dir=store,
            capture_schema_path=REPO_ROOT / "packages/contracts/capture.schema.json",
            **{
                k.lower(): v
                for k, v in {
                    "ai_provider": "anthropic",
                    "ai_model_id": "fake-model",
                    "ai_api_key": "k",
                    "ai_input_usd_per_mtok": 4,
                    "ai_output_usd_per_mtok": 20,
                    "ai_daily_budget_usd": 10,
                    "ai_monthly_budget_usd": 100,
                }.items()
            },
        )
        fake = FakeProvider()
        fake.truth["e2e solar note"] = [
            "Coffee with Sarah - she introduced me to Dev Okafor",
            "Dev runs a small solar install company",
        ]
        worker = Worker(
            owner_dsn.replace("recall_owner@", "recall_worker_login@"), LocalObjectStore(store), settings, fake
        )
        worker.open()
        try:
            assert worker.run_once() is not None
        finally:
            worker.close()

        asked = node("ask")
    finally:
        server.terminate()
        server.wait(10)

    assert asked["captureStatus"] == "ready"
    assert asked["memoryPages"][1] == "Dev runs a small solar install company"
    assert "Machine reading" in asked["label"]
    assert asked["answerStatus"] == "answered" and all(s["citation_ids"] for s in asked["sentences"])
    assert asked["citedCapture"] == uploaded["captureId"]
    # the cited original, fetched by the desktop client, is byte-identical to what the phone saved
    assert asked["citedHash"] == asked["serverHash"] == uploaded["localHashes"][asked["citedPage"] - 1]
    assert asked["unrelatedStatus"] == "insufficient_evidence" and asked["unrelatedReason"] == "NO_EVIDENCE"
