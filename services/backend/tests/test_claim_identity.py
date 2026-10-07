"""Canonical claim identity regressions using synthetic source text and real PostgreSQL."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from conftest import Env
from fake_provider import FakeProvider
from recall.ingestion.worker import Worker
from test_recall import admin, capture_with, consent, drain

pytest_plugins = ("test_recall",)


SOURCE = "Alex manages Atlas; Alex owns Atlas."


def _statement(local_id: str, predicate: str, text: str, page_id: str) -> dict[str, Any]:
    return {
        "local_id": local_id,
        "kind": "relationship",
        "subject_mention_id": None,
        "predicate": predicate,
        "text": text,
        "value_text": None,
        "epistemic_state": "reported",
        "attribution_text": None,
        "temporal_text": None,
        "object_mention_id": None,
        "evidence": [{"page_id": page_id, "quote": SOURCE}],
    }


def _mutate_statements(factory: Callable[[str], list[dict[str, Any]]]) -> Callable[[dict[str, Any]], None]:
    def mutate(extraction: dict[str, Any]) -> None:
        page_id = extraction["pages"][0]["page_id"]
        extraction["statements"] = factory(page_id)

    return mutate


def _distinct(page_id: str) -> list[dict[str, Any]]:
    return [
        _statement("s1", "manages", "Alex manages Atlas.", page_id),
        _statement("s2", "owns", "Alex owns Atlas.", page_id),
    ]


def test_same_evidence_with_different_predicates_creates_distinct_claims(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    fake.mutate = _mutate_statements(_distinct)
    capture = capture_with(ai, user, fake, [SOURCE])
    drain(worker)

    memory_id = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()["memory_id"]
    memory = user.req("GET", f"/v1/memories/{memory_id}").json()
    assert {claim["text"] for claim in memory["claims"]} == {"Alex manages Atlas.", "Alex owns Atlas."}
    keys = admin(ai, "select evidence_key from claims where memory_id=%s order by evidence_key", (memory_id,))
    assert len(keys) == 2 and keys[0] != keys[1]


def test_correction_survives_rerun_without_overriding_sibling_claim(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)
    fake.mutate = _mutate_statements(_distinct)
    capture = capture_with(ai, user, fake, [SOURCE])
    drain(worker)
    memory_id = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()["memory_id"]
    memory = user.req("GET", f"/v1/memories/{memory_id}").json()
    manages = next(claim for claim in memory["claims"] if claim["text"] == "Alex manages Atlas.")
    corrected = user.req(
        "POST",
        f"/v1/memories/{memory_id}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={
            "target": "claim",
            "claim_id": manages["claim_id"],
            "text": "Alex manages the Atlas program.",
            "epistemic_state": "confirmed_by_user",
        },
    )
    assert corrected.status_code == 200, corrected.text

    admin(
        ai,
        "update processing_jobs set status='queued',not_before=now(),finished_at=null where capture_id=%s",
        (capture["capture_id"],),
    )
    drain(worker)
    rerun = user.req("GET", f"/v1/memories/{memory_id}").json()
    by_text = {claim["text"]: claim for claim in rerun["claims"]}
    assert by_text["Alex manages the Atlas program."]["epistemic_state"] == "confirmed_by_user"
    assert "Alex owns Atlas." in by_text
    assert len(by_text) == 2


def test_duplicate_structural_claims_require_review_without_projection(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user = ai.user()
    consent(user)

    def duplicates(page_id: str) -> list[dict[str, Any]]:
        return [
            _statement("s1", "manages", "Alex manages Atlas.", page_id),
            _statement("s2", "manages", "Alex manages the Atlas program.", page_id),
        ]

    fake.mutate = _mutate_statements(duplicates)
    capture = capture_with(ai, user, fake, [SOURCE])
    drain(worker)
    view = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()
    memory = user.req("GET", f"/v1/memories/{view['memory_id']}").json()
    assert view["status"] == "needs_review"
    assert any(note["code"] == "AMBIGUOUS_CLAIM_IDENTITY" for note in memory["validation_notes"])
    assert memory["claims"] == []
    assert admin(
        ai, "select count(*) from search_chunks where memory_id=%s and kind='statement'", (view["memory_id"],)
    ) == [(0,)]
