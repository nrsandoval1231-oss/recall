from __future__ import annotations

import asyncio
import hashlib
import sqlite3
import sys
import time
import uuid
from datetime import UTC, datetime
from types import ModuleType, SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from recall.knowledge.app import create_app
from recall.knowledge.graph import (
    GraphAdapter,
    GraphCapacityError,
    GraphIndexMissing,
    _anchor_supported_sources,
    _has_ambiguous_person_support,
    _map_current_episodes,
    _relationship_id,
    _relationship_node_id,
    _relationship_uncertainty,
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


def test_endpoint_anchors_require_both_names_in_same_supporting_note() -> None:
    grounded = source("Alice joined Project Aurora.")
    other = source("Project Aurora is ready.")
    mentions_subject_only = source("Alice moved to another team.")
    assert _anchor_supported_sources([grounded], "Alice", "Project Aurora") == [grounded]
    assert _anchor_supported_sources([other, mentions_subject_only], "Alice", "Project Aurora") == []
    assert _anchor_supported_sources([grounded], "Alice", "Invented Initiative") == []
    assert _anchor_supported_sources([grounded], "Alicia", "Project Aurora") == []


def test_endpoint_anchors_are_unicode_aware_case_insensitive_and_word_bounded() -> None:
    unicode_note = source("E\u0301LODIE met Zoë and discussed STRASSE.")
    assert _anchor_supported_sources([unicode_note], "Élodie", "zoë") == [unicode_note]
    assert _anchor_supported_sources([unicode_note], "Zoë", "Straße") == [unicode_note]

    case_note = source("acme Corporation hired Annette.")
    assert _anchor_supported_sources([case_note], "ACME Corporation", "annette") == [case_note]
    assert _anchor_supported_sources([case_note], "ACME", "Ann") == []


def test_person_mentions_are_source_local_even_when_graphiti_reuses_uuid() -> None:
    from recall.knowledge.graph import episode_key

    first = source("Brad will work on Project Aurora.")
    second = source("Brad will work on Project Borealis.")
    upstream_person_uuid = str(uuid.uuid4())
    graphiti_person = SimpleNamespace(labels=["Person"], name="Brad", uuid=upstream_person_uuid)
    first_project = SimpleNamespace(labels=["Project"], name="Project Aurora", uuid=str(uuid.uuid4()))
    second_project = SimpleNamespace(labels=["Project"], name="Project Borealis", uuid=str(uuid.uuid4()))

    first_person_id = _relationship_node_id(SCOPE, graphiti_person, first)
    second_person_id = _relationship_node_id(SCOPE, graphiti_person, second)
    assert first_person_id != second_person_id
    assert first_person_id == _relationship_node_id(SCOPE, graphiti_person, first)
    assert first_person_id != _scoped_node_id(SCOPE, upstream_person_uuid)
    assert episode_key(first) != episode_key(second)

    first_support = Support(
        source_id=first.id,
        revision=first.revision,
        source_sha256=first.source_sha256,
        note_sha256=first.note_sha256,
        quote=first.text,
    )
    second_support = Support(
        source_id=second.id,
        revision=second.revision,
        source_sha256=second.source_sha256,
        note_sha256=second.note_sha256,
        quote=second.text,
    )
    first_fact_id = _relationship_id(SCOPE, graphiti_person, first_project, "WORKS_ON", "works", [first_support])
    second_fact_id = _relationship_id(SCOPE, graphiti_person, second_project, "WORKS_ON", "works", [second_support])
    assert first_fact_id != second_fact_id
    assert "identity across notes is unverified" in _relationship_uncertainty("Person", "Project")


def test_person_edges_with_multiple_original_sources_are_suppressed_before_anchors() -> None:
    grounded = source("Brad works on Project Aurora.")
    other = source("Project Aurora is delayed.")
    original_supports = [grounded, other]
    # The second source fails the endpoint anchor check, but cannot be filtered
    # away before the Person-identity ambiguity check.
    anchored = _anchor_supported_sources(original_supports, "Brad", "Project Aurora")
    assert anchored == [grounded]
    assert _has_ambiguous_person_support(original_supports, "Person", "Project")
    assert not _has_ambiguous_person_support(anchored, "Person", "Project")

    # Multi-source relations without a Person retain their established mapping.
    assert not _has_ambiguous_person_support(original_supports, "Project", "Project")
    assert _relationship_node_id(
        SCOPE,
        SimpleNamespace(labels=["Project"], uuid="shared-project-node"),
        grounded,
    ) == _scoped_node_id(SCOPE, "shared-project-node")


def test_search_keeps_ambiguous_same_name_mentions_source_local_and_suppresses_shared_edges(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from recall.knowledge.graph import episode_key

    first = source("Brad works on Project Aurora. Project Aurora depends on Project Borealis.")
    second = source("Brad works on Project Borealis.")
    third = source("Project Aurora depends on Project Borealis.")
    sources = {item.id: item for item in (first, second, third)}
    person_uuid = str(uuid.uuid4())
    aurora_uuid = str(uuid.uuid4())
    borealis_uuid = str(uuid.uuid4())
    nodes = [
        SimpleNamespace(labels=["Person"], name="Brad", uuid=person_uuid),
        SimpleNamespace(labels=["Project"], name="Project Aurora", uuid=aurora_uuid),
        SimpleNamespace(labels=["Project"], name="Project Borealis", uuid=borealis_uuid),
    ]
    episodes = [
        SimpleNamespace(uuid=f"ep{index}", name=episode_key(item), group_id=SCOPE)
        for index, item in enumerate((first, second, third), start=1)
    ]
    episode_id = {item.id: f"ep{index}" for index, item in enumerate((first, second, third), start=1)}
    edges = [
        SimpleNamespace(
            source_node_uuid=person_uuid,
            target_node_uuid=aurora_uuid,
            episodes=[episode_id[first.id]],
            fact="Brad works on Aurora.",
            name="WORKS_ON",
            created_at=first.updated_at,
        ),
        SimpleNamespace(
            source_node_uuid=person_uuid,
            target_node_uuid=borealis_uuid,
            episodes=[episode_id[second.id]],
            fact="Brad works on Borealis.",
            name="WORKS_ON",
            created_at=second.updated_at,
        ),
        SimpleNamespace(
            source_node_uuid=person_uuid,
            target_node_uuid=aurora_uuid,
            episodes=[episode_id[first.id], episode_id[third.id]],
            fact="The notes connect Brad to Aurora.",
            name="WORKS_ON",
            created_at=first.updated_at,
        ),
        SimpleNamespace(
            source_node_uuid=aurora_uuid,
            target_node_uuid=borealis_uuid,
            episodes=[episode_id[first.id], episode_id[third.id]],
            fact="Aurora depends on Borealis.",
            name="DEPENDS_ON",
            created_at=first.updated_at,
        ),
    ]

    class FakeEntityEdge:
        @staticmethod
        async def get_by_group_ids(_driver, _groups, *, limit):
            return edges[:limit]

    class FakeEntityNode:
        @staticmethod
        async def get_by_uuids(_driver, values):
            return [node for node in nodes if node.uuid in values]

    class FakeEpisodicNode:
        @staticmethod
        async def get_by_uuids(_driver, values):
            return [episode for episode in episodes if episode.uuid in values]

    core = ModuleType("graphiti_core")
    core.__path__ = []  # type: ignore[attr-defined]
    edge_module = ModuleType("graphiti_core.edges")
    edge_module.EntityEdge = FakeEntityEdge  # type: ignore[attr-defined]
    node_module = ModuleType("graphiti_core.nodes")
    node_module.EntityNode = FakeEntityNode  # type: ignore[attr-defined]
    node_module.EpisodicNode = FakeEpisodicNode  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "graphiti_core", core)
    monkeypatch.setitem(sys.modules, "graphiti_core.edges", edge_module)
    monkeypatch.setitem(sys.modules, "graphiti_core.nodes", node_module)

    adapter = GraphAdapter("C:/synthetic/outside-repo.db")
    adapter._db = object()
    adapter._drivers[SCOPE] = object()
    adapter._verified_episodes[SCOPE] = tuple(sorted(episode_key(item) for item in sources.values()))
    relationships = asyncio.run(adapter.search(SCOPE, "", 20, sources))
    assert len(relationships) == 3

    person_edges = [row for row in relationships if row.subject_type == "Person"]
    assert len(person_edges) == 2
    assert len({row.subject_id for row in person_edges}) == 2
    assert {row.subject_id for row in person_edges} == {
        _relationship_node_id(SCOPE, nodes[0], first),
        _relationship_node_id(SCOPE, nodes[0], second),
    }
    assert {row.supports[0].source_id for row in person_edges} == {first.id, second.id}
    assert all("identity across notes is unverified" in row.uncertainty for row in person_edges)
    project_edge = next(row for row in relationships if row.subject_type == "Project")
    assert project_edge.subject_id == _scoped_node_id(SCOPE, aurora_uuid)
    assert project_edge.object_id == _scoped_node_id(SCOPE, borealis_uuid)
    assert {support.source_id for support in project_edge.supports} == {first.id, third.id}


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
        self.fail_flush = False
        self.flushes = 0
        self.close_calls = 0
        self.fail_close = False

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

    async def flush(self) -> None:
        self.flushes += 1
        if self.fail_flush:
            raise RuntimeError("synthetic persistence failure")

    async def search(self, scope: str, query: str, limit: int, sources: dict[str, Source]) -> list[Relationship]:
        if self.missing_index:
            raise GraphIndexMissing("synthetic missing graph")
        if self.on_search:
            await self.on_search()
        return self.relationships[:limit]

    async def close(self) -> None:
        self.close_calls += 1
        if self.fail_close:
            raise RuntimeError("synthetic private close error")
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


def test_failed_graph_save_never_reports_ready_or_disabled(service) -> None:
    client, store, graph = service
    graph.fail_flush = True
    item = source("Synthetic source save failure")
    response = client.post("/v1/snapshot", headers=headers(), json=snapshot(1, [item]).model_dump(mode="json"))
    assert response.status_code == 200
    deadline = time.monotonic() + 2
    while store.status(SCOPE).state != "failed":
        assert time.monotonic() < deadline
        time.sleep(0.01)
    assert store.status(SCOPE).indexed == 0

    graph.fail_flush = False
    response = client.post(
        "/v1/snapshot", headers=headers(), json=snapshot(2, [], allowed=False).model_dump(mode="json")
    )
    assert response.status_code == 200
    graph.fail_flush = True
    deadline = time.monotonic() + 2
    while store.status(SCOPE).state != "failed":
        assert time.monotonic() < deadline
        time.sleep(0.01)
    assert store.status(SCOPE).indexed == 0


def test_dead_queue_worker_surfaces_restart_required_and_shutdown_closes_graph(tmp_path) -> None:
    store = SnapshotStore(tmp_path / "queue.sqlite")

    def fail_next_job():
        raise sqlite3.OperationalError("unable to open database file")

    store.next_job = fail_next_job
    graph = FakeGraph()
    app = create_app(store=store, adapter=graph, token=TOKEN, db_path=tmp_path / "graph.db")
    item = source("Synthetic note must remain queued after worker failure.")
    with TestClient(app, base_url="http://127.0.0.1") as client:
        deadline = time.monotonic() + 2
        health = client.get("/v1/health", headers=headers())
        while health.json()["state"] != "failed":
            assert time.monotonic() < deadline
            time.sleep(0.01)
            health = client.get("/v1/health", headers=headers())
        assert health.json()["failed"] >= 1
        assert "restart the local service" in health.json()["message"]

        snapshot_result = client.post(
            "/v1/snapshot", headers=headers(), json=snapshot(1, [item]).model_dump(mode="json")
        )
        assert snapshot_result.status_code == 200
        assert snapshot_result.json()["state"] == "failed"
        search_result = client.post(
            "/v1/search",
            headers=headers(),
            json={"version": 1, "scope": SCOPE, "generation": 1, "query": "synthetic", "limit": 10},
        )
        assert search_result.json()["relationships"] == []
        assert search_result.json()["status"]["state"] == "failed"
    assert graph.close_calls == 1
    assert graph.rebuilds == []


def test_graph_shutdown_failure_logs_only_fixed_diagnostic(tmp_path, caplog) -> None:
    store = SnapshotStore(tmp_path / "queue.sqlite")
    graph = FakeGraph()
    graph.fail_close = True
    app = create_app(store=store, adapter=graph, token=TOKEN, db_path=tmp_path / "graph.db")
    with TestClient(app, base_url="http://127.0.0.1"):
        pass
    assert graph.close_calls == 1
    assert "Knowledge service graph cleanup failed." in caplog.text
    assert "synthetic private close error" not in caplog.text


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
