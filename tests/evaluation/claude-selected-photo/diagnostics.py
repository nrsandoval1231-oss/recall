from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from recall.ingestion.local_reading import (
    validate_selected_extraction as _offline_validator,
)
from recall.ingestion.validate import InvalidExtraction

EVAL_DIR = Path(__file__).resolve().parent
MAX_RAW_BYTES = 900_000


def default_diagnostic_dir() -> Path:
    return (
        EVAL_DIR.parents[2]
        / ".recall-storage"
        / "claude-selected-photo-eval"
        / "diagnostics"
    )


def _allowlisted_fixture(case_id: str, fixture_sha256: str) -> bool:
    manifest = json.loads((EVAL_DIR / "manifest.json").read_text(encoding="utf-8"))
    return manifest.get("synthetic_only") is True and any(
        case["id"] == case_id
        and case["classification"] == "synthetic_font_rendered_pipeline_smoke"
        and case["sha256"] == fixture_sha256
        and (EVAL_DIR / case["path"]).resolve().parent == EVAL_DIR.resolve()
        and hashlib.sha256((EVAL_DIR / case["path"]).read_bytes()).hexdigest()
        == fixture_sha256
        for case in manifest["cases"]
    )


def capture_raw(
    *,
    case_id: str,
    fixture_sha256: str,
    raw_output: str,
    capture_id: str,
    fingerprint: str,
    pages: dict[str, int],
    root: Path | None = None,
) -> Path:
    """Opt-in test-harness capture, restricted to fixed synthetic image fixtures."""
    if not _allowlisted_fixture(case_id, fixture_sha256):
        raise ValueError("diagnostic fixture is not allowlisted")
    encoded = raw_output.encode("utf-8", errors="strict")
    if len(encoded) > MAX_RAW_BYTES:
        raise ValueError("diagnostic output exceeds bound")
    target_dir = root or default_diagnostic_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{case_id}.json"
    record = {
        "schema_version": "1.0",
        "case_id": case_id,
        "fixture_sha256": fixture_sha256,
        "capture_id": capture_id,
        "fingerprint": fingerprint,
        "pages": pages,
        "raw_sha256": hashlib.sha256(encoded).hexdigest(),
        "raw_output": raw_output,
    }
    payload = json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    fd, temporary = tempfile.mkstemp(
        prefix=f".{case_id}-", suffix=".tmp", dir=target_dir
    )
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        # Hard-link creation is atomic and fails if an immutable case record already exists.
        os.link(temporary, target)
    except FileExistsError as exc:
        raise ValueError("diagnostic record already exists") from exc
    finally:
        Path(temporary).unlink(missing_ok=True)
    return target


def capture_validator(
    original: Callable[..., Any], *, case_id: str, fixture_sha256: str, root: Path
):
    """Wrap the selected validator; capture failures never alter its result or exception."""
    paths: list[Path] = []
    failures: list[str] = []

    def wrapped(
        raw: str,
        *,
        schema: dict[str, Any],
        capture_id: str,
        fingerprint: str,
        pages: dict[str, int],
    ) -> Any:
        try:
            paths.append(
                capture_raw(
                    case_id=case_id,
                    fixture_sha256=fixture_sha256,
                    raw_output=raw,
                    capture_id=capture_id,
                    fingerprint=fingerprint,
                    pages=pages,
                    root=root,
                )
            )
        except (OSError, ValueError, UnicodeError, KeyError, TypeError) as exc:
            failures.append(type(exc).__name__)
        return original(
            raw,
            schema=schema,
            capture_id=capture_id,
            fingerprint=fingerprint,
            pages=pages,
        )

    return wrapped, paths, failures


def replay(path: Path, schema: dict[str, Any]) -> dict[str, Any]:
    """Re-run current deterministic validation over a retained synthetic raw output."""
    record = json.loads(path.read_text(encoding="utf-8"))
    if not _allowlisted_fixture(record["case_id"], record["fixture_sha256"]):
        raise ValueError("diagnostic fixture is not allowlisted")
    raw = record["raw_output"]
    if hashlib.sha256(raw.encode("utf-8")).hexdigest() != record["raw_sha256"]:
        raise ValueError("diagnostic output hash mismatch")
    try:
        _offline_validator(
            raw,
            schema=schema,
            capture_id=record["capture_id"],
            fingerprint=record["fingerprint"],
            pages=record["pages"],
        )
    except InvalidExtraction as exc:
        return {"code": exc.code, "issues": exc.problems}
    return {"code": None, "issues": []}


def replay_to_file(path: Path, schema: dict[str, Any]) -> Path:
    """Persist exact deterministic findings beside an immutable raw diagnostic capture."""
    record = json.loads(path.read_text(encoding="utf-8"))
    findings = replay(path, schema)
    target = path.with_name(f"{record['case_id']}.validation.json")
    fd, temporary = tempfile.mkstemp(
        prefix=f".{record['case_id']}-", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(
                json.dumps(
                    {"raw_sha256": record["raw_sha256"], **findings},
                    separators=(",", ":"),
                ).encode()
            )
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, target)
    except FileExistsError as exc:
        raise ValueError("diagnostic validation record already exists") from exc
    finally:
        Path(temporary).unlink(missing_ok=True)
    return target
