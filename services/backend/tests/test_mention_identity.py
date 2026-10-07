"""Grounded mention identity regressions using synthetic source text and real PostgreSQL."""

from __future__ import annotations

import uuid
from typing import Any

from conftest import Env
from fake_provider import FakeProvider
from recall.ingestion.worker import Worker
from test_recall import admin, capture_with, consent, drain

pytest_plugins = ("test_recall",)


SOURCE = "Alex met Jordan; Jordan met Alex."


def _grounded_mentions(data: dict[str, Any], *, with_relationships: bool = False) -> None:
    page_id = data["pages"][0]["page_id"]
    evidence = [{"page_id": page_id, "quote": SOURCE}]
    data["mentions"] = [
        {"local_id": "m1", "kind": "person", "raw_text": "Alex", "evidence": evidence},
        {"local_id": "m2", "kind": "person", "raw_text": "Jordan", "evidence": evidence},
    ]
    if with_relationships:
        data["statements"] = [
            {
                "local_id": "s1",
                "kind": "relationship",
                "subject_mention_id": "m1",
                "predicate": "met",
                "text": "Alex met Jordan.",
                "value_text": None,
                "epistemic_state": "reported",
                "attribution_text": None,
                "temporal_text": None,
                "object_mention_id": "m2",
                "evidence": evidence,
            },
            {
                "local_id": "s2",
                "kind": "relationship",
                "subject_mention_id": "m2",
                "predicate": "met",
                "text": "Jordan met Alex.",
                "value_text": None,
                "epistemic_state": "reported",
                "attribution_text": None,
                "temporal_text": None,
                "object_mention_id": "m1",
                "evidence": evidence,
            },
        ]


def _capture_memory(ai: Env, user: Any, fake: FakeProvider, worker: Worker) -> str:
    capture = capture_with(ai, user, fake, [SOURCE])
    drain(worker)
    return user.req("GET", f"/v1/captures/{capture['capture_id']}").json()["memory_id"]


def test_two_people_with_the_same_full_quote_remain_separate_mentions(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    fake.mutate = _grounded_mentions
    memory_id = _capture_memory(ai, user, fake, worker)

    memory = user.req("GET", f"/v1/memories/{memory_id}").json()
    assert {mention["text"] for mention in memory["mentions"]} == {"Alex", "Jordan"}
    keys = admin(ai, "select evidence_key from mentions where memory_id=%s order by evidence_key", (memory_id,))
    assert len(keys) == 2 and keys[0] != keys[1]


def test_accepting_one_same_quote_mention_never_accepts_the_other_on_rerun(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    fake.mutate = _grounded_mentions
    memory_id = _capture_memory(ai, user, fake, worker)
    initial = user.req("GET", f"/v1/memories/{memory_id}").json()
    alex = next(mention for mention in initial["mentions"] if mention["text"] == "Alex")

    accepted = user.req(
        "POST",
        f"/v1/memories/{memory_id}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={
            "target": "mention_identity",
            "mention_id": alex["mention_id"],
            "entity_id": alex["entity_id"],
            "resolution": "accepted",
        },
    )
    assert accepted.status_code == 200, accepted.text

    capture_id = admin(ai, "select capture_id from memories where id=%s", (memory_id,))[0][0]
    admin(
        ai,
        "update processing_jobs set status='queued',not_before=now(),finished_at=null where capture_id=%s",
        (capture_id,),
    )
    drain(worker)

    rerun = user.req("GET", f"/v1/memories/{memory_id}").json()
    by_text = {mention["text"]: mention for mention in rerun["mentions"]}
    assert by_text["Alex"]["resolution"] == "accepted"
    assert by_text["Alex"]["entity_id"] == alex["entity_id"]
    assert by_text["Jordan"]["resolution"] == "candidate"


def test_reversed_subject_and_object_with_same_quote_have_distinct_claim_keys(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)

    def reversed_relationships(data: dict[str, Any]) -> None:
        _grounded_mentions(data, with_relationships=True)

    fake.mutate = reversed_relationships
    memory_id = _capture_memory(ai, user, fake, worker)

    memory = user.req("GET", f"/v1/memories/{memory_id}").json()
    assert {claim["text"] for claim in memory["claims"]} == {"Alex met Jordan.", "Jordan met Alex."}
    keys = admin(ai, "select evidence_key from claims where memory_id=%s order by evidence_key", (memory_id,))
    assert len(keys) == 2 and keys[0] != keys[1]
