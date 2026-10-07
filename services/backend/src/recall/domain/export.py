"""Bounded, deterministic owner export: canonical history, Markdown and original bytes."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any

from psycopg import sql
from starlette.concurrency import run_in_threadpool

from ..db.database import Database
from ..errors import ApiError, forbidden
from ..storage import ObjectStore
from ..sync.service import json_value

TABLES = (
    "captures",
    "source_objects",
    "memories",
    "memory_revisions",
    "entities",
    "entity_aliases",
    "mentions",
    "claims",
    "claim_revisions",
    "entity_links",
    "actions",
    "memory_overrides",
    "identity_operations",
    "memory_suppressions",
)
MAX_EXPORT_BYTES = 512 * 1024 * 1024
MAX_EXPORT_ROWS = 10000
MAX_CANONICAL_BYTES = 16 * 1024 * 1024
MAX_ORIGINAL_BYTES = 100 * 1024 * 1024
_EXPORT_SLOTS = threading.BoundedSemaphore(2)
EXPORT_TEMP_ROOT = Path(tempfile.gettempdir()) / "recall-private-exports"


def cleanup_export_files() -> None:
    """Remove abandoned plaintext exports after a bounded recovery window."""
    EXPORT_TEMP_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    if EXPORT_TEMP_ROOT.is_symlink():
        raise RuntimeError("Export temporary directory must not be a symbolic link.")
    EXPORT_TEMP_ROOT.chmod(0o700)
    cutoff = time.time() - 24 * 60 * 60
    for path in EXPORT_TEMP_ROOT.glob("recall-export-*.zip"):
        try:
            if not path.is_symlink() and path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
        except FileNotFoundError:
            pass


async def export_janitor(stop: asyncio.Event) -> None:
    """Enforce spool expiry even when no further export requests arrive."""
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
        except TimeoutError:
            try:
                await run_in_threadpool(cleanup_export_files)
            except OSError as error:
                logging.getLogger("recall.export").warning("export cleanup retry: %s", type(error).__name__)


def _write(archive: zipfile.ZipFile, name: str, content: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o600 << 16
    archive.writestr(info, content)


class ExportService:
    def __init__(self, db: Database, store: ObjectStore) -> None:
        self.db, self.store = db, store
        cleanup_export_files()

    def create(self, user_id: uuid.UUID) -> Path:
        if not _EXPORT_SLOTS.acquire(blocking=False):
            raise ApiError("EXPORT_BUSY", "Two exports are already running. Try again shortly.", 429, retryable=True)
        try:
            return self._create(user_id)
        finally:
            _EXPORT_SLOTS.release()

    def _create(self, user_id: uuid.UUID) -> Path:
        cleanup_export_files()
        fd, name = tempfile.mkstemp(prefix="recall-export-", suffix=".zip", dir=EXPORT_TEMP_ROOT)
        import os

        os.close(fd)
        destination = Path(name)
        try:
            with self.db.tx(user_id) as tx, zipfile.ZipFile(destination, "w") as archive:
                snapshot = tx.one(
                    "select sync_clock,(select max(created_at) from change_events where workspace_id=%s) as changed_at "
                    "from workspaces where id=%s",
                    (tx.workspace_id, tx.workspace_id),
                )
                assert snapshot is not None
                metadata = {
                    "schema_version": "0006_portability",
                    "sync_clock": snapshot["sync_clock"],
                    "state_changed_at": json_value(snapshot["changed_at"]),
                }
                document: dict[str, Any] = {
                    "format": "recall.export.v1",
                    "workspace_id": str(tx.workspace_id),
                    "snapshot": metadata,
                }
                rows_used = 0
                metadata_bytes = 0
                for table in TABLES:
                    count_query = sql.SQL(
                        "select count(*) as records,coalesce(sum(octet_length(to_jsonb(t)::text)),0) as bytes "
                        "from {} t where workspace_id=%s"
                    ).format(sql.Identifier(table))
                    bounds = tx.one(count_query.as_string(tx.conn), (tx.workspace_id,))
                    assert bounds is not None
                    metadata_bytes += bounds["bytes"]
                    if rows_used + bounds["records"] > MAX_EXPORT_ROWS or metadata_bytes > MAX_CANONICAL_BYTES:
                        raise ApiError("EXPORT_TOO_LARGE", "Export exceeds the pilot metadata limit.", 413)
                    query = sql.SQL("select * from {} where workspace_id=%s limit %s").format(sql.Identifier(table))
                    records = tx.all(query.as_string(tx.conn), (tx.workspace_id, MAX_EXPORT_ROWS + 1))
                    rows_used += len(records)
                    if rows_used > MAX_EXPORT_ROWS:
                        raise ApiError("EXPORT_TOO_LARGE", "Export exceeds the pilot record limit.", 413)
                    records = [json_value(row) for row in records]
                    # Stable independent of physical row order and execution plan.
                    records.sort(key=lambda row: json.dumps(row, sort_keys=True, ensure_ascii=False))
                    document[table] = records
                total = 0
                original_manifest = []
                unavailable_originals = []
                for source in document["source_objects"]:
                    key = source.pop("storage_key")  # private backend capability never leaves in portable JSON
                    if not source["verified_at"]:
                        unavailable_originals.append({"source_id": source["id"], "reason": "not_verified"})
                        continue
                    digest = hashlib.sha256()
                    size = 0
                    path = f"originals/{uuid.UUID(source['id'])}"
                    info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o600 << 16
                    with archive.open(info, "w") as output:
                        for chunk in self.store.iter_bytes(key):
                            size += len(chunk)
                            total += len(chunk)
                            if total > MAX_EXPORT_BYTES or size > MAX_ORIGINAL_BYTES:
                                raise ApiError("EXPORT_TOO_LARGE", "Export exceeds the pilot byte limit.", 413)
                            digest.update(chunk)
                            output.write(chunk)
                    if digest.hexdigest() != source["server_sha256"]:
                        raise ApiError("SOURCE_HASH_MISMATCH", "An original failed export integrity verification.", 409)
                    source["export_path"] = path
                    original_manifest.append(
                        {"source_id": source["id"], "path": path, "sha256": digest.hexdigest(), "byte_size": size}
                    )
                canonical = json.dumps(document, sort_keys=True, ensure_ascii=False, indent=2).encode("utf-8")
                if total + len(canonical) > MAX_EXPORT_BYTES or len(canonical) > MAX_CANONICAL_BYTES:
                    raise ApiError("EXPORT_TOO_LARGE", "Export exceeds the pilot byte limit.", 413)
                _write(archive, "recall.json", canonical)
                manifest = {
                    "format": "recall.export.manifest.v1",
                    "snapshot": metadata,
                    "canonical_sha256": hashlib.sha256(canonical).hexdigest(),
                    "originals": original_manifest,
                    "unavailable_originals": unavailable_originals,
                }
                _write(archive, "manifest.json", json.dumps(manifest, sort_keys=True, indent=2).encode("utf-8"))
                for memory in document["memories"]:
                    revisions = [r for r in document["memory_revisions"] if r["memory_id"] == memory["id"]]
                    revisions.sort(key=lambda revision: revision["revision"])
                    markdown = [
                        "# Recall memory",
                        "",
                        f"Capture: {memory['capture_id']}",
                        "",
                        "This is a portable projection. The JSON export preserves complete provenance.",
                        "",
                    ]
                    for revision in revisions:
                        markdown.extend([f"## Revision {revision['revision']} ({revision['origin']})", ""])
                        extraction = revision.get("extraction", {})
                        if isinstance(extraction, dict):
                            # Render source/model content as literal code. Choose a
                            # fence longer than any content fence, so untrusted text
                            # cannot escape it into HTML or Obsidian embeds.
                            summary = str(extraction.get("summary", ""))
                            fence = "`" * max(3, max((len(s) + 1 for s in re.findall(r"`+", summary)), default=3))
                            markdown.extend([fence, summary, fence, ""])
                        serialized = json.dumps(revision, sort_keys=True, ensure_ascii=False, indent=2)
                        fence = "`" * max(3, max((len(s) + 1 for s in re.findall(r"`+", serialized)), default=3))
                        markdown.extend([fence + "json", serialized, fence, ""])
                    _write(archive, f"memories/{uuid.UUID(memory['id'])}.md", "\n".join(markdown).encode("utf-8"))
            return destination
        except LookupError:
            destination.unlink(missing_ok=True)
            raise forbidden() from None
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
