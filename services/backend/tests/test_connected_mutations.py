"""RCL-003 identity mutation regressions against a real RLS PostgreSQL cluster."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from conftest import Env, User
from fake_provider import FakeProvider
from recall.ingestion.worker import Worker
from test_recall import admin, capture_with, consent, drain

pytest_plugins = ("test_recall",)


def test_same_name_across_captures_only_proposes_identity_and_entity_view_is_traceable(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user, foreign = ai.user(), ai.user()
    consent(user)

    def john(data: dict) -> None:
        page = data["pages"][0]["page_id"]
        data["mentions"] = [
            {"local_id": "m1", "kind": "person", "raw_text": "John", "evidence": [{"page_id": page, "quote": "John"}]}
        ]

    fake.mutate = john
    first = capture_with(ai, user, fake, ["John from Houston recommended the museum."])
    second = capture_with(ai, user, fake, ["John from Boston recommended the market."])
    drain(worker)
    rows = admin(
        ai,
        "select resolution_status,entity_id from mentions where workspace_id=%s",
        (user.req("GET", "/v1/me").json()["active_workspace_id"],),
    )
    assert len(rows) == 2 and all(row[0] == "candidate" for row in rows)
    entity = str(rows[0][1])
    detail = user.req("GET", f"/v1/entities/{entity}")
    assert detail.status_code == 200, detail.text
    assert {item["capture_id"] for item in detail.json()["memories"]} == {first["capture_id"], second["capture_id"]}
    assert all(item["status"] == "candidate" for item in detail.json()["mentions"])
    foreign.req("GET", "/v1/me")
    assert foreign.req("GET", f"/v1/entities/{entity}").status_code == 404


def _entity(user: User, name: str) -> str:
    response = user.req(
        "POST",
        "/v1/entities",
        headers={"Idempotency-Key": f"entity-{uuid.uuid4()}"},
        json={"kind": "person", "canonical_name": name},
    )
    assert response.status_code == 201
    return response.json()["entity_id"]


def test_claim_validity_can_be_cleared_without_losing_actor_history(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    capture = capture_with(ai, user, fake, ["Pump pressure remains uncertain at 42 psi?"])
    drain(worker)
    memory = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()["memory_id"]
    claim = user.req("GET", f"/v1/memories/{memory}").json()["claims"][0]["claim_id"]
    for revision, payload in [(1, {"valid_to": "2027-01-01T00:00:00Z"}), (2, {"valid_to": None})]:
        response = user.req(
            "POST",
            f"/v1/memories/{memory}/corrections",
            headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(revision)},
            json={"target": "claim", "claim_id": claim, **payload},
        )
        assert response.status_code == 200, response.text
    current = user.req("GET", f"/v1/memories/{memory}").json()["claims"][0]
    assert current["valid_to"] is None and current["epistemic_state"] == "uncertain"
    audit = admin(
        ai, "select validation->'correction' from memory_revisions where memory_id=%s and revision=3", (memory,)
    )[0][0]
    assert audit["actor_id"] == str(user.id) and audit["body"]["valid_to"] is None
    assert user.req("POST", "/v1/ask", json={"question": "pressure", "entity_ids": ["not-a-uuid"]}).status_code == 422


def _memory_with_mentions(ai: Env, user: User, fake: FakeProvider, worker: Worker) -> tuple[str, list[str]]:
    consent(user)

    def mentions(data: dict) -> None:
        page = data["pages"][0]["page_id"]
        data["mentions"] = [
            {"local_id": "m1", "kind": "person", "raw_text": "Alex", "evidence": [{"page_id": page, "quote": "Alex"}]},
            {
                "local_id": "m2",
                "kind": "person",
                "raw_text": "Jordan",
                "evidence": [{"page_id": page, "quote": "Jordan"}],
            },
        ]

    fake.mutate = mentions
    cap = capture_with(ai, user, fake, ["Alex met Jordan"])
    drain(worker)
    memory_id = user.req("GET", f"/v1/captures/{cap['capture_id']}").json()["memory_id"]
    rows = admin(ai, "select id from mentions where memory_id=%s order by local_id", (memory_id,))
    return memory_id, [str(row[0]) for row in rows]


def _accept(user: User, memory_id: str, mention_id: str, entity_id: str, revision: int) -> int:
    response = user.req(
        "POST",
        f"/v1/memories/{memory_id}/corrections",
        headers={"Idempotency-Key": f"mention-{uuid.uuid4()}", "If-Match": str(revision)},
        json={"target": "mention_identity", "mention_id": mention_id, "entity_id": entity_id, "resolution": "accepted"},
    )
    assert response.status_code == 200, response.text
    return response.json()["revision"]


def test_merge_split_are_versioned_idempotent_and_keep_history(ai: Env, fake: FakeProvider, worker: Worker) -> None:
    user = ai.user()
    memory_id, mentions = _memory_with_mentions(ai, user, fake, worker)
    source, target = _entity(user, "Alex Smith"), _entity(user, "Alex Cooper")
    revision = _accept(user, memory_id, mentions[0], source, 1)
    revision = _accept(user, memory_id, mentions[1], source, revision)
    preview = user.req("GET", f"/v1/entities/{source}/identity-preview/{target}")
    assert preview.status_code == 200 and preview.json()["accepted_mentions"] == 2
    body = {"source_version": 1, "target_version": 1, "mention_ids": []}
    key = "merge-identity-0001"
    merged = user.req("POST", f"/v1/entities/{source}/identity/{target}", headers={"Idempotency-Key": key}, json=body)
    assert merged.status_code == 200 and merged.json()["operation"] == "merge" and merged.json()["moved_mentions"] == 2
    replay = user.req("POST", f"/v1/entities/{source}/identity/{target}", headers={"Idempotency-Key": key}, json=body)
    assert replay.status_code == 200 and replay.json()["replayed"] is True
    assert admin(ai, "select count(*) from identity_operations")[0][0] == 1
    assert (
        admin(ai, "select count(*) from mentions where entity_id=%s and resolution_status='accepted'", (target,))[0][0]
        == 2
    )
    # Reassign one accepted mention back through an explicit split; stale versions never silently win.
    stale = user.req(
        "POST",
        f"/v1/entities/{target}/identity/{source}",
        headers={"Idempotency-Key": "split-stale-0001"},
        json={"source_version": 1, "target_version": 2, "mention_ids": [mentions[0]]},
    )
    assert stale.status_code == 409
    split = user.req(
        "POST",
        f"/v1/entities/{target}/identity/{source}",
        headers={"Idempotency-Key": "split-live-0001"},
        json={"source_version": 2, "target_version": 2, "mention_ids": [mentions[0]]},
    )
    assert split.status_code == 200 and split.json()["operation"] == "split" and split.json()["moved_mentions"] == 1
    history = admin(
        ai, "select operation,jsonb_array_length(moved_mention_ids) from identity_operations order by created_at"
    )
    assert history == [("merge", 2), ("split", 1)]


def test_identity_operations_are_workspace_scoped(ai: Env, fake: FakeProvider, worker: Worker) -> None:
    owner = ai.user()
    memory_id, mentions = _memory_with_mentions(ai, owner, fake, worker)
    source, target = _entity(owner, "Same Name A"), _entity(owner, "Same Name B")
    _accept(owner, memory_id, mentions[0], source, 1)
    intruder = ai.user()
    assert intruder.req("GET", f"/v1/entities/{source}/identity-preview/{target}").status_code == 404
    denied = intruder.req(
        "POST",
        f"/v1/entities/{source}/identity/{target}",
        headers={"Idempotency-Key": "other-tenant-0001"},
        json={"source_version": 1, "target_version": 1, "mention_ids": []},
    )
    assert denied.status_code == 404


def test_correction_replay_conflict_transcription_and_reprocessing_precedence(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    cap = capture_with(ai, user, fake, ["Pump 42 psi\nKeep the spare valve"])
    drain(worker)
    memory_id = user.req("GET", f"/v1/captures/{cap['capture_id']}").json()["memory_id"]
    page_id = cap["pages"][0]["source_id"]
    key = str(uuid.uuid4())
    body = {"target": "summary", "text": "User reviewed pressure and spare valve."}

    def correct(payload: dict, revision: int, operation: str | None = None):
        return user.req(
            "POST",
            f"/v1/memories/{memory_id}/corrections",
            json=payload,
            headers={"Idempotency-Key": operation or str(uuid.uuid4()), "If-Match": str(revision)},
        )

    assert correct(body, 1, key).status_code == 200
    replay = correct(body, 1, key)
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert correct({"target": "summary", "text": "Wrong replay"}, 1, key).status_code == 409
    assert correct(body, 1).status_code == 409
    assert user.req("GET", "/v1/search", params={"q": "spare valve"}).json()["results"]
    transcript = correct(
        {"target": "transcription", "page_id": page_id, "text": "Pump 43 psi\nKeep the spare valve"}, 2
    )
    assert transcript.status_code == 200, transcript.text
    assert user.req("GET", "/v1/search", params={"q": "43"}).json()["results"]
    # A later model run still proposes the old reading. Canonical user decisions win.
    admin(
        ai,
        "update processing_jobs set status='queued',not_before=now(),finished_at=null where capture_id=%s",
        (cap["capture_id"],),
    )
    drain(worker)
    detail = user.req("GET", f"/v1/memories/{memory_id}").json()
    assert detail["interpretation"]["summary"] == body["text"]
    assert detail["interpretation"]["pages"][0]["transcription"].startswith("Pump 43 psi")
    assert len(detail["history"]) == 4


def test_claim_correction_is_canonical_and_survives_old_model_proposal(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    cap = capture_with(ai, user, fake, ["Recorded 42 psi\nSpare valve stored in garage"])
    drain(worker)
    memory_id = user.req("GET", f"/v1/captures/{cap['capture_id']}").json()["memory_id"]
    original = user.req("GET", f"/v1/memories/{memory_id}").json()
    claim = next(item for item in original["claims"] if "42" in item["text"])
    response = user.req(
        "POST",
        f"/v1/memories/{memory_id}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={
            "target": "claim",
            "claim_id": claim["claim_id"],
            "text": "Recorded 43 psi",
            "epistemic_state": "confirmed_by_user",
            "valid_from": "2026-10-01T00:00:00Z",
        },
    )
    assert response.status_code == 200, response.text
    assert user.req("GET", "/v1/search", params={"q": "garage"}).json()["results"]
    admin(
        ai,
        "update processing_jobs set status='queued',not_before=now(),finished_at=null where capture_id=%s",
        (cap["capture_id"],),
    )
    drain(worker)
    detail = user.req("GET", f"/v1/memories/{memory_id}").json()
    corrected = next(item for item in detail["claims"] if item["claim_id"] == claim["claim_id"])
    assert corrected["text"] == "Recorded 43 psi" and corrected["epistemic_state"] == "confirmed_by_user"
    hits = user.req("GET", "/v1/search", params={"q": "43"}).json()["results"]
    assert hits, "Canonical corrected claim must remain searchable after a model rerun."


def test_synthetic_life_journey_keeps_sources_and_user_number_through_reprocessing(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    """Synthetic Daniel/Sarah/April-to-June journey; no live model-quality claim."""
    user = ai.user()
    consent(user)
    daniel = capture_with(ai, user, fake, ["Daniel met Sarah. Call 713-555-0100?"])
    april = capture_with(ai, user, fake, ["April: Atlas launch planned."])
    june = capture_with(ai, user, fake, ["June: Atlas launch deferred."])
    drain(worker)
    memory_id = user.req("GET", f"/v1/captures/{daniel['capture_id']}").json()["memory_id"]
    detail = user.req("GET", f"/v1/memories/{memory_id}").json()
    claim = next(item for item in detail["claims"] if "713" in item["text"])
    corrected = user.req(
        "POST",
        f"/v1/memories/{memory_id}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={
            "target": "claim",
            "claim_id": claim["claim_id"],
            "text": "Daniel's work number is 713-555-0100.",
            "epistemic_state": "confirmed_by_user",
        },
    )
    assert corrected.status_code == 200, corrected.text
    admin(
        ai,
        "update processing_jobs set status='queued',not_before=now(),finished_at=null where capture_id=%s",
        (daniel["capture_id"],),
    )
    drain(worker)
    reread = user.req("GET", f"/v1/memories/{memory_id}").json()
    assert any(item["text"] == "Daniel's work number is 713-555-0100." for item in reread["claims"])
    assert user.req("GET", f"/v1/sources/{daniel['pages'][0]['source_id']}/content").status_code == 200
    april_memory = user.req("GET", f"/v1/captures/{april['capture_id']}").json()["memory_id"]
    june_memory = user.req("GET", f"/v1/captures/{june['capture_id']}").json()["memory_id"]
    april_claim = user.req("GET", f"/v1/memories/{april_memory}").json()["claims"][0]
    june_claim = user.req("GET", f"/v1/memories/{june_memory}").json()["claims"][0]
    historical_at = april_claim["created_at"]
    expire_april = user.req(
        "POST",
        f"/v1/memories/{april_memory}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={"target": "claim", "claim_id": april_claim["claim_id"], "valid_to": "2026-01-01T00:00:00Z"},
    )
    assert expire_april.status_code == 200, expire_april.text
    supersede = user.req(
        "POST",
        f"/v1/memories/{june_memory}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={
            "target": "claim",
            "claim_id": june_claim["claim_id"],
            "supersedes_claim_id": april_claim["claim_id"],
            "valid_from": "2026-01-01T00:00:00Z",
        },
    )
    assert supersede.status_code == 200, supersede.text
    current = user.req("POST", "/v1/ask", json={"question": "What happened with Atlas launch?"})
    assert current.status_code == 200 and current.json()["status"] == "answered"
    assert {citation["memory_id"] for citation in current.json()["citations"]} == {june_memory}
    historical = user.req(
        "POST", "/v1/ask", json={"question": "What was the original Atlas launch plan?", "as_of": historical_at}
    )
    assert historical.status_code == 200 and historical.json()["status"] == "answered"
    assert {citation["memory_id"] for citation in historical.json()["citations"]} == {april_memory}


def test_claim_validity_only_correction_is_versioned(ai: Env, fake: FakeProvider, worker: Worker) -> None:
    user = ai.user()
    consent(user)
    cap = capture_with(ai, user, fake, ["April Atlas launch planned."])
    drain(worker)
    memory_id = user.req("GET", f"/v1/captures/{cap['capture_id']}").json()["memory_id"]
    claim = user.req("GET", f"/v1/memories/{memory_id}").json()["claims"][0]
    response = user.req(
        "POST",
        f"/v1/memories/{memory_id}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={"target": "claim", "claim_id": claim["claim_id"], "valid_to": "2026-05-01T00:00:00Z"},
    )
    assert response.status_code == 200, response.text
    updated = user.req("GET", f"/v1/memories/{memory_id}").json()["claims"][0]
    assert updated["text"] == claim["text"]
    assert datetime.fromisoformat(updated["valid_to"]).astimezone(UTC).isoformat() == "2026-05-01T00:00:00+00:00"
