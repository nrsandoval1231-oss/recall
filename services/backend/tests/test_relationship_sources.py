"""Relationship candidates retain only their own source-backed evidence."""

from __future__ import annotations

import uuid
from typing import Any

from conftest import Env
from fake_provider import FakeProvider
from recall.ingestion.worker import Worker
from test_recall import admin, capture_with, consent, drain

pytest_plugins = ("test_recall",)


def _relationship_extraction(data: dict[str, Any]) -> None:
    page = data["pages"][0]["page_id"]
    text = data["pages"][0]["transcription"]
    confirmation = "Alex two confirms it again." if "again" in text else "Alex two confirms it."
    data["mentions"] = [
        {
            "local_id": "m1",
            "kind": "person",
            "raw_text": "Alex",
            "evidence": [{"page_id": page, "quote": "Alex one works with Jordan."}],
        },
        {
            "local_id": "m2",
            "kind": "person",
            "raw_text": "Alex",
            "evidence": [{"page_id": page, "quote": confirmation}],
        },
        {
            "local_id": "m3",
            "kind": "person",
            "raw_text": "Jordan",
            "evidence": [{"page_id": page, "quote": "Alex one works with Jordan."}],
        },
    ]
    data["statements"] = [
        {
            "local_id": "s1",
            "kind": "relationship",
            "subject_mention_id": "m1",
            "predicate": "works_with",
            "text": text,
            "value_text": None,
            "epistemic_state": "reported",
            "attribution_text": None,
            "temporal_text": None,
            "object_mention_id": "m3",
            "evidence": [{"page_id": page, "quote": "Alex one works with Jordan."}],
        }
    ]


def _mentions_without_relationship(data: dict[str, Any]) -> None:
    page = data["pages"][0]["page_id"]
    data["mentions"] = [
        {"local_id": "m1", "kind": "person", "raw_text": "Alex", "evidence": [{"page_id": page, "quote": "Alex"}]},
        {"local_id": "m2", "kind": "person", "raw_text": "Jordan", "evidence": [{"page_id": page, "quote": "Jordan"}]},
    ]
    data["statements"] = []


def test_candidate_relationships_merge_source_evidence_and_stay_local_to_memory(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    fake.mutate = _relationship_extraction
    first = capture_with(ai, user, fake, ["Alex one works with Jordan. Alex two confirms it."])
    second = capture_with(ai, user, fake, ["Alex one works with Jordan. Alex two confirms it again."])
    drain(worker)

    assert admin(ai, "select status,last_error_code from processing_jobs order by created_at") == [
        ("succeeded", None),
        ("succeeded", None),
    ]

    first_memory = user.req("GET", f"/v1/captures/{first['capture_id']}").json()["memory_id"]
    second_memory = user.req("GET", f"/v1/captures/{second['capture_id']}").json()["memory_id"]
    first_response = user.req("GET", f"/v1/memories/{first_memory}")
    assert first_response.status_code == 200, first_response.text
    first_view = first_response.json()
    # Two source spans propose the same Alex entity, but the memory entity list is canonical.
    assert len(first_view["entities"]) == 2, first_view["mentions"]
    assert len(first_view["relationships"]) == 1
    evidence = first_view["relationships"][0]["evidence"]
    assert {item["page_id"] for item in evidence} == {first["pages"][0]["source_id"], second["pages"][0]["source_id"]}

    fake.mutate = _mentions_without_relationship
    unrelated = capture_with(ai, user, fake, ["Alex spoke with Jordan about groceries."])
    drain(worker)
    unrelated_memory = user.req("GET", f"/v1/captures/{unrelated['capture_id']}").json()["memory_id"]
    unrelated_view = user.req("GET", f"/v1/memories/{unrelated_memory}").json()
    assert len(unrelated_view["entities"]) == 2
    assert unrelated_view["relationships"] == []

    first_capture = user.req("GET", f"/v1/captures/{first['capture_id']}").json()
    deleted = user.req(
        "DELETE",
        f"/v1/captures/{first['capture_id']}",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(first_capture["version"])},
    )
    assert deleted.status_code == 200, deleted.text
    surviving = user.req("GET", f"/v1/memories/{second_memory}").json()
    assert len(surviving["relationships"]) == 1
    assert surviving["relationships"][0]["evidence"] == [
        {"page_id": second["pages"][0]["source_id"], "quote": "Alex one works with Jordan."}
    ]
