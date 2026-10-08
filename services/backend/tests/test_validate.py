"""Unit tests of the deterministic validator against adversarial model proposals (no database)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest

from conftest import REPO_ROOT
from recall.ingestion.validate import InvalidExtraction, validate_extraction

SCHEMA = json.loads((REPO_ROOT / "packages/contracts/extraction.schema.json").read_text())
CAP, FP, P1 = str(uuid.uuid4()), "a" * 64, str(uuid.uuid4())


def proposal(transcription: str, **parts: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "schema_version": "1.1",
        "capture_id": CAP,
        "input_manifest_sha256": FP,
        "summary": None,
        "summary_evidence": [],
        "pages": [{"page_id": P1, "ordinal": 1, "transcription": transcription, "legibility": "clear"}],
        "mentions": [],
        "statements": [],
        "action_suggestions": [],
        "uncertainties": [],
    }
    base.update(parts)
    return base


def stmt(text: str, quote: str, state: str = "reported", **extra: Any) -> dict[str, Any]:
    return {
        "local_id": "s1",
        "kind": "observation",
        "subject_mention_id": None,
        "predicate": "notes",
        "text": text,
        "value_text": None,
        "epistemic_state": state,
        "attribution_text": None,
        "temporal_text": None,
        "object_mention_id": None,
        "evidence": [{"page_id": P1, "quote": quote}],
        **extra,
    }


def run(data: dict[str, Any]):  # type: ignore[no-untyped-def]
    return validate_extraction(json.dumps(data), schema=SCHEMA, capture_id=CAP, fingerprint=FP, pages={P1: 1})


def test_partial_quote_cannot_strip_a_question_mark() -> None:
    """Review finding: quoting '800 psi' out of 'pressure 800 psi?' must not make it a fact."""
    v = run(proposal("pressure 800 psi?", statements=[stmt("Pressure was 800 psi", "800 psi")]))
    assert v.extraction["statements"][0]["epistemic_state"] == "uncertain"


def test_recorded_doubt_downgrades_an_overlapping_statement() -> None:
    v = run(
        proposal(
            "gate code 4417",
            statements=[stmt("gate code 4417", "gate code 4417")],
            uncertainties=[
                {"kind": "number", "description": "4417 or 4411", "evidence": [{"page_id": P1, "quote": "4417"}]}
            ],
        )
    )
    assert v.extraction["statements"][0]["epistemic_state"] == "uncertain"


def test_summary_cannot_add_names_amounts_or_days() -> None:
    v = run(
        proposal(
            "call Sam re invoice?",
            summary="Sam Johnson confirmed the $5,000 invoice is due Friday.",
            summary_evidence=[{"page_id": P1, "quote": "Sam"}],
        )
    )
    assert v.extraction["summary"] is None and v.needs_review


def test_statement_cannot_add_identities_beyond_its_line() -> None:
    v = run(proposal("call Sam re invoice?", statements=[stmt("Sam Johnson of Acme Corp approved the invoice", "Sam")]))
    assert v.extraction["statements"] == [] and {n["code"] for n in v.notes} == {"NAME_NOT_IN_SOURCE"}


def test_statement_cannot_add_time_words() -> None:
    v = run(proposal("ship the tiles", statements=[stmt("Ship the tiles on Friday", "ship the tiles")]))
    assert v.extraction["statements"] == []


def test_mentions_and_dates_cannot_be_stitched_from_separate_quotes() -> None:
    text = "Sam called. Johnson & Co sent tiles. Meet Thursday"
    mention = {
        "local_id": "m1",
        "kind": "person",
        "raw_text": "Sam Johnson",
        "evidence": [{"page_id": P1, "quote": "Sam"}, {"page_id": P1, "quote": "Johnson"}],
    }
    s = stmt("Sam called", "Sam called", temporal_text="called Thursday")
    s["evidence"].append({"page_id": P1, "quote": "Thursday"})
    v = run(proposal(text, mentions=[mention], statements=[s]))
    assert v.extraction["mentions"] == []
    assert v.extraction["statements"][0]["temporal_text"] is None


def test_attribution_must_be_on_the_page() -> None:
    v = run(
        proposal(
            "try Luca in Florence",
            statements=[stmt("try Luca in Florence", "try Luca in Florence", attribution_text="Sarah")],
        )
    )
    assert v.extraction["statements"][0]["attribution_text"] is None


def test_faithful_statements_survive_unchanged() -> None:
    text = "Coffee with Sarah - she introduced me to Dev Okafor\nDev runs a small solar install company"
    v = run(
        proposal(
            text,
            summary="Coffee with Sarah - she introduced me to Dev Okafor",
            summary_evidence=[{"page_id": P1, "quote": "Coffee with Sarah - she introduced me to Dev Okafor"}],
            statements=[stmt("Dev runs a small solar install company", "Dev runs a small solar install company")],
        )
    )
    assert (
        v.extraction["summary"]
        and v.extraction["statements"][0]["epistemic_state"] == "reported"
        and not v.needs_review
    )


def test_unicode_and_case_tricks_do_not_create_verbatim_matches() -> None:
    v = run(proposal("pay 90 dollars", statements=[stmt("pay 9O dollars", "pay 9O dollars")]))  # letter O
    assert v.extraction["statements"] == []


def test_structural_problems_are_hard_failures() -> None:
    bad = proposal("x")
    bad["pages"][0]["page_id"] = str(uuid.uuid4())
    with pytest.raises(InvalidExtraction):
        run(bad)


@pytest.mark.parametrize("predicate", ["call timing", "budget limit", "call-timing"])
def test_space_or_punctuation_predicates_remain_hard_schema_rejections(predicate: str) -> None:
    bad = proposal(
        "Call timing and budget limit",
        statements=[stmt("Call timing is morning", "Call timing", predicate=predicate)],
    )

    with pytest.raises(InvalidExtraction) as caught:
        run(bad)

    assert caught.value.code == "SCHEMA_INVALID"
    assert len(caught.value.problems) == 1
    assert predicate in caught.value.problems[0]
    assert "does not match" in caught.value.problems[0]
    assert bad["statements"][0]["predicate"] == predicate


@pytest.mark.parametrize("predicate", ["call_timing", "budget_limit", "x1"])
def test_snake_case_predicate_control_passes_without_changing_source_values(predicate: str) -> None:
    text = "Call timing is morning?"
    statement = stmt(
        text,
        text,
        state="uncertain",
        predicate=predicate,
        value_text="morning?",
    )

    validated = run(proposal(text, statements=[statement]))

    assert validated.extraction["statements"][0]["predicate"] == predicate
    assert validated.extraction["statements"][0]["text"] == text
    assert validated.extraction["statements"][0]["value_text"] == "morning?"
    assert validated.extraction["statements"][0]["epistemic_state"] == "uncertain"


def test_invalid_extraction_diagnostic_code_is_allowlisted() -> None:
    error = InvalidExtraction(["SYNTHETIC_PRIVATE_DETAIL"], "SYNTHETIC_PRIVATE_CODE")

    assert error.code == "INVALID_CONTENT"
    assert "SYNTHETIC_PRIVATE_DETAIL" in str(error)


def test_structural_diagnostic_uses_fixed_priority_for_multiple_faults() -> None:
    bad = proposal("synthetic", statements=[stmt("synthetic", "synthetic")])
    bad["capture_id"] = str(uuid.uuid4())
    bad["pages"][0]["page_id"] = str(uuid.uuid4())
    bad["statements"].append(bad["statements"][0].copy())
    bad["statements"][0]["subject_mention_id"] = "m99"
    bad["statements"][0]["evidence"][0]["page_id"] = str(uuid.uuid4())

    with pytest.raises(InvalidExtraction) as exc_info:
        run(bad)

    assert exc_info.value.code == "ENVELOPE_MISMATCH"
