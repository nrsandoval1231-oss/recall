"""Backward compatibility for the pre-rename RECALL_* environment variable names.

Rule used everywhere (settings, envcompat, the operator scripts, check-pilot-secrets.sh, the desktop
build): the new MONOLITH_* name always wins, across every source; the legacy RECALL_* name is used only
when the new name is not set at all. A variable that is set, even to the empty string, counts as set.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from monolith.config import Settings
from monolith.envcompat import getenv, legacy_name, require_env

REPO_ROOT = Path(__file__).resolve().parents[3]
REQUIRED = {
    "DATABASE_URL": "postgresql://recall@example.test/recall",
    "MONOLITH_AUTH_ISSUER": "https://issuer.example.test",
    "MONOLITH_AUTH_JWKS_URL": "https://issuer.example.test/.well-known/jwks.json",
    "MONOLITH_SIGNING_SECRET": "s" * 32,
}


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for key in list(os.environ):
        if key.startswith(("MONOLITH_", "RECALL_")):
            monkeypatch.delenv(key)
    for key, value in REQUIRED.items():
        monkeypatch.setenv(key, value)
    monkeypatch.chdir(tmp_path)  # no stray .env


def _settings(env_file: Path | None = None) -> Settings:
    return Settings(_env_file=env_file)  # type: ignore[call-arg]


def _dotenv(tmp_path: Path, **values: str) -> Path:
    path = tmp_path / "test.env"
    path.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")
    return path


def test_legacy_name_maps_only_prefixed_names() -> None:
    assert legacy_name("MONOLITH_AUTH_ISSUER") == "RECALL_AUTH_ISSUER"
    assert legacy_name("DATABASE_URL") is None


def test_field_aliases_are_the_new_names_only() -> None:
    alias = Settings.model_fields["local_audio_organization_enabled"].validation_alias
    assert alias == "MONOLITH_LOCAL_AUDIO_ORGANIZATION_ENABLED"


def test_settings_accept_the_new_names() -> None:
    assert _settings().auth_issuer == "https://issuer.example.test"


def test_settings_fall_back_to_legacy_recall_names(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MONOLITH_AUTH_ISSUER")
    monkeypatch.delenv("MONOLITH_SIGNING_SECRET")
    monkeypatch.setenv("RECALL_AUTH_ISSUER", "https://legacy-issuer.example.test")
    monkeypatch.setenv("RECALL_SIGNING_SECRET", "l" * 32)
    monkeypatch.setenv("RECALL_MAX_PROCESSING_ATTEMPTS", "5")
    monkeypatch.setenv("RECALL_CORS_ORIGINS", "http://tauri.localhost")

    settings = _settings()

    assert settings.auth_issuer == "https://legacy-issuer.example.test"
    assert settings.signing_secret == "l" * 32
    assert settings.max_processing_attempts == 5
    assert settings.cors_allow_origins == ["http://tauri.localhost"]


def test_new_name_wins_when_both_are_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RECALL_AUTH_ISSUER", "https://legacy-issuer.example.test")
    monkeypatch.setenv("MONOLITH_MAX_PROCESSING_ATTEMPTS", "2")
    monkeypatch.setenv("RECALL_MAX_PROCESSING_ATTEMPTS", "9")

    settings = _settings()

    assert settings.auth_issuer == "https://issuer.example.test"
    assert settings.max_processing_attempts == 2


def test_dotenv_new_name_beats_process_legacy_name(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("RECALL_MAX_PROCESSING_ATTEMPTS", "9")
    env_file = _dotenv(tmp_path, MONOLITH_MAX_PROCESSING_ATTEMPTS="2")

    assert _settings(env_file).max_processing_attempts == 2


def test_source_priority_is_process_new_then_dotenv_new_then_process_legacy_then_dotenv_legacy(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    env_file = _dotenv(tmp_path, MONOLITH_MAX_PROCESSING_ATTEMPTS="2", RECALL_MAX_PROCESSING_ATTEMPTS="3")
    monkeypatch.setenv("RECALL_MAX_PROCESSING_ATTEMPTS", "4")
    assert _settings(env_file).max_processing_attempts == 2
    monkeypatch.setenv("MONOLITH_MAX_PROCESSING_ATTEMPTS", "1")
    assert _settings(env_file).max_processing_attempts == 1  # a process value beats the same name in .env
    monkeypatch.delenv("MONOLITH_MAX_PROCESSING_ATTEMPTS")
    legacy_only = _dotenv(tmp_path, RECALL_MAX_PROCESSING_ATTEMPTS="3")
    assert _settings(legacy_only).max_processing_attempts == 4  # process RECALL_ beats .env RECALL_
    monkeypatch.delenv("RECALL_MAX_PROCESSING_ATTEMPTS")
    assert _settings(legacy_only).max_processing_attempts == 3


def test_a_set_but_empty_value_counts_as_set(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("RECALL_EMBEDDING_MODEL_ID", "legacy-model")
    monkeypatch.setenv("MONOLITH_EMBEDDING_MODEL_ID", "")
    assert _settings().embedding_model_id == ""
    monkeypatch.delenv("MONOLITH_EMBEDDING_MODEL_ID")
    assert _settings().embedding_model_id == "legacy-model"
    monkeypatch.setenv("RECALL_EMBEDDING_MODEL_ID", "")
    assert _settings().embedding_model_id == ""  # unchanged pre-rename behaviour: empty is a value
    monkeypatch.delenv("RECALL_EMBEDDING_MODEL_ID")
    env_file = _dotenv(tmp_path, MONOLITH_EMBEDDING_MODEL_ID="", RECALL_EMBEDDING_MODEL_ID="legacy-model")
    assert _settings(env_file).embedding_model_id == ""


def test_legacy_validation_errors_still_apply(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RECALL_MAX_PROCESSING_ATTEMPTS", "99")

    with pytest.raises(ValueError, match="MAX_PROCESSING_ATTEMPTS"):
        _settings()


def test_getenv_and_require_env_fall_back_and_treat_empty_as_set(monkeypatch: pytest.MonkeyPatch) -> None:
    assert getenv("MONOLITH_BACKUP_DATABASE_URL") is None
    assert getenv("MONOLITH_BACKUP_DATABASE_URL", "fallback") == "fallback"
    with pytest.raises(KeyError):
        require_env("MONOLITH_BACKUP_DATABASE_URL")

    monkeypatch.setenv("RECALL_BACKUP_DATABASE_URL", "postgresql://legacy.example.test/x")
    assert getenv("MONOLITH_BACKUP_DATABASE_URL") == "postgresql://legacy.example.test/x"
    assert require_env("MONOLITH_BACKUP_DATABASE_URL") == "postgresql://legacy.example.test/x"

    monkeypatch.setenv("MONOLITH_BACKUP_DATABASE_URL", "postgresql://new.example.test/x")
    assert getenv("MONOLITH_BACKUP_DATABASE_URL") == "postgresql://new.example.test/x"

    monkeypatch.setenv("MONOLITH_BACKUP_DATABASE_URL", "")
    assert getenv("MONOLITH_BACKUP_DATABASE_URL") == ""


def _inline_promotion_loop(script: str) -> str:
    """The real two-line promotion loop copied into each operator script."""
    source = (REPO_ROOT / "infra/do-inference/ops" / script).read_text(encoding="utf-8")
    match = re.search(r"^for _legacy in .*\n    os\.environ\.setdefault.*$", source, re.MULTILINE)
    assert match is not None, script
    return match.group(0)


@pytest.mark.parametrize(
    "script",
    [
        "audit-database.py",
        "backup.py",
        "preflight.py",
        "restore.py",
        "run-bootstrap.py",
        "run-migrations.py",
        "start-api.py",
    ],
)
def test_operator_script_promotion_loop_follows_the_same_rule(script: str) -> None:
    code = _inline_promotion_loop(script)
    environ = {
        "RECALL_ONLY": "legacy",
        "RECALL_BOTH": "legacy",
        "MONOLITH_BOTH": "new",
        "RECALL_EMPTY_NEW": "legacy",
        "MONOLITH_EMPTY_NEW": "",
    }
    exec(compile(code, script, "exec"), {"os": SimpleNamespace(environ=environ)})  # noqa: S102 -- repo text
    assert environ["MONOLITH_ONLY"] == "legacy"
    assert environ["MONOLITH_BOTH"] == "new"
    assert environ["MONOLITH_EMPTY_NEW"] == ""


def test_local_storage_default_is_monolith_unless_only_the_legacy_dir_exists(tmp_path: Path) -> None:
    assert _settings().local_storage_dir == Path(".monolith-storage")

    (tmp_path / ".recall-storage").mkdir()
    assert _settings().local_storage_dir == Path(".recall-storage")

    (tmp_path / ".monolith-storage").mkdir()
    assert _settings().local_storage_dir == Path(".monolith-storage")


def test_explicit_storage_dir_wins_over_both_defaults(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    (tmp_path / ".recall-storage").mkdir()
    monkeypatch.setenv("RECALL_LOCAL_STORAGE_DIR", "legacy-explicit")
    assert _settings().local_storage_dir == Path("legacy-explicit")
    monkeypatch.setenv("MONOLITH_LOCAL_STORAGE_DIR", "explicit")
    assert _settings().local_storage_dir == Path("explicit")


def test_container_storage_default_preserves_legacy_deployment_override(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    dockerfile = (REPO_ROOT / "services/backend/Dockerfile").read_text(encoding="utf-8")
    assert "RECALL_LOCAL_STORAGE_DIR=/app/storage" in dockerfile
    assert "MONOLITH_LOCAL_STORAGE_DIR=/app/storage" not in dockerfile

    existing_dir = tmp_path / "legacy-storage"
    existing_dir.mkdir()
    existing_file = existing_dir / "stored-object.bin"
    existing_file.write_bytes(b"preserve existing user data")

    # Docker runtime environment overrides the image's RECALL_* default at the same
    # variable name, so the application's compatibility source sees the deployment path.
    monkeypatch.setenv("RECALL_LOCAL_STORAGE_DIR", str(existing_dir))
    settings = _settings()
    assert settings.local_storage_dir == existing_dir
    assert (settings.local_storage_dir / existing_file.name).read_bytes() == b"preserve existing user data"

    # An explicitly configured new name remains authoritative over the legacy name.
    monkeypatch.setenv("MONOLITH_LOCAL_STORAGE_DIR", "/new/explicit/storage")
    assert _settings().local_storage_dir == Path("/new/explicit/storage")
