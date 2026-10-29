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
    "MONOLITH_AI_DAILY_BUDGET_USD",
    "MONOLITH_AI_MONTHLY_BUDGET_USD",
)


def _env_text(values: dict[str, str]) -> str:
    return "".join(f"{key}={value}\n" for key, value in values.items())


def _base_files(directory: Path) -> None:
    api = {
        "MONOLITH_ENV": "production",
        "DATABASE_URL": "postgresql://recall_app:test@db.internal/recall",
        "MONOLITH_AUTH_ISSUER": "https://auth.test.invalid/issuer",
        "MONOLITH_AUTH_JWKS_URL": "https://auth.test.invalid/jwks",
        "MONOLITH_SIGNING_SECRET": "synthetic-signing-secret-not-real",
        "SUPABASE_URL": "https://storage.test.invalid",
        "SUPABASE_SERVICE_ROLE_KEY": "synthetic-storage-key-not-real",
        "MONOLITH_DEVICE_PAIRING_ENABLED": "false",
    }
    worker = {
        "MONOLITH_ENV": "production",
        "DATABASE_URL": "postgresql://recall_app:test@db.internal/recall",
        "MONOLITH_WORKER_DATABASE_URL": "postgresql://recall_worker:test@db.internal/recall",
        "MONOLITH_AUTH_ISSUER": api["MONOLITH_AUTH_ISSUER"],
        "MONOLITH_AUTH_JWKS_URL": api["MONOLITH_AUTH_JWKS_URL"],
        "MONOLITH_SIGNING_SECRET": api["MONOLITH_SIGNING_SECRET"],
        "SUPABASE_URL": api["SUPABASE_URL"],
        "SUPABASE_SERVICE_ROLE_KEY": api["SUPABASE_SERVICE_ROLE_KEY"],
    }
    (directory / "api.env").write_text(_env_text(api), encoding="utf-8")
    (directory / "worker.env").write_text(_env_text(worker), encoding="utf-8")
    (directory / "pilot.https.env").write_text(
        "MONOLITH_PILOT_HOSTNAME=pilot.monolith.test.invalid\n", encoding="utf-8"
    )


def _review_record(**overrides: str) -> dict[str, str]:
    record = {
        "MONOLITH_PILOT_ACTIVATION_APPROVED": "true",
        "MONOLITH_PILOT_NEW_PRODUCTION_APPROVAL": "approved",
        "MONOLITH_PILOT_ACTIVATION_REVIEW_ID": "PAIR-01-REVIEW-TEST-001",
        "MONOLITH_PILOT_ACTIVATION_REVIEWED_AT": "2026-10-08",
        "MONOLITH_PILOT_ACTIVATION_OWNER_ID": "00000000-0000-4000-8000-000000000001",
        "MONOLITH_PILOT_ACTIVATION_WORKSPACE_ID": "00000000-0000-4000-8000-000000000002",
        "MONOLITH_PILOT_ACTIVATION_DEVICE_ID": "00000000-0000-4000-8000-000000000003",
        "MONOLITH_PILOT_ACTIVATION_VAULT_ID": "00000000-0000-4000-8000-000000000004",
        "MONOLITH_PILOT_ACTIVATION_SCOPE": "inference-only",
        "MONOLITH_PILOT_ACTIVATION_CONSENT_VERSION": "claude-photo-v1",
        "MONOLITH_PILOT_ACTIVATION_PROVIDER_ACCOUNT": "reviewed-anthropic-account-ref",
        "MONOLITH_PILOT_ACTIVATION_PROVIDER": "anthropic",
        "MONOLITH_PILOT_ACTIVATION_MODEL_ID": "claude-reviewed-model",
        "MONOLITH_PILOT_ACTIVATION_INPUT_USD_PER_MTOK": "2.00",
        "MONOLITH_PILOT_ACTIVATION_OUTPUT_USD_PER_MTOK": "10.00",
        "MONOLITH_PILOT_ACTIVATION_DAILY_BUDGET_USD": "8.00",
        "MONOLITH_PILOT_ACTIVATION_MONTHLY_BUDGET_USD": "80.00",
        "MONOLITH_PILOT_PAIRING_ORIGIN": "https://pilot.monolith.test.invalid",
    }
    record.update(overrides)
    return record


