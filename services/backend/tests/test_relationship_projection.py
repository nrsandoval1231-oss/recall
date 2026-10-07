"""PostgreSQL relationship projection and correction regressions."""

from __future__ import annotations

import json
import uuid

from conftest import Env
from fake_provider import FakeProvider
from recall.ingestion.provider import InterpretRequest
from recall.ingestion.worker import Worker
from test_recall import admin, capture_with, consent, drain

pytest_plugins = ["test_recall"]


def relationship_extraction(request: InterpretRequest) -> str:
    page_id = request.envelope["pages"][0]["page_id"]
    evidence = [{"page_id": page_id, "quote": "Alex met Jordan"}]
    return json.dumps(
        {
            "schema_version": "1.1",
            "capture_id": request.envelope["capture_id"],
            "input_manifest_sha256": request.envelope["input_manifest_sha256"],
            "summary": "Alex met Jordan",
            "summary_evidence": evidence,
            "pages": [{"page_id": page_id, "ordinal": 1, "transcription": "Alex met Jordan", "legibility": "clear"}],
            "mentions": [
                {"local_id": "m1", "kind": "person", "raw_text": "Alex", "evidence": evidence},
                {"local_id": "m2", "kind": "person", "raw_text": "Jordan", "evidence": evidence},
            ],
            "statements": [
                {
                    "local_id": "s1",
                    "kind": "observation",
                    "subject_mention_id": "m1",
                    "object_mention_id": "m2",
                    "predicate": "met",
                    "text": "Alex met Jordan",
                    "value_text": None,
                    "epistemic_state": "reported",
                    "attribution_text": None,
                    "temporal_text": None,
                    "evidence": evidence,
                }
            ],
            "action_suggestions": [],
            "uncertainties": [],
        }
    )


def test_relationship_projection_correction_and_entity_timeline(ai: Env, fake: FakeProvider, worker: Worker) -> None:
    user = ai.user()
    consent(user)
    fake.interpret_script.append(relationship_extraction)
    capture = capture_with(ai, user, fake, ["Alex met Jordan"], hint="relationship regression")
    drain(worker)
    memory_id = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()["memory_id"]
    entities = user.req("GET", "/v1/entities?q=Alex&kind=person").json()["items"]
    assert len(entities) == 1
    alex = entities[0]
    jordan = user.req("GET", "/v1/entities?q=Jordan&kind=person").json()["items"][0]
    detail = user.req("GET", f"/v1/entities/{alex['entity_id']}").json()
    assert detail["relationships"][0]["type"] == "met"
    assert detail["relationships"][0]["from_name"] == "Alex"
    assert detail["relationships"][0]["to_name"] == "Jordan"
    assert detail["timeline"] and detail["timeline"][0]["claim_id"] and detail["timeline"][0]["memory_id"]
    original_evidence = detail["relationships"][0]["evidence"]

    response = user.req(
        "POST",
        f"/v1/memories/{memory_id}/corrections",
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
        json={
            "target": "relationship",
            "from_entity_id": alex["entity_id"],
            "to_entity_id": jordan["entity_id"],
            "relation_type": "met",
            "resolution": "accepted",
            "valid_from": "2026-04-01T00:00:00Z",
            "valid_to": "2026-06-01T00:00:00Z",
        },
    )
    assert response.status_code == 200, response.text
    row = user.req("GET", f"/v1/entities/{alex['entity_id']}").json()["relationships"][0]
    assert (
        row["status"] == "accepted"
        and row["valid_from"].startswith(("2026-03-31", "2026-04-01"))
        and row["evidence"] == original_evidence
        and row["evidence"]
    )

    # A subsequent model projection cannot turn the accepted relationship back into a candidate.
    fake.interpret_script.append(relationship_extraction)
    admin(
        ai,
        "update processing_jobs set status='queued',not_before=now(),finished_at=null where capture_id=%s",
        (capture["capture_id"],),
    )
    drain(worker)
    detail_again = user.req("GET", f"/v1/entities/{alex['entity_id']}").json()
    assert detail_again["relationships"][0]["status"] == "accepted"
