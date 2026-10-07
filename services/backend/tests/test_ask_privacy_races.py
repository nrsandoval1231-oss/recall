"""Ask rechecks private evidence after provider I/O on a real PostgreSQL database."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from typing import Any, cast

from conftest import Env, User
from fake_provider import FakeProvider
from recall.ingestion.provider import AnswerRequest
from recall.ingestion.worker import Worker
from test_recall import admin, capture_with, consent, drain

pytest_plugins = ("test_recall",)


def _answer_after(action: Callable[[], None]) -> Callable[[AnswerRequest], str]:
    def respond(request: AnswerRequest) -> str:
        action()
        return json.dumps(
            {
                "status": "answered",
                "sentences": [{"text": "Private source result.", "citation_ids": [request.packet[0]["citation_id"]]}],
                "limitations": [],
            }
        )

    return respond


def _prepared(
    ai: Env, fake: FakeProvider, worker: Worker, text: str = "Private Atlas launch note."
) -> tuple[User, dict[str, Any]]:
    user = ai.user()
    consent(user)
    capture = capture_with(ai, user, fake, [text])
    drain(worker)
    return user, capture


def _answer_usage(ai: Env) -> int:
    return cast(int, admin(ai, "select count(*) from ai_usage where purpose='answer'")[0][0])


def test_ask_discards_provider_result_when_consent_revoked_during_io(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user, _ = _prepared(ai, fake, worker)

    def revoke() -> None:
        consent(user, False)

    fake.answer_script.append(_answer_after(revoke))
    response = user.req("POST", "/v1/ask", json={"question": "Atlas launch"})
    assert response.status_code == 200
    body = response.json()
    assert body["reason"] == "CONSENT_REQUIRED"
    assert body["answer"] is None and body["sources"] == [] and body["citations"] == []
    assert _answer_usage(ai) == 0


def test_ask_discards_provider_result_when_capture_deleted_during_io(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user, capture = _prepared(ai, fake, worker)

    def delete() -> None:
        view = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()
        response = user.req(
            "DELETE",
            f"/v1/captures/{capture['capture_id']}",
            headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(view["version"])},
        )
        assert response.status_code == 200, response.text

    fake.answer_script.append(_answer_after(delete))
    response = user.req("POST", "/v1/ask", json={"question": "Atlas launch"})
    assert response.status_code == 200
    body = response.json()
    assert body["reason"] == "EVIDENCE_DELETED"
    assert body["answer"] is None and body["sources"] == [] and body["citations"] == []
    assert _answer_usage(ai) == 0


def test_ask_workspace_erase_during_io_cannot_resurrect_answer_usage(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user, _ = _prepared(ai, fake, worker)

    def erase() -> None:
        preview = user.req("GET", "/v1/workspace/deletion-preview").json()
        response = user.req(
            "DELETE",
            "/v1/workspace/data",
            headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(preview["version"])},
        )
        assert response.status_code == 200, response.text

    fake.answer_script.append(_answer_after(erase))
    response = user.req("POST", "/v1/ask", json={"question": "Atlas launch"})
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] is None and body["sources"] == [] and body["citations"] == []
    assert _answer_usage(ai) == 0


def test_current_ask_discards_result_after_correction_but_original_history_remains_valid(
    ai: Env, fake: FakeProvider, worker: Worker
) -> None:
    user, capture = _prepared(ai, fake, worker, "Atlas launch was planned for April.")
    memory_id = user.req("GET", f"/v1/captures/{capture['capture_id']}").json()["memory_id"]
    claim = user.req("GET", f"/v1/memories/{memory_id}").json()["claims"][0]

    def correct() -> None:
        response = user.req(
            "POST",
            f"/v1/memories/{memory_id}/corrections",
            headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "1"},
            json={"target": "claim", "claim_id": claim["claim_id"], "valid_to": "2026-06-01T00:00:00Z"},
        )
        assert response.status_code == 200, response.text

    fake.answer_script.append(_answer_after(correct))
    current = user.req("POST", "/v1/ask", json={"question": "Atlas launch"})
    assert current.status_code == 200
    assert current.json()["reason"] == "EVIDENCE_CHANGED"
    assert current.json()["sources"] == [] and _answer_usage(ai) == 0

    def adjust_history_validity() -> None:
        response = user.req(
            "POST",
            f"/v1/memories/{memory_id}/corrections",
            headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": "2"},
            json={"target": "claim", "claim_id": claim["claim_id"], "valid_to": None},
        )
        assert response.status_code == 200, response.text

    # Historical packets name an immutable revision. A later current-projection
    # correction must not erase that still-present historical evidence.
    fake.answer_script.append(_answer_after(adjust_history_validity))
    original = user.req("POST", "/v1/ask", json={"question": "What was the original Atlas launch plan?"})
    assert original.status_code == 200
    assert original.json()["status"] == "answered"
    assert original.json()["sources"] and original.json()["citations"]
    assert _answer_usage(ai) == 1
