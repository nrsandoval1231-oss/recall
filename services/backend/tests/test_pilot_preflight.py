"""The pilot gate accepts provider settings only beside complete owner review evidence."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "infra" / "check-pilot-secrets.sh"
AI_KEYS = (
    "AI_PROVIDER",
    "AI_MODEL_ID",
    "AI_API_KEY",
    "AI_INPUT_USD_PER_MTOK",
    "AI_OUTPUT_USD_PER_MTOK",
    "RECALL_AI_DAILY_BUDGET_USD",
    "RECALL_AI_MONTHLY_BUDGET_USD",
)


def _env_text(values: dict[str, str]) -> str:
    return "".join(f"{key}={value}\n" for key, value in values.items())


def _base_files(directory: Path) -> None:
    api = {
        "RECALL_ENV": "production",
        "DATABASE_URL": "postgresql://recall_app:test@db.internal/recall",
        "RECALL_AUTH_ISSUER": "https://auth.test.invalid/issuer",
        "RECALL_AUTH_JWKS_URL": "https://auth.test.invalid/jwks",
        "RECALL_SIGNING_SECRET": "synthetic-signing-secret-not-real",
        "SUPABASE_URL": "https://storage.test.invalid",
        "SUPABASE_SERVICE_ROLE_KEY": "synthetic-storage-key-not-real",
        "RECALL_DEVICE_PAIRING_ENABLED": "false",
    }
    worker = {
        "RECALL_ENV": "production",
        "DATABASE_URL": "postgresql://recall_app:test@db.internal/recall",
        "RECALL_WORKER_DATABASE_URL": "postgresql://recall_worker:test@db.internal/recall",
        "RECALL_AUTH_ISSUER": api["RECALL_AUTH_ISSUER"],
        "RECALL_AUTH_JWKS_URL": api["RECALL_AUTH_JWKS_URL"],
        "RECALL_SIGNING_SECRET": api["RECALL_SIGNING_SECRET"],
        "SUPABASE_URL": api["SUPABASE_URL"],
        "SUPABASE_SERVICE_ROLE_KEY": api["SUPABASE_SERVICE_ROLE_KEY"],
    }
    (directory / "api.env").write_text(_env_text(api), encoding="utf-8")
    (directory / "worker.env").write_text(_env_text(worker), encoding="utf-8")
    (directory / "pilot.https.env").write_text("RECALL_PILOT_HOSTNAME=pilot.recall.test.invalid\n", encoding="utf-8")


def _review_record(**overrides: str) -> dict[str, str]:
    record = {
        "RECALL_PILOT_ACTIVATION_APPROVED": "true",
        "RECALL_PILOT_NEW_PRODUCTION_APPROVAL": "approved",
        "RECALL_PILOT_ACTIVATION_REVIEW_ID": "PAIR-01-REVIEW-TEST-001",
        "RECALL_PILOT_ACTIVATION_REVIEWED_AT": "2026-10-08",
        "RECALL_PILOT_ACTIVATION_OWNER_ID": "00000000-0000-4000-8000-000000000001",
        "RECALL_PILOT_ACTIVATION_WORKSPACE_ID": "00000000-0000-4000-8000-000000000002",
        "RECALL_PILOT_ACTIVATION_DEVICE_ID": "00000000-0000-4000-8000-000000000003",
        "RECALL_PILOT_ACTIVATION_VAULT_ID": "00000000-0000-4000-8000-000000000004",
        "RECALL_PILOT_ACTIVATION_SCOPE": "inference-only",
        "RECALL_PILOT_ACTIVATION_CONSENT_VERSION": "claude-photo-v1",
        "RECALL_PILOT_ACTIVATION_PROVIDER_ACCOUNT": "reviewed-anthropic-account-ref",
        "RECALL_PILOT_ACTIVATION_PROVIDER": "anthropic",
        "RECALL_PILOT_ACTIVATION_MODEL_ID": "claude-reviewed-model",
        "RECALL_PILOT_ACTIVATION_INPUT_USD_PER_MTOK": "2.00",
        "RECALL_PILOT_ACTIVATION_OUTPUT_USD_PER_MTOK": "10.00",
        "RECALL_PILOT_ACTIVATION_DAILY_BUDGET_USD": "8.00",
        "RECALL_PILOT_ACTIVATION_MONTHLY_BUDGET_USD": "80.00",
        "RECALL_PILOT_PAIRING_ORIGIN": "https://pilot.recall.test.invalid",
    }
    record.update(overrides)
    return record


def _activate(directory: Path, *, ai_overrides: dict[str, str] | None = None) -> None:
    api_path, worker_path = directory / "api.env", directory / "worker.env"
    api_lines = api_path.read_text(encoding="utf-8").splitlines()
    api = dict(line.split("=", 1) for line in api_lines)
    api["RECALL_DEVICE_PAIRING_ENABLED"] = "true"
    ai = {
        "AI_PROVIDER": "anthropic",
        "AI_MODEL_ID": "claude-reviewed-model",
        "AI_API_KEY": "synthetic-provider-key-not-real",
        "AI_INPUT_USD_PER_MTOK": "2.00",
        "AI_OUTPUT_USD_PER_MTOK": "10.00",
        "RECALL_AI_DAILY_BUDGET_USD": "8.00",
        "RECALL_AI_MONTHLY_BUDGET_USD": "80.00",
    }
    ai.update(ai_overrides or {})
    api.update(ai)
    worker = dict(line.split("=", 1) for line in worker_path.read_text(encoding="utf-8").splitlines())
    worker.update(ai)
    api_path.write_text(_env_text(api), encoding="utf-8")
    worker_path.write_text(_env_text(worker), encoding="utf-8")
    (directory / "pilot.activation.reviewed.env").write_text(_env_text(_review_record()), encoding="utf-8")


def _run_preflight(directory: Path) -> subprocess.CompletedProcess[str]:
    shell = shutil.which("sh")
    if shell is None and os.name == "nt":
        shell = str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Git" / "usr" / "bin" / "sh.exe")
        if not Path(shell).is_file():
            shell = None
    if shell is None:
        pytest.skip("POSIX sh is required to execute the pilot preflight")
    env = {**os.environ, "LC_ALL": "C", "PATH": f"{Path(shell).parent}{os.pathsep}{os.environ.get('PATH', '')}"}
    return subprocess.run(
        [shell, str(SCRIPT)],
        cwd=directory,
        env=env,
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
    )


def test_default_preflight_passes_without_ai_or_pairing(tmp_path: Path) -> None:
    _base_files(tmp_path)

    result = _run_preflight(tmp_path)

    assert result.returncode == 0, result.stderr
    assert "AI/pairing activation requires a complete owner-reviewed record" in result.stdout


def test_ai_and_pairing_require_review_record_by_default(tmp_path: Path) -> None:
    _base_files(tmp_path)
    _activate(tmp_path)
    (tmp_path / "pilot.activation.reviewed.env").unlink()

    result = _run_preflight(tmp_path)

    assert result.returncode == 1
    assert "pilot.activation.reviewed.env" in result.stderr
    assert "synthetic-provider-key-not-real" not in result.stdout + result.stderr


def test_complete_reviewed_bounded_activation_passes(tmp_path: Path) -> None:
    _base_files(tmp_path)
    _activate(tmp_path)

    result = _run_preflight(tmp_path)

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "record_override,ai_override",
    [
        ({"RECALL_PILOT_ACTIVATION_SCOPE": "capture-and-inference"}, None),
        ({"RECALL_PILOT_NEW_PRODUCTION_APPROVAL": ""}, None),
        ({"RECALL_PILOT_ACTIVATION_MODEL_ID": "another-model"}, None),
        ({"RECALL_PILOT_ACTIVATION_DAILY_BUDGET_USD": "9.00"}, None),
        ({"RECALL_PILOT_PAIRING_ORIGIN": "https://other.test.invalid"}, None),
        ({}, {"RECALL_AI_MONTHLY_BUDGET_USD": "81.00"}),
        ({}, {"AI_API_KEY": ""}),
    ],
    ids=[
        "wrong-scope",
        "no-new-owner-approval",
        "wrong-model",
        "wrong-daily-budget",
        "wrong-origin",
        "wrong-monthly-budget",
        "missing-key",
    ],
)
def test_incomplete_or_unbounded_activation_is_rejected(
    tmp_path: Path, record_override: dict[str, str], ai_override: dict[str, str] | None
) -> None:
    _base_files(tmp_path)
    _activate(tmp_path, ai_overrides=ai_override)
    record = _review_record(**record_override)
    (tmp_path / "pilot.activation.reviewed.env").write_text(_env_text(record), encoding="utf-8")

    result = _run_preflight(tmp_path)

    assert result.returncode == 1
