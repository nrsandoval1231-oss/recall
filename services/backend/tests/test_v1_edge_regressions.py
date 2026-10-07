"""Deterministic lifecycle regressions for bounded background maintenance."""

from __future__ import annotations

import asyncio
import uuid
from contextlib import contextmanager

import pytest

from recall.domain import export as export_domain
from recall.ingestion.worker import Worker


def test_export_janitor_runs_without_a_new_export_request(monkeypatch: pytest.MonkeyPatch) -> None:
    stop = asyncio.Event()
    cleaned: list[bool] = []
    waits = 0

    async def fake_wait_for(awaitable: object, *, timeout: float) -> None:
        nonlocal waits
        waits += 1
        if hasattr(awaitable, "close"):
            awaitable.close()  # avoid an un-awaited Event.wait coroutine in the fake clock
        if waits == 1:
            raise TimeoutError

    async def fake_threadpool(fn: object, *args: object) -> None:
        cleaned.append(True)
        stop.set()

    monkeypatch.setattr(export_domain.asyncio, "wait_for", fake_wait_for)
    monkeypatch.setattr(export_domain, "run_in_threadpool", fake_threadpool)
    monkeypatch.setattr(export_domain, "cleanup_export_files", lambda: None)
    asyncio.run(export_domain.export_janitor(stop))
    assert cleaned == [True]


def test_embedding_sweeps_rotate_across_more_than_eight_workspaces() -> None:
    workspaces = [uuid.uuid4() for _ in range(10)]
    indexed: list[uuid.UUID] = []

    class Tx:
        def all(self, query: str) -> list[dict[str, uuid.UUID]]:
            assert "recall_embedding_enabled_workspaces" in query
            return [{"workspace_id": workspace} for workspace in workspaces]

    worker = object.__new__(Worker)
    worker._embedding_sweep_offset = 0
    worker._embedding_retry_not_before = {}
    worker._embedding_failures = {}
    worker._tx = lambda *args: _tx_context(Tx())  # type: ignore[method-assign]
    worker._index_workspace = lambda workspace_id: indexed.append(workspace_id) or True  # type: ignore[method-assign]

    worker._sweep_embedding_backlog()
    worker._sweep_embedding_backlog()
    ordered = sorted(workspaces, key=str)
    assert len(indexed) == 16
    assert indexed[:8] == ordered[:8]
    assert set(indexed[8:]) == set(ordered[8:]) | set(ordered[:6])


@contextmanager
def _tx_context(tx: object):
    yield tx
