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
from batch import (  # noqa: E402
    DIAG02_CASES,
    DIAG02_MAX_USD,
    BatchJournal,
    default_journal_path,
    diag02_journal_path,
    hold_usd,
    open_diag02_journal,
    usage_within_hold,
)

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
    assert diag02_journal_path() != default_journal_path()


def test_diag02_fixed_cases_path_and_budget_guard(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import batch

    monkeypatch.setattr(batch, "diag02_journal_path", lambda: tmp_path / "diag-02-batch.json")
    assert DIAG02_CASES == ("numbers_uncertainty", "dense_full_page")
    per_case = hold_usd(batch.DIAG02_INPUT_HOLD, batch.DIAG02_OUTPUT_HOLD)
    assert per_case == pytest.approx(0.689568)
    assert 2 * per_case < DIAG02_MAX_USD < 3 * per_case
    journal = open_diag02_journal()
    try:
        assert list(journal.data["cases"]) == list(DIAG02_CASES)
        assert journal.data["max_usd"] == DIAG02_MAX_USD
        assert journal.data["input_token_hold"] == 24_784
        assert journal.data["output_token_hold"] == 64_000
        assert journal.path == tmp_path / "diag-02-batch.json"
    finally:
        journal.close()
    with pytest.raises(RuntimeError, match="already been used"):
        open_diag02_journal()


def test_diag02_manifest_hash_allowlist_is_exact() -> None:
    manifest = json.loads((EVAL_DIR / "manifest.json").read_text(encoding="utf-8"))
    expected = {
        "numbers_uncertainty": "4d35d2ea2f0ee4ed08c8a94bc0b0dd34adb25471a75d26765ce7caa008ba3b59",
        "dense_full_page": "9673aad20e56745a408c65a355ad6fb000276da1d7f7f3e9fb9b4bd4b8d130a3",
    }
    assert manifest["synthetic_only"] is True
    cases = [case for case in manifest["cases"] if case["id"] in DIAG02_CASES]
    assert [case["id"] for case in cases] == list(DIAG02_CASES)
    assert {case["id"]: case["sha256"] for case in cases} == expected
    assert all(
        case["classification"] == "synthetic_font_rendered_pipeline_smoke"
        and hashlib.sha256((EVAL_DIR / case["path"]).read_bytes()).hexdigest() == expected[case["id"]]
        for case in cases
    )


def test_original_journal_hash_matches_pre_diag02_state() -> None:
    original = default_journal_path()
    if original.exists():
        assert hashlib.sha256(original.read_bytes()).hexdigest().upper() == (
            "A65447C3FE7CC5D1E7339E9DCBCFA93F0E1C3EF9D6C35D38CD51282EC8EB6DB1"
        )


def test_diag02_unknown_stops_available_dispatches(tmp_path: Path) -> None:
    journal = BatchJournal(
        tmp_path / "diag-02.json",
        list(DIAG02_CASES),
        max_usd=DIAG02_MAX_USD,
        stop_on_unknown=True,
    )
    try:
        case = DIAG02_CASES[0]
        op = "00000000-0000-4000-8000-000000000021"
        journal.reserve_before_dispatch(case, fixture_sha256=FIXTURE_HASH, operation_id=op, binding=journal_binding(op))
        journal.settle(case, state="unknown", input_tokens=None, output_tokens=None)
        assert journal.data["cases"][case]["state"] == "unknown"
        with pytest.raises(RuntimeError, match="known prior usage"):
            journal.reserve_before_dispatch(
                DIAG02_CASES[1],
                fixture_sha256=FIXTURE_HASH,
                operation_id="00000000-0000-4000-8000-000000000022",
                binding=journal_binding("00000000-0000-4000-8000-000000000022"),
            )
    finally:
        journal.close()


def test_diag02_guard_rejects_third_reservation_over_cap(tmp_path: Path) -> None:
    journal = BatchJournal(
        tmp_path / "cap.json",
        [*DIAG02_CASES, "third-synthetic-case"],
        max_usd=DIAG02_MAX_USD,
        stop_on_unknown=True,
    )
    try:
        for index, case in enumerate([*DIAG02_CASES, "third-synthetic-case"], start=31):
            operation_id = f"00000000-0000-4000-8000-{index:012d}"
            if index == 33:
                with pytest.raises(RuntimeError, match="cap"):
                    journal.reserve_before_dispatch(
                        case,
                        fixture_sha256=FIXTURE_HASH,
                        operation_id=operation_id,
                        binding=journal_binding(operation_id),
                    )
                break
            journal.reserve_before_dispatch(
                case,
                fixture_sha256=FIXTURE_HASH,
                operation_id=operation_id,
                binding=journal_binding(operation_id),
            )
            journal.settle(case, state="complete", input_tokens=1, output_tokens=1)
        assert journal.data["reserved_usd"] == pytest.approx(2 * 0.689568)
    finally:
        journal.close()


def test_model_and_usage_mismatch_fails_closed() -> None:
    assert usage_within_hold("claude-sonnet-5-5", 0, 0)
    assert not usage_within_hold("openai-model", 100, 100)
    assert not usage_within_hold("claude-sonnet-5-5", 24_785, 1)
    assert not usage_within_hold("claude-sonnet-5-5", 1, 64_001)
    assert not usage_within_hold("claude-sonnet-5-5", -1, 1)


def test_synthetic_diagnostic_capture_hash_tamper_and_size_bound(tmp_path: Path) -> None:
    from diagnostics import MAX_RAW_BYTES, capture_raw, replay

    from conftest import REPO_ROOT

    case = json.loads((EVAL_DIR / "manifest.json").read_text(encoding="utf-8"))["cases"][0]
    contract = json.loads(
        (REPO_ROOT / "packages/contracts/fixtures/local-reading-selected-contract.json").read_text(encoding="utf-8")
    )
    provider_output = contract["cases"][0]["provider_output"]
    secret_text = "SYNTHETIC_PRIVATE_SCHEMA_VALUE"
    provider_output[secret_text] = "synthetic"
    raw = json.dumps(provider_output)
    record = capture_raw(
        case_id=case["id"],
        fixture_sha256=case["sha256"],
        raw_output=raw,
        capture_id="synthetic-capture",
        fingerprint="f" * 64,
        pages={},
        root=tmp_path,
    )
    schema = json.loads((REPO_ROOT / "packages/contracts/extraction.schema.json").read_text(encoding="utf-8"))

    result = replay(record, schema)

    assert result["code"] == "SCHEMA_INVALID"
    assert secret_text in json.dumps(result["issues"])
    with pytest.raises(ValueError, match="already exists"):
        capture_raw(
            case_id=case["id"],
            fixture_sha256=case["sha256"],
            raw_output=raw,
            capture_id="synthetic-capture",
            fingerprint="f" * 64,
            pages={},
            root=tmp_path,
        )
    with pytest.raises(ValueError, match="not allowlisted"):
        capture_raw(
            case_id="unlisted-case",
            fixture_sha256=case["sha256"],
            raw_output=raw,
            capture_id="synthetic-capture",
            fingerprint="f" * 64,
            pages={},
            root=tmp_path,
        )
    with pytest.raises(ValueError, match="not allowlisted"):
        capture_raw(
            case_id=case["id"],
            fixture_sha256="0" * 64,
            raw_output=raw,
            capture_id="synthetic-capture",
            fingerprint="f" * 64,
            pages={},
            root=tmp_path,
        )
    with pytest.raises(ValueError, match="exceeds bound"):
        capture_raw(
            case_id=case["id"],
            fixture_sha256=case["sha256"],
            raw_output="x" * (MAX_RAW_BYTES + 1),
            capture_id="synthetic-capture",
            fingerprint="f" * 64,
            pages={},
            root=tmp_path,
        )
    tampered = tmp_path / "tampered.json"
    saved = json.loads(record.read_text(encoding="utf-8"))
    saved["raw_output"] += " "
    tampered.write_text(json.dumps(saved), encoding="utf-8")
    with pytest.raises(ValueError, match="output hash mismatch"):
        replay(tampered, schema)


def test_opt_in_capture_on_fake_provider_route_preserves_rejection_and_accounting(
    env, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:  # type: ignore[no-untyped-def]
    from diagnostics import capture_validator, replay_to_file

    from conftest import REPO_ROOT, sha
    from fake_provider import FakeProvider
    from recall.api.app import create_app
    from recall.errors import forbidden
    from recall.ingestion import local_reading
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

    case = json.loads((EVAL_DIR / "manifest.json").read_text(encoding="utf-8"))["cases"][0]
    image = (EVAL_DIR / case["path"]).read_bytes()
    source_hash = sha(image)
    raw = json.dumps({"schema_version": "SYNTHETIC_PRIVATE_SCHEMA_VALUE"})
    fake = FakeProvider()
    fake.interpret_script = [raw, raw]
    authorizer = SyntheticAuthorizer()
    app = create_app(
        settings, database=env.db, store=env.store, local_reading_authorizer=authorizer, local_reading_provider=fake
    )
    original = local_reading.validate_selected_extraction
    wrapper, paths, failures = capture_validator(
        original, case_id=case["id"], fixture_sha256=case["sha256"], root=tmp_path
    )
    monkeypatch.setattr(local_reading, "validate_selected_extraction", wrapper)
    schema = json.loads((REPO_ROOT / "packages/contracts/extraction.schema.json").read_text(encoding="utf-8"))

    def send() -> dict[str, object]:
        binding = {
            "schema_version": "1.0",
            "operation_id": str(uuid.uuid4()),
            "vault_id": str(authorizer.vault),
            "memory_id": str(uuid.uuid4()),
            "source_id": str(uuid.uuid4()),
            "source_sha256": source_hash,
            "expected_revision": 1,
            "captured_at": "2026-10-08T12:00:00Z",
        }
        with TestClient(app) as client:
            return client.post(
                "/v1/local-readings",
                content=image,
                headers={
                    "Authorization": "Bearer synthetic-evaluation-only",
                    "Content-Type": "image/jpeg",
                    "X-Recall-Reading": json.dumps(binding),
                },
            ).json()

    first = send()
    assert first["state"] == "failed" and first["error_code"] == "INVALID_EXTRACTION"
    assert len(paths) == 1 and failures == []
    wrapper2, paths2, failures2 = capture_validator(
        original, case_id=case["id"], fixture_sha256=case["sha256"], root=tmp_path
    )
    monkeypatch.setattr(local_reading, "validate_selected_extraction", wrapper2)
    finding_path = replay_to_file(paths[0], schema)
    assert json.loads(finding_path.read_text(encoding="utf-8"))["code"] == "SCHEMA_INVALID"
    assert paths2 == [] and failures2 == []
    second = send()
    assert second["state"] == "failed" and second["error_code"] == "INVALID_EXTRACTION"
    assert paths2 == [] and failures2 == ["ValueError"]
    with env.db.tx(user.id) as tx:
        assert tx.one("select count(*) as n from ai_usage")["n"] == 2
        assert tx.one("select count(*) as n from embedding_reservations where status='completed'")["n"] == 2


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


def _run_live_synthetic_selected_reading_batch(env, tmp_path, monkeypatch, *, diag02: bool = False):  # type: ignore[no-untyped-def]
    """Shared live path behind the original and DIAG-02 fixed entrypoints."""
    key = os.environ.get("AI_API_KEY", "")
    if not key.startswith("sk-ant-"):
        pytest.fail("live mode requires a compatible sk-ant- Anthropic API key in the process environment")
    manifest = json.loads((EVAL_DIR / "manifest.json").read_text(encoding="utf-8"))
    cases = manifest["cases"]
    expected_ids = (
        list(DIAG02_CASES)
        if diag02
        else ["numbers_uncertainty", "names_and_amount", "blank", "unreadable", "dense_full_page"]
    )
    if diag02:
        from batch import default_journal_path

        original_journal = default_journal_path()
        original_hash = hashlib.sha256(original_journal.read_bytes()).hexdigest().upper()
        if original_hash != "A65447C3FE7CC5D1E7339E9DCBCFA93F0E1C3EF9D6C35D38CD51282EC8EB6DB1":
            pytest.fail("original five-case journal identity changed")
        if manifest.get("synthetic_only") is not True:
            pytest.fail("DIAG-02 manifest is not marked synthetic-only")
        expected_hashes = {
            "numbers_uncertainty": "4d35d2ea2f0ee4ed08c8a94bc0b0dd34adb25471a75d26765ce7caa008ba3b59",
            "dense_full_page": "9673aad20e56745a408c65a355ad6fb000276da1d7f7f3e9fb9b4bd4b8d130a3",
        }
        cases = [case for case in cases if case["id"] in expected_ids]
        if len(cases) != 2 or any(
            case["sha256"] != expected_hashes[case["id"]]
            or case.get("classification") != "synthetic_font_rendered_pipeline_smoke"
            for case in cases
        ):
            pytest.fail("DIAG-02 fixed case hashes changed")
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

    from batch import default_journal_path, open_diag02_journal

    diagnostics_enabled = diag02 or os.environ.get("RECALL_EVAL_DIAGNOSTICS") == "1"
    if diagnostics_enabled:
        from diagnostics import capture_validator, default_diagnostic_dir, diag02_diagnostic_dir, replay_to_file

        from conftest import REPO_ROOT

        diagnostic_failures: list[str] = []
        diagnostic_paths: list[Path] = []
        diagnostic_dir = diag02_diagnostic_dir() if diag02 else default_diagnostic_dir()
        diagnostic_schema = json.loads(
            (REPO_ROOT / "packages/contracts/extraction.schema.json").read_text(encoding="utf-8")
        )
        from recall.ingestion import local_reading as local_reading_module

        original_validator = local_reading_module.validate_selected_extraction

    from recall.ingestion.anthropic_provider import AnthropicProvider

    probe = AnthropicProvider(
        api_key=key, model_id="claude-sonnet-5-5", effort="low", refusal_fallback=False, max_retries=0
    )
    try:
        probe._client.models.retrieve("claude-sonnet-5-5")
    finally:
        probe._client.close()
    journal = open_diag02_journal() if diag02 else BatchJournal(default_journal_path(), expected_ids)
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
                    if diagnostics_enabled:
                        capture_then_validate, paths, failures = capture_validator(
                            original_validator,
                            case_id=case["id"],
                            fixture_sha256=source_hash,
                            root=diagnostic_dir,
                        )
                        monkeypatch.setattr(local_reading_module, "validate_selected_extraction", capture_then_validate)
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
                    if diagnostics_enabled:
                        diagnostic_paths.extend(paths)
                        diagnostic_failures.extend(failures)
                    if diagnostics_enabled and diagnostic_paths and diagnostic_paths[-1].stem == case["id"]:
                        try:
                            replay_to_file(diagnostic_paths[-1], diagnostic_schema)
                        except (OSError, ValueError, UnicodeError, KeyError, TypeError) as exc:
                            diagnostic_failures.append(type(exc).__name__)
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
                        if diag02:
                            break
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
                    if diag02 and diagnostic_failures:
                        break
        finally:
            provider._client.close()
        journal.data["elapsed_seconds"] = round(time.monotonic() - started, 3)
        journal._write()
        if diagnostics_enabled and diagnostic_failures:
            pytest.fail(f"synthetic diagnostics failed: {diagnostic_failures}")
    finally:
        journal.close()


@pytest.mark.skipif(
    os.environ.get("RECALL_EVAL_LIVE") != "1",
    reason="controller must explicitly enable the original live synthetic batch",
)
def test_live_synthetic_selected_reading_batch(env, tmp_path, monkeypatch):  # type: ignore[no-untyped-def]
    _run_live_synthetic_selected_reading_batch(env, tmp_path, monkeypatch)


@pytest.mark.skipif(
    os.environ.get("RECALL_DIAG02_LIVE") != "1",
    reason="controller must explicitly enable the separately approved DIAG-02 batch",
)
def test_live_diag02_synthetic_reading_batch(env, tmp_path, monkeypatch):  # type: ignore[no-untyped-def]
    _run_live_synthetic_selected_reading_batch(env, tmp_path, monkeypatch, diag02=True)
