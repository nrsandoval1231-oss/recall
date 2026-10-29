"""The export janitor expires abandoned plaintext exports in both the current and pre-rename spool."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from monolith.domain import export as export_domain

DAY = 24 * 60 * 60


def _make(path: Path, age_seconds: float) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"PK synthetic")
    stamp = time.time() - age_seconds
    os.utime(path, (stamp, stamp))
    return path


def test_janitor_expires_old_exports_in_current_and_legacy_spool(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    current, legacy = tmp_path / "monolith-private-exports", tmp_path / "recall-private-exports"
    monkeypatch.setattr(export_domain, "EXPORT_TEMP_ROOT", current)
    monkeypatch.setattr(export_domain, "LEGACY_EXPORT_TEMP_ROOT", legacy)
    old_new = _make(current / "monolith-export-old.zip", 2 * DAY)
    fresh_new = _make(current / "monolith-export-fresh.zip", 60)
    old_legacy = _make(legacy / "recall-export-old.zip", 2 * DAY)
    fresh_legacy = _make(legacy / "recall-export-fresh.zip", 60)
    unrelated = _make(legacy / "other-file.zip", 2 * DAY)
    wrong_prefix = _make(current / "recall-export-in-new-dir.zip", 2 * DAY)

    export_domain.cleanup_export_files()

    assert not old_new.exists() and not old_legacy.exists()
    assert fresh_new.exists() and fresh_legacy.exists()
    assert unrelated.exists() and wrong_prefix.exists()


def test_janitor_never_creates_the_legacy_directory(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    legacy = tmp_path / "recall-private-exports"
    monkeypatch.setattr(export_domain, "EXPORT_TEMP_ROOT", tmp_path / "monolith-private-exports")
    monkeypatch.setattr(export_domain, "LEGACY_EXPORT_TEMP_ROOT", legacy)

    export_domain.cleanup_export_files()

    assert (tmp_path / "monolith-private-exports").is_dir()
    assert not legacy.exists()


def test_janitor_ignores_a_symlinked_legacy_directory(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    victim = _make(outside / "recall-export-victim.zip", 2 * DAY)
    legacy = tmp_path / "recall-private-exports"
    try:
        legacy.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symbolic links are unavailable")
    monkeypatch.setattr(export_domain, "EXPORT_TEMP_ROOT", tmp_path / "monolith-private-exports")
    monkeypatch.setattr(export_domain, "LEGACY_EXPORT_TEMP_ROOT", legacy)

    export_domain.cleanup_export_files()

    assert victim.exists()