def _activate(directory: Path, *, ai_overrides: dict[str, str] | None = None) -> None:
    api_path, worker_path = directory / "api.env", directory / "worker.env"
    api_lines = api_path.read_text(encoding="utf-8").splitlines()
    api = dict(line.split("=", 1) for line in api_lines)
    api["MONOLITH_DEVICE_PAIRING_ENABLED"] = "true"
    ai = {
        "AI_PROVIDER": "anthropic",
        "AI_MODEL_ID": "claude-reviewed-model",
        "AI_API_KEY": "synthetic-provider-key-not-real",
        "AI_INPUT_USD_PER_MTOK": "2.00",
        "AI_OUTPUT_USD_PER_MTOK": "10.00",
        "MONOLITH_AI_DAILY_BUDGET_USD": "8.00",
        "MONOLITH_AI_MONTHLY_BUDGET_USD": "80.00",
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


def test_legacy_recall_prefixed_env_files_still_pass(tmp_path: Path) -> None:
    """Env files written before the Recall to Monolith rename keep their RECALL_* keys."""
    _base_files(tmp_path)
    for name in ("api.env", "worker.env", "pilot.https.env"):
        path = tmp_path / name
        path.write_text(path.read_text(encoding="utf-8").replace("MONOLITH_", "RECALL_"), encoding="utf-8")

    result = _run_preflight(tmp_path)

    assert result.returncode == 0, result.stderr


def test_legacy_recall_prefixed_files_with_missing_values_still_fail(tmp_path: Path) -> None:
    _base_files(tmp_path)
    for name in ("api.env", "worker.env", "pilot.https.env"):
        path = tmp_path / name
        path.write_text(path.read_text(encoding="utf-8").replace("MONOLITH_", "RECALL_"), encoding="utf-8")
    api = tmp_path / "api.env"
    api.write_text(
        api.read_text(encoding="utf-8").replace(
            "RECALL_SIGNING_SECRET=synthetic-signing-secret-not-real", "RECALL_SIGNING_SECRET="
        ),
        encoding="utf-8",
    )

    result = _run_preflight(tmp_path)

    assert result.returncode == 1
    assert "MONOLITH_SIGNING_SECRET" in result.stderr


def test_an_empty_new_name_is_set_and_is_not_replaced_by_the_legacy_name(tmp_path: Path) -> None:
    """Same rule as the other readers: present-but-empty counts as set."""
    _base_files(tmp_path)
    api = tmp_path / "api.env"
    text = api.read_text(encoding="utf-8").replace(
        "MONOLITH_SIGNING_SECRET=synthetic-signing-secret-not-real", "MONOLITH_SIGNING_SECRET="
    )
    api.write_text(text + "RECALL_SIGNING_SECRET=synthetic-signing-secret-not-real\n", encoding="utf-8")

    result = _run_preflight(tmp_path)

    assert result.returncode == 1
    assert "MONOLITH_SIGNING_SECRET" in result.stderr


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
        ({"MONOLITH_PILOT_ACTIVATION_SCOPE": "capture-and-inference"}, None),
        ({"MONOLITH_PILOT_NEW_PRODUCTION_APPROVAL": ""}, None),
        ({"MONOLITH_PILOT_ACTIVATION_MODEL_ID": "another-model"}, None),
        ({"MONOLITH_PILOT_ACTIVATION_DAILY_BUDGET_USD": "9.00"}, None),
        ({"MONOLITH_PILOT_PAIRING_ORIGIN": "https://other.test.invalid"}, None),
        ({}, {"MONOLITH_AI_MONTHLY_BUDGET_USD": "81.00"}),
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
