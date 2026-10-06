"""Private object storage port and adapters."""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

CHUNK = 1024 * 1024


class ObjectNotFound(Exception):
    pass


class StoredObjectConflict(Exception):
    """A different object already exists at a write-once key. Never overwrite."""


@dataclass(frozen=True)
class ObjectInfo:
    size: int


class ObjectStore(Protocol):
    def put_if_absent(self, key: str, source: Path, *, content_type: str, sha256: str) -> bool:
        """Store `source` at `key` without ever overwriting.

        Returns True if newly stored, False if byte-identical content already existed.
        Raises StoredObjectConflict if different content exists at the key.
        """

    def stat(self, key: str) -> ObjectInfo | None: ...

    def iter_bytes(self, key: str) -> Iterator[bytes]:
        """Raises ObjectNotFound."""

    def check_ready(self) -> None:
        """Raise if the store is not usable."""


def hash_stream(chunks: Iterator[bytes]) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    for chunk in chunks:
        digest.update(chunk)
        size += len(chunk)
    return digest.hexdigest(), size
