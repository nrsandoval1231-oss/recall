import json
import uuid

from conftest import Env
from fake_provider import FakeProvider
from recall.domain.memories import infer_temporal_mode, infer_temporal_request
from recall.ingestion.provider import AnswerRequest
from recall.ingestion.worker import Worker
from test_recall import capture_with, consent, drain

pytest_plugins = ("test_recall",)


def test_natural_temporal_modes_are_bounded() -> None:
    assert infer_temporal_mode("what was the original estimate?") == ("original", None)
    assert infer_temporal_mode("did the number change?") == ("changed", None)
    assert infer_temporal_mode("what was the previous plan?") == ("previous", None)


def test_relative_time_is_ambiguous_without_an_explicit_cutoff() -> None:
    mode, limitation = infer_temporal_mode("what changed last month?")
    assert mode is None
    assert limitation and "explicit ISO-8601" in limitation


def test_natural_temporal_ask_uses_relevant_claim_history_and_citations(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    # This deliberately precedes Atlas: an original-claim query must not select it
    # merely because it is the earliest memory in the workspace.
    capture_with(ai, user, fake, ["Old garage inventory: two ladders."])
    april = capture_with(ai, user, fake, ["Atlas launch was planned for April."])
    june = capture_with(ai, user, fake, ["Atlas launch was deferred in June."])
    drain(worker)

    april_memory = user.req("GET", f"/v1/captures/{april['capture_id']}").json()["memory_id"]
    june_memory = user.req("GET", f"/v1/captures/{june['capture_id']}").json()["memory_id"]
    april_claim = user.req("GET", f"/v1/memories/{april_memory}").json()["claims"][0]
    june_claim = user.req("GET", f"/v1/memories/{june_memory}").json()["claims"][0]
    expired = user.req(
        "POST",
        f"/v1/memories/{april_memory}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={"target": "claim", "claim_id": april_claim["claim_id"], "valid_to": "2026-06-01T00:00:00Z"},
    )
    assert expired.status_code == 200, expired.text
    superseded = user.req(
        "POST",
        f"/v1/memories/{june_memory}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={
            "target": "claim",
            "claim_id": june_claim["claim_id"],
            "supersedes_claim_id": april_claim["claim_id"],
            "valid_from": "2026-06-01T00:00:00Z",
        },
    )
    assert superseded.status_code == 200, superseded.text

    current = user.req("POST", "/v1/ask", json={"question": "What is the Atlas launch status?"})
    assert current.status_code == 200 and current.json()["status"] == "answered"
    assert {item["memory_id"] for item in current.json()["citations"]} == {june_memory}

    original = user.req("POST", "/v1/ask", json={"question": "What was the original Atlas launch plan?"})
    assert original.status_code == 200 and original.json()["status"] == "answered"
    assert original.json()["temporal_mode"] == "original"
    assert {item["memory_id"] for item in original.json()["citations"]} == {april_memory}
    assert original.json()["citations"][0]["history_status"] in {"recorded", "superseded"}
    assert original.json()["citations"][0]["source_id"] == april["pages"][0]["source_id"]

    def cite_history(request: AnswerRequest) -> str:
        packet = request.packet
        return json.dumps(
            {
                "status": "answered",
                "sentences": [
                    {
                        "text": "The recorded Atlas history has multiple supported versions.",
                        "citation_ids": [item["citation_id"] for item in packet],
                    }
                ],
                "limitations": [],
            }
        )

    fake.answer_script.append(cite_history)
    changed = user.req("POST", "/v1/ask", json={"question": "How did the Atlas launch change?"})
    assert changed.status_code == 200 and changed.json()["status"] == "answered"
    citations = changed.json()["citations"]
    assert {item["memory_id"] for item in citations} == {april_memory, june_memory}
    assert all(item["recorded_at"] and item["history_status"] for item in citations)
    assert any(item["valid_to"] for item in citations)
    assert any(item["supersedes_claim_id"] for item in citations)

    ambiguous = user.req("POST", "/v1/ask", json={"question": "How did Atlas change last month?"})
    assert ambiguous.status_code == 200
    assert ambiguous.json()["reason"] == "AMBIGUOUS_TIME"
    assert ambiguous.json()["citations"] == []

    guarded = user.req(
        "POST",
        "/v1/ask",
        json={
            "question": "Atlas launch",
            "as_of": april_claim["created_at"],
            "entity_ids": [str(uuid.uuid4())],
        },
    )
    assert guarded.status_code == 422
    natural_identity = user.req(
        "POST",
        "/v1/ask",
        json={"question": "What was the original Atlas launch plan?", "entity_ids": [str(uuid.uuid4())]},
    )
    assert natural_identity.status_code == 422


def test_explicit_before_after_requires_timezone() -> None:
    mode, cutoff, note = infer_temporal_request("Atlas before 2026-05-01T00:00:00Z")
    assert mode == "before" and cutoff is not None and note is None
    mode, cutoff, note = infer_temporal_request("Atlas after 2026-06-01T00:00:00Z")
    assert mode == "after" and cutoff is not None and note is None
