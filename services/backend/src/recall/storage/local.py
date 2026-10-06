"""Filesystem object store for local development and tests (private directory, write-once)."""

from __future__ import annotations

import contextlib
import os
import shutil
import tempfile
from collections.abc import Iterator
from pathlib import Path

from . import CHUNK, ObjectInfo, ObjectNotFound, StoredObjectConflict, hash_stream


class LocalObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        with contextlib.suppress(OSError):
            self.root.chmod(0o700)

    def _path(self, key: str) -> Path:
        # Keys are server-generated, but still refuse anything that could escape the root.
        if key.startswith("/") or ".." in key.split("/") or "\\" in key or "\x00" in key:
            raise ValueError("invalid storage key")
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("invalid storage key")
        return path

    def put_if_absent(self, key: str, source: Path, *, content_type: str, sha256: str) -> bool:
        final = self._path(key)
        final.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=final.parent, prefix=".incoming-")
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "wb") as out, source.open("rb") as src:
                shutil.copyfileobj(src, out, CHUNK)
                out.flush()
                os.fsync(out.fileno())
            try:
                os.link(tmp, final)  # atomic, fails if the key already exists
            except FileExistsError:
                existing, _ = hash_stream(self.iter_bytes(key))
                if existing == sha256:
                    return False
                raise StoredObjectConflict(key) from None
            dir_fd = os.open(final.parent, os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
            return True
        finally:
            tmp.unlink(missing_ok=True)

    def replace_corrupt(self, key: str, source: Path, *, content_type: str) -> None:
        final = self._path(key)
        fd, tmp_name = tempfile.mkstemp(dir=final.parent, prefix=".incoming-")
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "wb") as out, source.open("rb") as src:
                shutil.copyfileobj(src, out, CHUNK)
                out.flush()
                os.fsync(out.fileno())
            os.replace(tmp, final)
        finally:
            tmp.unlink(missing_ok=True)

    def stat(self, key: str) -> ObjectInfo | None:
        try:
            return ObjectInfo(size=self._path(key).stat().st_size)
        except FileNotFoundError:
            return None

    def iter_bytes(self, key: str) -> Iterator[bytes]:
        try:
            handle = self._path(key).open("rb")
        except FileNotFoundError as exc:
            raise ObjectNotFound(key) from exc
        with handle:
            while chunk := handle.read(CHUNK):
                yield chunk

    def check_ready(self) -> None:
        if not self.root.is_dir():
            raise RuntimeError("local object store directory missing")
