"""Supabase Storage adapter (private bucket, server-side service-role key only).

NOT live-verified in RCL-001: it is exercised only against a stub HTTP server. The live gate
(real project + private bucket) is recorded in docs/ACCEPTANCE.md ("RCL-001 evidence").
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from urllib.parse import quote

import httpx

from . import CHUNK, ObjectInfo, ObjectNotFound, StoredObjectConflict, hash_stream


class SupabaseObjectStore:
    def __init__(
        self,
        base_url: str,
        service_role_key: str,
        bucket: str,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.bucket = bucket
        self._client = httpx.Client(
            base_url=base_url.rstrip("/") + "/storage/v1",
            headers={"Authorization": f"Bearer {service_role_key}", "apikey": service_role_key},
            timeout=httpx.Timeout(60.0, connect=10.0),
            transport=transport,
        )

    def _object_path(self, key: str) -> str:
        if key.startswith("/") or ".." in key.split("/"):
            raise ValueError("invalid storage key")
        return f"/object/{quote(self.bucket)}/{quote(key, safe='/')}"

    def put_if_absent(self, key: str, source: Path, *, content_type: str, sha256: str) -> bool:
        with source.open("rb") as handle:
            response = self._client.post(
                self._object_path(key),
                content=handle,
                headers={"Content-Type": content_type, "x-upsert": "false"},
            )
        if response.status_code in (200, 201):
            return True
        if response.status_code in (400, 409) and "exist" in response.text.lower():
            existing, _ = hash_stream(self.iter_bytes(key))
            if existing == sha256:
                return False
            raise StoredObjectConflict(key)
        response.raise_for_status()
        raise RuntimeError(f"unexpected storage response {response.status_code}")

    def replace_corrupt(self, key: str, source: Path, *, content_type: str) -> None:
        with source.open("rb") as handle:
            response = self._client.post(
                self._object_path(key), content=handle, headers={"Content-Type": content_type, "x-upsert": "true"}
            )
        response.raise_for_status()

    def stat(self, key: str) -> ObjectInfo | None:
        response = self._client.head(f"/object/authenticated/{quote(self.bucket)}/{quote(key, safe='/')}")
        if response.status_code in (400, 404):
            return None
        response.raise_for_status()
        return ObjectInfo(size=int(response.headers["content-length"]))

    def iter_bytes(self, key: str) -> Iterator[bytes]:
        url = f"/object/authenticated/{quote(self.bucket)}/{quote(key, safe='/')}"
        with self._client.stream("GET", url) as response:
            if response.status_code in (400, 404):
                raise ObjectNotFound(key)
            response.raise_for_status()
            yield from response.iter_bytes(CHUNK)

    def check_ready(self) -> None:
        self._client.get(f"/bucket/{quote(self.bucket)}").raise_for_status()
