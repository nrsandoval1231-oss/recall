from __future__ import annotations

import asyncio
import hashlib
import threading
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from recall.knowledge.answers import (
    InvalidAnswerOutput,
    request_quoted_answer,
    select_candidate_windows,
)
from recall.knowledge.app import create_app
from recall.knowledge.models import AnswerRequest, Snapshot, Source
from recall.knowledge.providers import configured_extraction_identity
from recall.knowledge.store import DuplicateAnswerRequest, SnapshotStore

SCOPE = str(uuid.UUID("56fc8992-8c25-4f13-a568-962454a6169e"))
TOKEN = "t" * 48


def source(text: str, source_id: str | None = None) -> Source:
    return Source(
        id=source_id or str(uuid.uuid4()),
        revision=1,
        source_sha256="a" * 64,
        note_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        text=text,
        source_name="synthetic.md",
        note_path="Synthetic/synthetic.md",
        captured_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def consented_snapshot(item: Source, generation: int = 1) -> Snapshot:
    return Snapshot(
        version=1,
        scope=SCOPE,
        generation=generation,
        processing_allowed=True,
        sources=[item],
        eligible_ids=[item.id],
        suppressed_facts=[],
        answer_allowed=True,
        answer_provider=configured_extraction_identity(),
    )


def configure_provider(monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setenv("RECALL_GRAPH_LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("RECALL_GRAPH_ANTHROPIC_API_KEY", "synthetic-test-key-not-used")
    monkeypatch.setenv("RECALL_GRAPH_ANTHROPIC_MODEL", "claude-sonnet-5-5")
    monkeypatch.setenv("RECALL_GRAPH_BUDGET_USD", "2")
    monkeypatch.setenv("RECALL_GRAPH_INPUT_USD_PER_MTOK", "2")
    monkeypatch.setenv("RECALL_GRAPH_OUTPUT_USD_PER_MTOK", "10")
    return configured_extraction_identity()


class FakeAnswerClient:
    def __init__(self, response: object) -> None:
        self.response = response
        self.calls = 0
        self.messages: list[object] = []

    async def generate_response(self, messages, **_kwargs):
        self.calls += 1
        self.messages = messages
        if isinstance(self.response, BaseException):
            raise self.response
        return self.response


class BlockingAnswerClient(FakeAnswerClient):
    def __init__(self) -> None:
        super().__init__({})
        self.started = threading.Event()

    async def generate_response(self, messages, **_kwargs):
        self.calls += 1
        self.messages = messages
        self.started.set()
        await asyncio.Event().wait()
        raise AssertionError("cancelled provider call unexpectedly returned")


class ClosableAnswerClient(FakeAnswerClient):
    def __init__(self, item: Source) -> None:
        super().__init__({"status": "supported", "selections": [{"source_id": item.id, "exact_quote": item.text}]})
        self.close_calls = 0

    async def aclose(self) -> None:
        self.close_calls += 1


def test_bounded_window_preserves_negation_uncertainty_and_unicode() -> None:
    text = "Launch was not approved; it may be delayed until May. “Café” remains unresolved. " + ("background " * 800)
    item = source(text)
    windows, limited = select_candidate_windows("Was launch approved?", [item])
    assert limited
    assert len(windows) == 1
    assert len(windows[0].excerpt) == 4_000
    assert windows[0].excerpt == text[windows[0].start : windows[0].end]
    assert "not approved" in windows[0].excerpt
    assert "may be delayed" in windows[0].excerpt

    far_apart = source("Project Aurora was discussed. " + ("filler " * 900) + "Project Aurora was not approved.")
    skipped, limited = select_candidate_windows("What happened to Project Aurora?", [far_apart])
    assert skipped == []
    assert limited


def test_model_quotes_must_be_exact_source_substrings_and_schema_strict() -> None:
    item = source("Decision: the launch was not approved; approval remains uncertain.")
    request = AnswerRequest(
        version=1,
        scope=SCOPE,
        generation=1,
        request_id=str(uuid.uuid4()),
        question="Was the launch approved?",
        candidate_ids=[item.id],
    )

    async def run() -> None:
        windows, _ = select_candidate_windows(request.question, [item])
        valid = FakeAnswerClient(
            {"status": "supported", "selections": [{"source_id": item.id, "exact_quote": "not approved; approval remains uncertain"}]}
        )
        result = await request_quoted_answer(request, windows, valid)
        assert result.status == "supported"
        assert result.selections[0].quote.startswith("not approved")
        assert "not a verified answer" in result.message
        assert "preserve enough surrounding context" in valid.messages[0].content

        invented = FakeAnswerClient(
            {"status": "supported", "selections": [{"source_id": item.id, "exact_quote": "The launch was approved"}]}
        )
        with pytest.raises(InvalidAnswerOutput) as quote_error:
            await request_quoted_answer(request, windows, invented)
        assert quote_error.value.reason == InvalidAnswerOutput.QUOTE_INVALID
        extra = FakeAnswerClient({"status": "insufficient", "selections": [], "answer": "secret"})
        with pytest.raises(InvalidAnswerOutput) as schema_error:
            await request_quoted_answer(request, windows, extra)
        assert schema_error.value.reason == InvalidAnswerOutput.SCHEMA_INVALID

    asyncio.run(run())


def _ready_store(path, item: Source) -> SnapshotStore:
    store = SnapshotStore(path)
    assert store.submit(consented_snapshot(item)).state == "queued"
    _snapshot, generation, _kind, _ids = store.next_job()
    assert store.commit(SCOPE, generation, [item])
    return store


def _answer_body(item: Source, *, request_id: str | None = None, generation: int = 1) -> dict[str, object]:
    return {
        "version": 1,
        "scope": SCOPE,
        "generation": generation,
        "request_id": request_id or str(uuid.uuid4()),
        "question": "What is the decision?",
        "candidate_ids": [item.id],
    }


def test_answer_endpoint_rejects_foreign_stale_and_pre_cancelled_without_dispatch(tmp_path, monkeypatch) -> None:
    configure_provider(monkeypatch)
    item = source("Synthetic decision: launch is not approved.")
    store = _ready_store(tmp_path / "queue.sqlite", item)
    fake = FakeAnswerClient({"status": "supported", "selections": []})
    app = create_app(store=store, adapter=object(), token=TOKEN, db_path=tmp_path / "graph.db", answer_client=fake)
    headers = {"Authorization": f"Bearer {TOKEN}"}
    cancelled_id = str(uuid.uuid4())
    with TestClient(app, base_url="http://127.0.0.1") as client:
        cancelled = client.post(
            "/v1/answer/cancel",
            headers=headers,
            json={"version": 1, "scope": SCOPE, "generation": 1, "request_id": cancelled_id},
        )
        assert cancelled.json() == {"cancelled": True}
        response = client.post("/v1/answer", headers=headers, json=_answer_body(item, request_id=cancelled_id))
        assert response.json()["status"] == "cancelled"

        foreign = source("Unselected private note")
        response = client.post("/v1/answer", headers=headers, json=_answer_body(foreign))
        assert response.json()["status"] == "unavailable"
        stale = client.post("/v1/answer", headers=headers, json=_answer_body(item, generation=2))
        assert stale.json()["status"] == "stale"
    assert fake.calls == 0


def test_answer_endpoint_returns_only_validated_current_quote(tmp_path, monkeypatch) -> None:
    configure_provider(monkeypatch)
    item = source("Synthetic record: the launch was not approved; timing remains uncertain.")
    store = _ready_store(tmp_path / "queue.sqlite", item)
    fake = FakeAnswerClient(
        {"status": "supported", "selections": [{"source_id": item.id, "exact_quote": "not approved; timing remains uncertain"}]}
    )
    app = create_app(store=store, adapter=object(), token=TOKEN, db_path=tmp_path / "graph.db", answer_client=fake)
    with TestClient(app, base_url="http://127.0.0.1") as client:
        response = client.post(
            "/v1/answer",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json=_answer_body(item),
        )
    data = response.json()
    assert data["status"] == "supported"
    assert data["selections"] == [
        {
            "source_id": item.id,
            "revision": 1,
            "source_sha256": "a" * 64,
            "note_sha256": item.note_sha256,
            "quote": "not approved; timing remains uncertain",
        }
    ]
    assert "not a verified answer" in data["message"]
    assert fake.calls == 1


def test_invalid_provider_output_logs_only_static_reason_code(tmp_path, monkeypatch, caplog) -> None:
    configure_provider(monkeypatch)
    private_note = "PRIVATE_SOURCE_SENTINEL: secret launch discussion."
    raw_output = "RAW_PROVIDER_OUTPUT_SENTINEL"
    item = source(private_note)
    store = _ready_store(tmp_path / "queue.sqlite", item)
    fake = FakeAnswerClient(
        {
            "status": "supported",
            "selections": [{"source_id": item.id, "exact_quote": raw_output}],
        }
    )
    app = create_app(store=store, adapter=object(), token=TOKEN, db_path=tmp_path / "graph.db", answer_client=fake)
    with TestClient(app, base_url="http://127.0.0.1") as client:
        response = client.post(
            "/v1/answer",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json=_answer_body(item),
        )
    assert response.json()["status"] == "unavailable"
    assert "quote_invalid" in caplog.text
    assert raw_output not in caplog.text
    assert private_note not in caplog.text
    assert item.id not in caplog.text


def test_cancel_endpoint_stops_active_answer_and_returns_no_selection(tmp_path, monkeypatch) -> None:
    from concurrent.futures import ThreadPoolExecutor

    configure_provider(monkeypatch)
    item = source("Synthetic note about a decision.")
    store = _ready_store(tmp_path / "queue.sqlite", item)
    fake = BlockingAnswerClient()
    app = create_app(store=store, adapter=object(), token=TOKEN, db_path=tmp_path / "graph.db", answer_client=fake)
    body = _answer_body(item)
    headers = {"Authorization": f"Bearer {TOKEN}"}
    with TestClient(app, base_url="http://127.0.0.1") as client, ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, "/v1/answer", headers=headers, json=body)
        assert fake.started.wait(timeout=3)
        cancelled = client.post(
            "/v1/answer/cancel",
            headers=headers,
            json={
                "version": 1,
                "scope": SCOPE,
                "generation": 1,
                "request_id": body["request_id"],
            },
        )
        assert cancelled.json() == {"cancelled": True}
        result = pending.result(timeout=3).json()
    assert result["status"] == "cancelled"
    assert result["selections"] == []
    assert store.answer_state(SCOPE, str(body["request_id"])) == "cancelled"


def test_answer_provider_must_be_configured_and_explicit(tmp_path, monkeypatch) -> None:
    configure_provider(monkeypatch)
    item = source("Synthetic decision")
    store = _ready_store(tmp_path / "queue.sqlite", item)
    fake = FakeAnswerClient({"status": "insufficient", "selections": []})
    monkeypatch.delenv("RECALL_GRAPH_ANTHROPIC_API_KEY")
    app = create_app(store=store, adapter=object(), token=TOKEN, db_path=tmp_path / "graph.db", answer_client=fake)
    with TestClient(app, base_url="http://127.0.0.1") as client:
        response = client.post(
            "/v1/answer",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json=_answer_body(item),
        )
    assert response.json()["status"] == "unavailable"
    assert response.json()["selections"] == []
    assert fake.calls == 0


def test_answer_clients_are_cached_per_disclosure_and_closed_at_shutdown(tmp_path, monkeypatch) -> None:
    configure_provider(monkeypatch)
    item = source("Synthetic decision with exact evidence.")
    store = _ready_store(tmp_path / "queue.sqlite", item)
    clients: list[ClosableAnswerClient] = []

    def make_client():
        client = ClosableAnswerClient(item)
        clients.append(client)
        return client, object()

    monkeypatch.setattr("recall.knowledge.providers.configured_clients", make_client)
    app = create_app(store=store, adapter=object(), token=TOKEN, db_path=tmp_path / "graph.db")
    headers = {"Authorization": f"Bearer {TOKEN}"}
    with TestClient(app, base_url="http://127.0.0.1") as client:
        for _ in range(2):
            response = client.post("/v1/answer", headers=headers, json=_answer_body(item))
            assert response.json()["status"] == "supported"
        assert len(clients) == 1
        assert clients[0].calls == 2

        monkeypatch.setenv("RECALL_GRAPH_ANTHROPIC_MODEL", "claude-sonnet-4-5")
        changed_provider = configured_extraction_identity()
        replacement = Snapshot(
            **{
                **consented_snapshot(item, generation=2).model_dump(),
                "answer_provider": changed_provider,
            }
        )
        store.submit(replacement)
        response = client.post(
            "/v1/answer", headers=headers, json=_answer_body(item, generation=2)
        )
        assert response.json()["status"] == "supported"
        assert len(clients) == 2
        assert clients[0].calls == 2
        assert clients[1].calls == 1
    assert [entry.close_calls for entry in clients] == [1, 1]


def test_request_id_is_durable_and_never_replayed_after_restart(tmp_path, monkeypatch) -> None:
    provider = configure_provider(monkeypatch)
    item = source("Synthetic decision")
    path = tmp_path / "queue.sqlite"
    store = _ready_store(path, item)
    request = AnswerRequest.model_validate(_answer_body(item))
    store.begin_answer(request, provider)
    reopened = SnapshotStore(path)
    assert reopened.answer_state(SCOPE, request.request_id) == "unknown"
    with pytest.raises(DuplicateAnswerRequest):
        reopened.begin_answer(request, provider)

