from __future__ import annotations

import hashlib
import sqlite3
import time
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from recall.knowledge.app import create_app
from recall.knowledge.graph import (
    GraphCapacityError,
    GraphIndexMissing,
    _map_current_episodes,
    _relationship_id,
    _scoped_node_id,
    _validate_capacity,
)
from recall.knowledge.models import Relationship, Snapshot, Source, Support
from recall.knowledge.providers import _mark_budget_unknown, _reserve_budget, _settle_budget
from recall.knowledge.store import SnapshotStore, StaleGeneration

SCOPE = str(uuid.UUID("56fc8992-8c25-4f13-a568-962454a6169e"))
TOKEN = "t" * 48


def source(text: str, *, identifier: str | None = None, revision: int = 1) -> Source:
    source_id = identifier or str(uuid.uuid4())
    return Source(
        id=source_id,
        revision=revision,
        source_sha256="a" * 64,
        note_sha256=hashlib.sha256(text.encode()).hexdigest(),
        text=text,
        source_name="synthetic.md",
        note_path="Synthetic/synthetic.md",
        captured_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def snapshot(generation: int, sources: list[Source], *, allowed: bool = True, rebuild: bool = False) -> Snapshot:
    return Snapshot(
        version=1,
        scope=SCOPE,
        generation=generation,
        processing_allowed=allowed,
        sources=sources,
        eligible_ids=[item.id for item in sources] if allowed else [],
        suppressed_facts=[],
        rebuild=rebuild,
    )


def test_source_hash_must_match_text() -> None:
    item = source("Synthetic content")
    invalid = item.model_dump()
    invalid["note_sha256"] = "b" * 64
    with pytest.raises(ValueError, match="does not match"):
        Source.model_validate(invalid)


def test_generation_idempotence_append_and_revision_rebuild(tmp_path) -> None:
    store = SnapshotStore(tmp_path / "queue.sqlite")
    first = source("Alice works on Project Aurora.")
    assert store.submit(snapshot(1, [first])).state == "queued"
    _, _, kind, ids = store.next_job()
    assert (kind, ids) == ("rebuild", {first.id})
    assert store.commit(SCOPE, 1, [first])

    assert store.submit(snapshot(1, [first])).state == "ready"
    with pytest.raises(StaleGeneration):
        store.submit(snapshot(1, [source("Different same-generation text", identifier=first.id)]))

    second = source("Synthetic project milestone.")
    assert store.submit(snapshot(2, [first, second])).state == "queued"
    _, _, kind, ids = store.next_job()
    assert (kind, ids) == ("append", {second.id})
    assert store.commit(SCOPE, 2, [first, second])

    revised = source("Alice now works on Project Aurora.", identifier=first.id, revision=2)
    store.submit(snapshot(3, [revised, second]))
    _, _, kind, ids = store.next_job()
    assert kind == "rebuild"
    assert ids == {first.id, second.id}


def test_deletion_and_revocation_purge_derived_metadata(tmp_path) -> None:
    store = SnapshotStore(tmp_path / "queue.sqlite")
    first, second = source("first private synthetic"), source("second private synthetic")
    store.submit(snapshot(1, [first, second]))
    store.next_job()
    store.commit(SCOPE, 1, [first, second])

    store.submit(snapshot(2, [first]))
    _, _, kind, ids = store.next_job()
    assert (kind, ids) == ("rebuild", {first.id})
    store.commit(SCOPE, 2, [first])

    status = store.submit(snapshot(3, [], allowed=False))
    assert status.state == "pending"
    assert store.current_sources(SCOPE) == {}
    with sqlite3.connect(store.path) as db:
        saved = db.execute("SELECT snapshot_json FROM scopes WHERE scope=?", (SCOPE,)).fetchone()[0]
        metadata_count = db.execute("SELECT count(*) FROM indexed_sources WHERE scope=?", (SCOPE,)).fetchone()[0]
    assert "first private synthetic" not in saved
    assert metadata_count == 0
    job = store.next_job()
    assert job is not None and job[2] == "rebuild" and job[3] == set()
    assert store.commit(SCOPE, 3, [])
    assert store.status(SCOPE).state == "disabled"


def test_interrupted_processing_recovers_as_full_rebuild(tmp_path) -> None:
    path = tmp_path / "queue.sqlite"
    store = SnapshotStore(path)
    items = [source("Synthetic one"), source("Synthetic two")]
    store.submit(snapshot(7, items))
    store.next_job()
    recovered = SnapshotStore(path)
    job = recovered.next_job()
    assert job is not None
    assert job[2] == "rebuild"
    assert job[3] == {item.id for item in items}


def test_failed_generation_does_not_commit_stale_worker(tmp_path) -> None:
    store = SnapshotStore(tmp_path / "queue.sqlite")
    first = source("Synthetic original")
    store.submit(snapshot(1, [first]))
    store.next_job()
    replacement = source("Synthetic replacement")
    store.submit(snapshot(2, [replacement]))
    assert not store.commit(SCOPE, 1, [first])
    assert store.status(SCOPE).state == "queued"


def test_graph_episode_mapping_requires_all_current_scoped_revisions() -> None:
    from recall.knowledge.graph import episode_key

    current = source("Current synthetic text")
    foreign = source("Other vault text")
    mapped = _map_current_episodes(
        SCOPE,
        {current.id: current},
        [
            SimpleNamespace(uuid="episode-current", name=episode_key(current), group_id=SCOPE),
            SimpleNamespace(uuid="episode-foreign", name=episode_key(foreign), group_id=str(uuid.uuid4())),
        ],
    )
    assert mapped == {"episode-current": current}

    revised = source("Revised synthetic text", identifier=current.id, revision=2)
    with pytest.raises(GraphIndexMissing, match="does not match"):
        _map_current_episodes(
            SCOPE,
            {revised.id: revised},
            [SimpleNamespace(uuid="episode-stale", name=episode_key(current), group_id=SCOPE)],
        )
    with pytest.raises(GraphIndexMissing, match="missing"):
        _map_current_episodes(SCOPE, {current.id: current}, [])
    with pytest.raises(GraphIndexMissing, match="missing"):
        _map_current_episodes(
            SCOPE,
            {current.id: current},
            [SimpleNamespace(uuid="episode-foreign", name=episode_key(current), group_id=str(uuid.uuid4()))],
        )


def test_dismissal_identity_ignores_model_prose_and_support_order() -> None:
    from recall.knowledge.graph import episode_key

    first, second = source("First synthetic note"), source("Second synthetic note")
    supports = [
        Support(
            source_id=item.id,
            revision=item.revision,
            source_sha256=item.source_sha256,
            note_sha256=item.note_sha256,
            quote=item.text,
        )
        for item in (first, second)
    ]
    source_node = SimpleNamespace(labels=["Person"], name="Alice", uuid=str(uuid.uuid4()))
    target_node = SimpleNamespace(labels=["Project"], name="Aurora", uuid=str(uuid.uuid4()))
    left = _relationship_id(SCOPE, source_node, target_node, "WORKS_ON", "model prose A", supports)
    right = _relationship_id(SCOPE, source_node, target_node, "WORKS_ON", "model prose B", list(reversed(supports)))
    assert left == right
    assert _scoped_node_id(SCOPE, source_node.uuid) != _scoped_node_id(SCOPE, str(uuid.uuid4()))
    assert episode_key(first) != episode_key(source("Changed source", identifier=first.id, revision=2))


def test_graph_capacity_is_an_explicit_failure() -> None:
    from recall.knowledge.graph import MAX_SOURCE_CHARS, MAX_SOURCES_PER_REBUILD

    with pytest.raises(GraphCapacityError, match="source_count"):
        _validate_capacity([source("small") for _ in range(MAX_SOURCES_PER_REBUILD + 1)])
    with pytest.raises(GraphCapacityError, match="source_size"):
        _validate_capacity([source("x" * (MAX_SOURCE_CHARS + 1))])


def test_missing_persistent_graph_requeues_same_generation_rebuild(tmp_path) -> None:
    store = SnapshotStore(tmp_path / "queue.sqlite")
    item = source("Synthetic rebuild check")
    store.submit(snapshot(1, [item]))
    store.next_job()
    store.commit(SCOPE, 1, [item])

    queued = store.requeue_rebuild(SCOPE, 1)
    assert queued.state == "queued" and queued.pending == 1
    job = store.next_job()
    assert job is not None and job[2] == "rebuild" and job[3] == {item.id}


def test_budget_reservations_settlement_and_unknown(tmp_path) -> None:
    ledger = tmp_path / "budget.sqlite"
    first = _reserve_budget(ledger, 0.1, 0.2)
    assert first is not None
    assert _reserve_budget(ledger, 0.11, 0.2) is None
    _settle_budget(ledger, first, 0.03, 1000, 200, 0.75)
    second = _reserve_budget(ledger, 0.1, 0.2)
    assert second is not None
    _mark_budget_unknown(ledger, second, 0.5)
    with sqlite3.connect(ledger) as db:
        status = db.execute("SELECT status,latency_seconds FROM provider_calls ORDER BY id").fetchall()
        budget = db.execute("SELECT reserved_usd,spent_usd FROM provider_budget").fetchone()
    assert status[0][0] == "settled" and status[0][1] == 0.75
    assert status[1][0] == "unknown" and status[1][1] == 0.5
    assert budget == pytest.approx((0.1, 0.03))


class FakeGraph:
    def __init__(self) -> None:
        self.rebuilds: list[tuple[str, list[str]]] = []
        self.appends: list[tuple[str, list[str]]] = []
        self.relationships: list[Relationship] = []
        self.missing_index = False
        self.on_search = None
        self.block_first_rebuild = False
        self.first_rebuild_started = None
        self.first_rebuild_cancelled = False
        self._release_first = None

    async def rebuild(self, snap: Snapshot) -> None:
        self.rebuilds.append((snap.scope, [item.id for item in snap.sources if item.id in snap.eligible_ids]))
        if self.block_first_rebuild and len(self.rebuilds) == 1:
            import asyncio

            self.first_rebuild_started = asyncio.Event()
            self._release_first = asyncio.Event()
            self.first_rebuild_started.set()
            try:
                await self._release_first.wait()
            except asyncio.CancelledError:
                self.first_rebuild_cancelled = True
                raise

    async def append(self, scope: str, items: list[Source]) -> None:
        self.appends.append((scope, [item.id for item in items]))

    async def search(self, scope: str, query: str, limit: int, sources: dict[str, Source]) -> list[Relationship]:
        if self.missing_index:
            raise GraphIndexMissing("synthetic missing graph")
        if self.on_search:
            await self.on_search()
        return self.relationships[:limit]

    async def close(self) -> None:
        return None


def relationship(item: Source) -> Relationship:
    quote = item.text
    return Relationship(
        id=str(uuid.uuid4()),
        subject_id=str(uuid.uuid4()),
        object_id=str(uuid.uuid4()),
        source_id=item.id,
        revision=item.revision,
        source_sha256=item.source_sha256,
        note_sha256=item.note_sha256,
        source_name=item.source_name,
        note_path=item.note_path,
        quote=quote,
        subject="Alice",
        subject_type="Person",
        predicate="WORKS_ON",
        object="Project Aurora",
        object_type="Project",
        fact=quote,
        extracted_at=datetime.now(UTC),
        uncertainty="Inferred synthetic fixture.",
        related_source_ids=[item.id],
        supports=[
            Support(
                source_id=item.id,
                revision=item.revision,
                source_sha256=item.source_sha256,
                note_sha256=item.note_sha256,
                quote=quote,
            )
        ],
    )


@pytest.fixture
def service(tmp_path):
    store = SnapshotStore(tmp_path / "queue.sqlite")
    graph = FakeGraph()
    app = create_app(store=store, adapter=graph, token=TOKEN, db_path=tmp_path / "graph.db")
    with TestClient(app, base_url="http://127.0.0.1") as client:
        yield client, store, graph


def headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def test_api_loopback_auth_providers_and_pending_ingest(service) -> None:
    client, store, _ = service
    assert client.get("/v1/health").status_code == 401
    health = client.get("/v1/health", headers=headers())
    assert health.status_code == 200
    assert set(health.json()["providers"]) == {"extraction", "embedding", "reranking"}
    item = source("Alice works on Project Aurora.")
    response = client.post("/v1/snapshot", headers=headers(), json=snapshot(1, [item]).model_dump(mode="json"))
    assert response.status_code == 200 and response.json()["state"] == "queued"
    # ASGI lifespan worker processes without blocking the HTTP request.
    for _ in range(100):
        if store.status(SCOPE).state == "ready":
            break
        time.sleep(0.01)
    assert store.status(SCOPE).state == "ready"


def test_api_search_support_validation_history_and_generation_fence(service) -> None:
    client, store, graph = service
    item = source("Alice works on Project Aurora.")
    store.submit(snapshot(1, [item]))
    store.next_job()
    store.commit(SCOPE, 1, [item])
    graph.relationships = [relationship(item)]
    body = {"version": 1, "scope": SCOPE, "generation": 1, "query": "Alice", "limit": 10}
    result = client.post("/v1/search", headers=headers(), json=body)
    assert result.status_code == 200 and len(result.json()["relationships"]) == 1
    assert result.json()["relationships"][0]["quote"] == item.text
    assert result.json()["relationships"][0]["supports"][0]["quote"] == item.text
    history = client.post("/v1/search", headers=headers(), json={**body, "include_history": True})
    assert history.json()["relationships"] == []
    assert history.json()["status"]["state"] == "history_unavailable"

    async def advance_generation() -> None:
        store.submit(snapshot(2, [source("Revised Alice Project Aurora.", identifier=item.id, revision=2)]))

    graph.on_search = advance_generation
    raced = client.post("/v1/search", headers=headers(), json=body)
    assert raced.status_code == 200
    assert raced.json()["relationships"] == []


def test_api_rejects_browser_origin_and_malformed_hash(service) -> None:
    client, _, _ = service
    response = client.get("/v1/health", headers={**headers(), "Origin": "http://127.0.0.1"})
    assert response.status_code == 403
    malformed = snapshot(1, [source("Has valid text")]).model_dump(mode="json")
    malformed["sources"][0]["note_sha256"] = "0" * 64
    response = client.post("/v1/snapshot", headers=headers(), json=malformed)
    assert response.status_code == 422


def test_api_stale_search_generation_is_conflict(service) -> None:
    client, _, _ = service
    response = client.post(
        "/v1/search",
        headers=headers(),
        json={
            "version": 1,
            "scope": SCOPE,
            "generation": 1,
            "query": "synthetic",
            "limit": 10,
        },
    )
    assert response.status_code == 409


def test_search_requeues_rebuild_when_ready_queue_has_lost_graph(service) -> None:
    client, store, graph = service
    item = source("Synthetic retained source")
    store.submit(snapshot(1, [item]))
    store.next_job()
    store.commit(SCOPE, 1, [item])
    graph.missing_index = True

    response = client.post(
        "/v1/search",
        headers=headers(),
        json={"version": 1, "scope": SCOPE, "generation": 1, "query": "synthetic", "limit": 10},
    )
    assert response.status_code == 200
    assert response.json()["relationships"] == []
    assert response.json()["status"]["state"] == "queued"
    deadline = time.monotonic() + 2
    while len(graph.rebuilds) < 1:
        assert time.monotonic() < deadline
        time.sleep(0.01)


def test_revocation_cancels_in_flight_extraction_before_following_job(service) -> None:
    client, store, graph = service
    graph.block_first_rebuild = True
    item = source("Synthetic content that must not continue processing after revocation.")
    first = client.post("/v1/snapshot", headers=headers(), json=snapshot(1, [item]).model_dump(mode="json"))
    assert first.status_code == 200
    deadline = time.monotonic() + 2
    while graph.first_rebuild_started is None or not graph.first_rebuild_started.is_set():
        assert time.monotonic() < deadline
        time.sleep(0.01)

    revoked = client.post(
        "/v1/snapshot", headers=headers(), json=snapshot(2, [], allowed=False).model_dump(mode="json")
    )
    assert revoked.status_code == 200
    deadline = time.monotonic() + 2
    while store.status(SCOPE).state != "disabled":
        assert time.monotonic() < deadline
        time.sleep(0.01)
    assert graph.first_rebuild_cancelled
    assert len(graph.rebuilds) == 2
    assert graph.rebuilds[-1][1] == []
