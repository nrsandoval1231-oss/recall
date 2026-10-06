"""Deterministic validation of a model's extraction proposal (docs/AI-INGESTION.md "Validation").

Hard failures (unparseable, schema-invalid, wrong capture/pages/ids) raise InvalidExtraction and the
attempt may be repaired or retried. Soft failures never raise: the offending item is dropped or made
*less* certain, the reason is recorded, and the capture is marked needs_review. Nothing here can make
content more certain, more identified, or more authoritative than the model proposed.
"""

from __future__ import annotations

import copy
import json
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

MODEL_FORBIDDEN_STATES = {"confirmed_by_user": "reported", "superseded": "uncertain", "retracted": "uncertain"}
_DIGITS = re.compile(r"\d+(?:[.,]\d+)*")


class InvalidExtraction(Exception):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass
class Validated:
    extraction: dict[str, Any]
    notes: list[dict[str, str]] = field(default_factory=list)
    needs_review: bool = False

    def note(self, code: str, detail: str, *, review: bool = True) -> None:
        self.notes.append({"code": code, "detail": detail})
        self.needs_review = self.needs_review or review


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold()
    return re.sub(r"\s+", " ", text).strip()


def validate_extraction(
    raw: str, *, schema: dict[str, Any], capture_id: str, fingerprint: str, pages: dict[str, int]
) -> Validated:
    """`pages` maps source_id -> ordinal for exactly this capture."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise InvalidExtraction(["output is not valid JSON"]) from None
    errors = sorted(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(data), key=str)
    if errors:
        raise InvalidExtraction(
            [f"{'/'.join(map(str, e.absolute_path)) or 'root'}: {e.message[:160]}" for e in errors[:10]]
        )

    problems: list[str] = []
    if data["capture_id"] != capture_id:
        problems.append("capture_id does not match the envelope")
    if data["input_manifest_sha256"] != fingerprint:
        problems.append("input_manifest_sha256 does not match the envelope")
    got = {p["page_id"]: p["ordinal"] for p in data["pages"]}
    if got != pages or len(data["pages"]) != len(pages):
        problems.append("pages must list exactly the capture's page_ids with their ordinals, once each")
    for kind in ("mentions", "statements", "action_suggestions"):
        ids = [item["local_id"] for item in data[kind]]
        if len(ids) != len(set(ids)):
            problems.append(f"{kind} local_ids are not unique")
    mention_ids = {m["local_id"] for m in data["mentions"]}
    for s in data["statements"]:
        for ref in (s["subject_mention_id"], s["object_mention_id"]):
            if ref is not None and ref not in mention_ids:
                problems.append(f"statement {s['local_id']} references unknown mention {ref}")
    for a in data["action_suggestions"]:
        if a["assignee_mention_id"] is not None and a["assignee_mention_id"] not in mention_ids:
            problems.append(f"action {a['local_id']} references unknown mention")
    for ev in _all_evidence(data):
        if ev["page_id"] not in pages:
            problems.append("evidence references a page that is not in this capture")
            break
    if problems:
        raise InvalidExtraction(problems)

    result = Validated(extraction=copy.deepcopy(data))
    ex = result.extraction
    transcripts = {p["page_id"]: _norm(p["transcription"]) for p in ex["pages"]}

    for page in ex["pages"]:
        if page["legibility"] == "unreadable":
            result.note("PAGE_UNREADABLE", f"page {page['ordinal']} could not be read")

    def quotes_ok(evidence: list[dict[str, str]]) -> bool:
        return all(_norm(ev["quote"]) in transcripts[ev["page_id"]] for ev in evidence)

    def quote_text(evidence: list[dict[str, str]]) -> str:
        return " ".join(_norm(ev["quote"]) for ev in evidence)

    # Summary must rest on verbatim evidence.
    if ex["summary"] is not None and (not ex["summary_evidence"] or not quotes_ok(ex["summary_evidence"])):
        result.note("SUMMARY_UNSUPPORTED", "summary dropped: its evidence is not verbatim on the page")
        ex["summary"], ex["summary_evidence"] = None, []

    kept_mentions = []
    for m in ex["mentions"]:
        if quotes_ok(m["evidence"]) and _norm(m["raw_text"]) in quote_text(m["evidence"]):
            kept_mentions.append(m)
        else:
            result.note("MENTION_UNSUPPORTED", f"mention {m['local_id']} dropped: not found verbatim in its evidence")
    ex["mentions"] = kept_mentions
    live_mentions = {m["local_id"] for m in kept_mentions}

    kept_statements = []
    for s in ex["statements"]:
        sid = s["local_id"]
        if not quotes_ok(s["evidence"]):
            result.note("STATEMENT_UNSUPPORTED", f"statement {sid} dropped: evidence is not verbatim on the page")
            continue
        support = quote_text(s["evidence"])
        claimed_numbers = set(_DIGITS.findall(f"{s['text']} {s['value_text'] or ''}"))
        if not claimed_numbers <= set(_DIGITS.findall(support)):
            result.note("NUMBER_NOT_IN_SOURCE", f"statement {sid} dropped: it contains a number its evidence does not")
            continue
        if s["epistemic_state"] in MODEL_FORBIDDEN_STATES:
            new = MODEL_FORBIDDEN_STATES[s["epistemic_state"]]
            result.note("AUTHORITY_DOWNGRADED", f"statement {sid}: model may not set {s['epistemic_state']}; set {new}")
            s["epistemic_state"] = new
        if "?" in support and s["epistemic_state"] == "reported":
            s["epistemic_state"] = "uncertain"
            result.note("QUESTION_MARK_KEPT", f"statement {sid}: source has '?', kept uncertain", review=False)
        if s["temporal_text"] is not None and _norm(s["temporal_text"]) not in support:
            result.note("TIME_NOT_IN_SOURCE", f"statement {sid}: time wording not in evidence; removed")
            s["temporal_text"] = None
        for key in ("subject_mention_id", "object_mention_id"):
            if s[key] is not None and s[key] not in live_mentions:
                s[key] = None
        kept_statements.append(s)
    ex["statements"] = kept_statements

    kept_actions = []
    for a in ex["action_suggestions"]:
        if not quotes_ok(a["evidence"]):
            result.note("ACTION_UNSUPPORTED", f"action {a['local_id']} dropped: evidence is not verbatim")
            continue
        support = quote_text(a["evidence"])
        if not set(_DIGITS.findall(f"{a['text']} {a['due_text'] or ''}")) <= set(_DIGITS.findall(support)):
            result.note("NUMBER_NOT_IN_SOURCE", f"action {a['local_id']} dropped: number not in evidence")
            continue
        if a["due_text"] is not None and _norm(a["due_text"]) not in support:
            result.note("TIME_NOT_IN_SOURCE", f"action {a['local_id']}: due wording not in evidence; removed")
            a["due_text"] = None
        if a["assignee_mention_id"] is not None and a["assignee_mention_id"] not in live_mentions:
            a["assignee_mention_id"] = None
        kept_actions.append(a)
    ex["action_suggestions"] = kept_actions

    # Uncertainty records only ever reduce confidence; they are kept as proposed.
    return result


def _all_evidence(data: dict[str, Any]) -> list[dict[str, str]]:
    out = list(data["summary_evidence"])
    for key in ("mentions", "statements", "action_suggestions", "uncertainties"):
        for item in data[key]:
            out.extend(item["evidence"])
    return out
