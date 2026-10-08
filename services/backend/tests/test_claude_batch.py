"""Offline safety tests for the isolated one-batch synthetic Claude evaluation."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

EVAL_DIR = Path(__file__).resolve().parents[3] / "tests" / "evaluation" / "claude-selected-photo"
sys.path.insert(0, str(EVAL_DIR))
from batch import BatchJournal, default_journal_path, hold_usd, usage_within_hold  # noqa: E402

FIXTURE_HASH = "a" * 64


def journal_binding(operation_id: str, fixture_sha256: str = FIXTURE_HASH) -> dict[str, str]:
    return {"operation_id": operation_id, "source_sha256": fixture_sha256}


def test_fixed_synthetic_allowlist_hashes_and_cost_fit() -> None:
    manifest = json.loads((EVAL_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["synthetic_only"] is True
    assert manifest["human_handwriting_acceptance"] is False
    assert len(manifest["cases"]) == 5
    for case in manifest["cases"]:
        image = EVAL_DIR / case["path"]
        assert image.parent == EVAL_DIR
        assert hashlib.sha256(image.read_bytes()).hexdigest() == case["sha256"]
        assert case["classification"] == "synthetic_font_rendered_pipeline_smoke"
    assert 5 * hold_usd() < 5.0


def test_journal_exclusive_cap_and_single_use_survive_restart(tmp_path: Path) -> None:
    journal_path = tmp_path / "batch.json"
    cases = [f"synthetic-{index}" for index in range(8)]
    journal = BatchJournal(journal_path, cases)
    try:
        with pytest.raises(RuntimeError, match="another evaluation batch"):
            BatchJournal(journal_path, cases)
        for case in cases[:7]:
            index = int(case.rsplit("-", 1)[1])
            journal.reserve_before_dispatch(
                case,
                fixture_sha256=FIXTURE_HASH,
                operation_id=f"00000000-0000-4000-8000-{index + 1:012d}",
                binding=journal_binding(f"00000000-0000-4000-8000-{index + 1:012d}"),
            )
        with pytest.raises(RuntimeError, match="cap"):
            journal.reserve_before_dispatch(
                cases[7],
                fixture_sha256=FIXTURE_HASH,
                operation_id="00000000-0000-4000-8000-000000000008",
                binding=journal_binding("00000000-0000-4000-8000-000000000008"),
            )
        assert journal.data["reserved_usd"] == pytest.approx(7 * hold_usd())
        journal.settle(cases[0], state="unknown", input_tokens=None, output_tokens=None)
        assert journal.data["cases"][cases[0]]["state"] == "unknown"
        assert journal.data["reserved_usd"] == pytest.approx(7 * hold_usd())
    finally:
        journal.close()
    persisted = json.loads(journal_path.read_text(encoding="utf-8"))
    assert persisted["cases"][cases[0]]["state"] == "unknown"
    assert persisted["reserved_usd"] == pytest.approx(7 * hold_usd())
    assert persisted["cases"][cases[0]]["fixture_sha256"] == FIXTURE_HASH
    assert persisted["cases"][cases[0]]["operation_id"] == "00000000-0000-4000-8000-000000000001"
    with pytest.raises(RuntimeError, match="already been used"):
        BatchJournal(journal_path, cases)
    recovered = json.loads(journal_path.read_text(encoding="utf-8"))
    assert all(record["state"] != "in_flight" for record in recovered["cases"].values())
    assert recovered["reserved_usd"] == pytest.approx(7 * hold_usd())


def test_completion_records_usage_separately_from_reserve(tmp_path: Path) -> None:
    journal = BatchJournal(tmp_path / "usage.json", ["only-case"])
    try:
        journal.reserve_before_dispatch(
            "only-case",
            fixture_sha256=FIXTURE_HASH,
            operation_id="00000000-0000-4000-8000-000000000009",
            binding=journal_binding("00000000-0000-4000-8000-000000000009"),
        )
        journal.settle(
            "only-case",
            state="complete",
            input_tokens=1200,
            output_tokens=450,
            response={"review_state": "unreviewed", "source_sha256": "synthetic-hash"},
        )
        record = journal.data["cases"]["only-case"]
        assert record["reserved_usd"] == pytest.approx(hold_usd())
        assert record["actual_usage_usd"] == pytest.approx(0.0069)
        assert journal.data["actual_usage"][0]["input_tokens"] == 1200
        assert record["response"]["review_state"] == "unreviewed"
    finally:
        journal.close()


def test_unknown_outcome_preserves_receipt_without_releasing_hold(tmp_path: Path) -> None:
    journal = BatchJournal(tmp_path / "unknown.json", ["case"])
    try:
        journal.reserve_before_dispatch(
            "case",
            fixture_sha256=FIXTURE_HASH,
            operation_id="00000000-0000-4000-8000-000000000010",
            binding=journal_binding("00000000-0000-4000-8000-000000000010"),
        )
        journal.settle(
            "case",
            state="unknown",
            input_tokens=None,
            output_tokens=None,
            response={"http_status": 502, "receipt": {"state": "unknown"}, "source_sha256": "synthetic-hash"},
        )
        assert journal.data["cases"]["case"]["response"]["receipt"]["state"] == "unknown"
        assert journal.data["reserved_usd"] == pytest.approx(hold_usd())
    finally:
        journal.close()


def test_actual_usage_above_hold_is_rejected(tmp_path: Path) -> None:
    journal = BatchJournal(tmp_path / "overage.json", ["case"])
    try:
        journal.reserve_before_dispatch(
            "case",
            fixture_sha256=FIXTURE_HASH,
            operation_id="00000000-0000-4000-8000-000000000011",
            binding=journal_binding("00000000-0000-4000-8000-000000000011"),
        )
        with pytest.raises(ValueError, match="missing or exceeds"):
            journal.settle("case", state="complete", input_tokens=24_785, output_tokens=1)
    finally:
        journal.close()


def test_live_journal_identity_is_fixed_per_user() -> None:
    assert default_journal_path().parent.name == "claude-selected-photo-eval"


def test_model_and_usage_mismatch_fails_closed() -> None:
    assert usage_within_hold("claude-sonnet-5-5", 0, 0)
    assert not usage_within_hold("openai-model", 100, 100)
    assert not usage_within_hold("claude-sonnet-5-5", 24_785, 1)
    assert not usage_within_hold("claude-sonnet-5-5", 1, 64_001)
    assert not usage_within_hold("claude-sonnet-5-5", -1, 1)


def test_adapter_uses_single_attempt_no_fallback_and_full_output_ceiling() -> None:
    import anthropic
    import httpx2

    from recall.ingestion.anthropic_provider import AnthropicProvider
    from recall.ingestion.provider import InterpretRequest

    captured = []

    def response(request):  # type: ignore[no-untyped-def]
        captured.append(json.loads(request.content))
        events = [
            (
                "message_start",
                {
                    "type": "message_start",
                    "message": {
                        "id": "msg_smoke",
                        "type": "message",
                        "role": "assistant",
                        "model": "claude-sonnet-5-5",
                        "content": [],
                        "stop_reason": None,
                        "stop_sequence": None,
                        "usage": {"input_tokens": 10, "output_tokens": 0},
                    },
                },
            ),
            (
                "message_delta",
                {
                    "type": "message_delta",
                    "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                    "usage": {"output_tokens": 2},
                },
            ),
            ("message_stop", {"type": "message_stop"}),
        ]
        payload = "".join(f"event: {name}\ndata: {json.dumps(body)}\n\n" for name, body in events)
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=payload)

    sdk_client = anthropic.Anthropic(
        api_key="synthetic-test-key", max_retries=0, http_client=httpx2.Client(transport=httpx2.MockTransport(response))
    )
    provider = AnthropicProvider(
        api_key="unused",
        model_id="claude-sonnet-5-5",
        effort="low",
        refusal_fallback=False,
        max_retries=0,
        client=sdk_client,
    )
    try:
        provider.interpret(InterpretRequest(envelope={"pages": []}, pages=[], schema={"type": "object"}))
        assert sdk_client.max_retries == 0
        assert captured[0]["max_tokens"] == 64_000
        assert "fallbacks" not in captured[0] and "betas" not in captured[0]
    finally:
        sdk_client.close()


def test_synthetic_case_runs_through_selected_reading_service(env) -> None:  # type: ignore[no-untyped-def]
    from conftest import sha
    from fake_provider import FakeProvider, faithful_extraction
    from recall.api.app import create_app
    from recall.errors import forbidden
    from recall.ingestion.local_reading import DeviceGrant
    from test_recall import AI

    user = env.user()
    user.register_device()
    with env.db.tx(user.id) as tx:
        workspace = tx.workspace_id
    settings = env.settings.model_copy(update=AI)
    with env.db.tx(user.id) as tx:
        tx.run(
            "insert into ai_consents(workspace_id,enabled,policy_version,decided_by,provider) "
            "values(%s,true,%s,%s,'anthropic')",
            (workspace, settings.ai_policy_version, user.id),
        )

    class SyntheticAuthorizer:
        vault = uuid.uuid4()

        def verify(self, authorization: str | None) -> DeviceGrant:
            if authorization != "Bearer synthetic-evaluation-only":
                raise forbidden("Synthetic evaluation credential rejected.")
            return DeviceGrant(user.id, workspace, user.device_id, self.vault)

    case = next(
        c for c in json.loads((EVAL_DIR / "manifest.json").read_text())["cases"] if c["id"] == "numbers_uncertainty"
    )
    image = (EVAL_DIR / case["path"]).read_bytes()
    fake = FakeProvider()
    fake.interpret_script = [lambda request: json.dumps(faithful_extraction(request, [case["ground_truth"][0]]))]
    authorizer = SyntheticAuthorizer()
    app = create_app(
        settings, database=env.db, store=env.store, local_reading_authorizer=authorizer, local_reading_provider=fake
    )
    binding = {
        "schema_version": "1.0",
        "operation_id": str(uuid.uuid4()),
        "vault_id": str(authorizer.vault),
        "memory_id": str(uuid.uuid4()),
        "source_id": str(uuid.uuid4()),
        "source_sha256": sha(image),
        "expected_revision": 1,
        "captured_at": "2026-10-08T12:00:00Z",
    }
    with TestClient(app) as client:
        response = client.post(
            "/v1/local-readings",
            content=image,
            headers={
                "Authorization": "Bearer synthetic-evaluation-only",
                "Content-Type": "image/jpeg",
                "X-Recall-Reading": json.dumps(binding),
            },
        )
    assert response.status_code == 200
    receipt = response.json()
    assert receipt["state"] == "complete" and receipt["result"]["review_state"] == "unreviewed"
    assert receipt["result"]["extraction"]["pages"][0]["transcription"] == case["ground_truth"][0]
    assert len(fake.interpret_calls) == 1
    assert "ground_truth" not in json.dumps(fake.interpret_calls[0].envelope)

    from recall.ingestion.provider import ProviderResult

    class MismatchedProvider:
        def interpret(self, request):  # type: ignore[no-untyped-def]
            return ProviderResult("{}", "openai-model", 10, 10)

        def answer(self, request):  # type: ignore[no-untyped-def]
            raise AssertionError("selected-photo harness must not answer questions")

    mismatch_app = create_app(
        settings,
        database=env.db,
        store=env.store,
        local_reading_authorizer=authorizer,
        local_reading_provider=MismatchedProvider(),
    )
    mismatch_binding = {
        **binding,
        "operation_id": str(uuid.uuid4()),
        "memory_id": str(uuid.uuid4()),
        "source_id": str(uuid.uuid4()),
    }
    with TestClient(mismatch_app) as client:
        mismatch = client.post(
            "/v1/local-readings",
            content=image,
            headers={
                "Authorization": "Bearer synthetic-evaluation-only",
                "Content-Type": "image/jpeg",
                "X-Recall-Reading": json.dumps(mismatch_binding),
            },
        )
    assert mismatch.status_code == 202 and mismatch.json()["state"] == "unknown"


def score_case(case: dict, receipt: dict) -> dict[str, object]:
    extraction = (receipt.get("result") or {}).get("extraction") or {}
    pages = extraction.get("pages") or []
    transcription = " ".join(page.get("transcription", "") for page in pages).casefold()
    truth = " ".join(case["ground_truth"]).casefold()
    tokens = re.findall(r"[\w$]+(?:[,.][\w]+)*", truth)
    numbers = re.findall(r"\$?\d[\d,]*(?:\.\d+)?", truth)
    observed_numbers = re.findall(r"\$?\d[\d,]*(?:\.\d+)?", transcription)
    return {
        "transcription_token_recall": sum(token in transcription for token in tokens) / len(tokens) if tokens else None,
        "critical_number_recall": sum(number in observed_numbers for number in numbers) / len(numbers)
        if numbers
        else None,
        "question_mark_preserved": "?" in transcription if "?" in truth else None,
        "blank_behavior": not transcription.strip() if case["id"] == "blank" else None,
        "unreadable_marked": bool(pages) and pages[0].get("legibility") == "unreadable"
        if case["id"] == "unreadable"
        else None,
    }


def test_metrics_cover_tokens_numbers_uncertainty_blank_and_unreadable() -> None:
    uncertain = {"id": "numbers_uncertainty", "ground_truth": ["Alex has 12? units"]}
    receipt = {"result": {"extraction": {"pages": [{"transcription": "Alex has 12? units", "legibility": "mixed"}]}}}
    scores = score_case(uncertain, receipt)
    assert scores["transcription_token_recall"] == 1.0
    assert scores["critical_number_recall"] == 1.0
    assert scores["question_mark_preserved"] is True
    blank = score_case(
        {"id": "blank", "ground_truth": []},
        {"result": {"extraction": {"pages": [{"transcription": "", "legibility": "unreadable"}]}}},
    )
    unreadable = score_case(
        {"id": "unreadable", "ground_truth": []},
        {"result": {"extraction": {"pages": [{"transcription": "", "legibility": "unreadable"}]}}},
    )
    assert blank["blank_behavior"] is True and unreadable["unreadable_marked"] is True


@pytest.mark.skipif(
    __import__("os").environ.get("RECALL_EVAL_LIVE") != "1",
    reason="controller must explicitly enable the one live synthetic batch",
)
def test_live_synthetic_selected_reading_batch(env, tmp_path):  # type: ignore[no-untyped-def]
    """Controller-only live entrypoint; use only with a compatible Anthropic key and throwaway env."""
    key = os.environ.get("AI_API_KEY", "")
    if not key.startswith("sk-ant-"):
        pytest.fail("live mode requires a compatible sk-ant- Anthropic API key in the process environment")
    manifest = json.loads((EVAL_DIR / "manifest.json").read_text(encoding="utf-8"))
    cases = manifest["cases"]
    expected_ids = ["numbers_uncertainty", "names_and_amount", "blank", "unreadable", "dense_full_page"]
    if [case["id"] for case in cases] != expected_ids:
        pytest.fail("fixed evaluation allowlist changed")
    fixture_bytes: dict[str, bytes] = {}
    for case in cases:
        image_path = (EVAL_DIR / case["path"]).resolve()
        if image_path.parent != EVAL_DIR.resolve():
            pytest.fail("fixture path escaped the fixed synthetic allowlist")
        image = image_path.read_bytes()
        if hashlib.sha256(image).hexdigest() != case["sha256"]:
            pytest.fail(f"fixture hash mismatch for {case['id']}")
        fixture_bytes[case["id"]] = image

    from batch import default_journal_path

    from recall.ingestion.anthropic_provider import AnthropicProvider

    probe = AnthropicProvider(
        api_key=key, model_id="claude-sonnet-5-5", effort="low", refusal_fallback=False, max_retries=0
    )
    try:
        probe._client.models.retrieve("claude-sonnet-5-5")
    finally:
        probe._client.close()
    journal = BatchJournal(default_journal_path(), expected_ids)
    try:
        from recall.api.app import create_app
        from recall.errors import forbidden
        from recall.ingestion.local_reading import DeviceGrant
        from test_recall import AI

        user = env.user()
        user.register_device()
        with env.db.tx(user.id) as tx:
            workspace = tx.workspace_id
        settings = env.settings.model_copy(
            update={
                **AI,
                "ai_model_id": "claude-sonnet-5-5",
                "ai_api_key": key,
                "ai_input_usd_per_mtok": 2.0,
                "ai_output_usd_per_mtok": 10.0,
                "ai_refusal_fallback": False,
            }
        )
        with env.db.tx(user.id) as tx:
            tx.run(
                "insert into ai_consents(workspace_id,enabled,policy_version,decided_by,provider) "
                "values(%s,true,%s,%s,'anthropic')",
                (workspace, settings.ai_policy_version, user.id),
            )

        class SyntheticAuthorizer:
            vault_id = uuid.uuid4()
            device_id = user.device_id

            def verify(self, authorization: str | None) -> DeviceGrant:
                if authorization != "Bearer synthetic-evaluation-only":
                    raise forbidden("Synthetic evaluation credential rejected.")
                return DeviceGrant(user.id, workspace, self.device_id, self.vault_id)

        authorizer = SyntheticAuthorizer()
        provider = AnthropicProvider(
            api_key=key, model_id="claude-sonnet-5-5", effort="low", refusal_fallback=False, max_retries=0
        )
        assert provider._client.max_retries == 0 and provider._fallback is False
        app = create_app(
            settings,
            database=env.db,
            store=env.store,
            local_reading_authorizer=authorizer,
            local_reading_provider=provider,
        )
        started = time.monotonic()
        try:
            with TestClient(app) as client:
                for case in cases:
                    image = fixture_bytes[case["id"]]
                    operation_id = str(uuid.uuid4())
                    source_hash = hashlib.sha256(image).hexdigest()
                    binding = {
                        "schema_version": "1.0",
                        "operation_id": operation_id,
                        "vault_id": str(authorizer.vault_id),
                        "memory_id": str(uuid.uuid4()),
                        "source_id": str(uuid.uuid4()),
                        "source_sha256": source_hash,
                        "expected_revision": 1,
                        "captured_at": "2026-10-08T12:00:00Z",
                    }
                    journal.reserve_before_dispatch(
                        case["id"], fixture_sha256=source_hash, operation_id=operation_id, binding=binding
                    )
                    with env.db.tx(user.id) as tx:
                        usage_before = {
                            row["id"] for row in tx.all("select id from ai_usage where workspace_id=%s", (workspace,))
                        }
                    before = time.monotonic()
                    response = client.post(
                        "/v1/local-readings",
                        content=image,
                        headers={
                            "Authorization": "Bearer synthetic-evaluation-only",
                            "Content-Type": "image/jpeg",
                            "X-Recall-Reading": json.dumps(binding),
                        },
                    )
                    latency = time.monotonic() - before
                    try:
                        data = response.json()
                    except ValueError:
                        data = {"http_status": response.status_code, "body": response.text[:1000]}
                    with env.db.tx(user.id) as tx:
                        usage_rows = tx.all(
                            "select id,model_id,input_tokens,output_tokens,estimated_cost_usd "
                            "from ai_usage where workspace_id=%s",
                            (workspace,),
                        )
                    usage_rows = [row for row in usage_rows if row["id"] not in usage_before]
                    state = data.get("state", "unknown") if isinstance(data, dict) else "unknown"
                    actual = usage_rows[0] if len(usage_rows) == 1 else None
                    usage_valid = bool(
                        actual
                        and usage_within_hold(actual["model_id"], actual["input_tokens"], actual["output_tokens"])
                    )
                    if state not in {"complete", "failed"} or not usage_valid:
                        journal.settle(
                            case["id"],
                            state="unknown",
                            input_tokens=None,
                            output_tokens=None,
                            response={
                                "http_status": response.status_code,
                                "receipt": data,
                                "source_sha256": source_hash,
                                "operation_id": operation_id,
                                "latency_seconds": latency,
                                "classification": case["classification"],
                                "ground_truth": case["ground_truth"],
                            },
                        )
                    else:
                        metrics = score_case(case, data)
                        journal.settle(
                            case["id"],
                            state=state,
                            input_tokens=actual["input_tokens"],
                            output_tokens=actual["output_tokens"],
                            response={
                                "http_status": response.status_code,
                                "receipt": data,
                                "source_sha256": source_hash,
                                "operation_id": operation_id,
                                "latency_seconds": latency,
                                "provider_estimated_cost_usd": float(actual["estimated_cost_usd"]),
                                "classification": case["classification"],
                                "ground_truth": case["ground_truth"],
                                "metrics": metrics,
                            },
                        )
                    assert response.status_code == 200, (
                        f"synthetic case {case['id']} returned HTTP {response.status_code}"
                    )
        finally:
            provider._client.close()
        journal.data["elapsed_seconds"] = round(time.monotonic() - started, 3)
        journal._write()
    finally:
        journal.close()
