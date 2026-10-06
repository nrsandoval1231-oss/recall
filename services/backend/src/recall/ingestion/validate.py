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
_WORD = re.compile(r"[\w'’-]+")
# Capitalised tokens are treated as names/identities; these are ordinary sentence starters.
_NAME = re.compile(r"\b[A-Z][\w'’-]+")
_NAME_STOPWORDS = {
    "the",
    "a",
    "an",
    "this",
    "that",
    "these",
    "those",
    "it",
    "he",
    "she",
    "they",
    "we",
    "i",
    "you",
    "there",
    "notes",
    "note",
    "page",
    "pages",
    "summary",
    "someone",
    "something",
    "and",
    "or",
    "but",
    "if",
    "when",
}
_TIME_WORDS = {
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "today",
    "tomorrow",
    "yesterday",
    "tonight",
    "morning",
    "afternoon",
    "evening",
    "noon",
    "midnight",
    "week",
    "weekend",
    "month",
    "year",
    "ago",
    "next",
    "last",
    "am",
    "pm",
}


class _PageText:
    """A transcription as normalized lines, to find the whole line(s) a verbatim quote comes from."""

    def __init__(self, transcription: str) -> None:
        self.lines = [ln for ln in (_norm(x) for x in transcription.splitlines()) if ln]
        self.joined = " ".join(self.lines)
        self.starts: list[int] = []
        pos = 0
        for ln in self.lines:
            self.starts.append(pos)
            pos += len(ln) + 1

    def context(self, quote: str) -> str | None:
        q = _norm(quote)
        idx = self.joined.find(q) if q else -1
        if idx < 0:
            return None
        end = idx + len(q)
        return " ".join(ln for ln, st in zip(self.lines, self.starts, strict=True) if st < end and st + len(ln) > idx)


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
    pages_text = {p["page_id"]: _PageText(p["transcription"]) for p in ex["pages"]}

    for page in ex["pages"]:
        if page["legibility"] == "unreadable":
            result.note("PAGE_UNREADABLE", f"page {page['ordinal']} could not be read")

    def quotes_ok(evidence: list[dict[str, str]]) -> bool:
        return all(pages_text[ev["page_id"]].context(ev["quote"]) is not None for ev in evidence)

    def context(evidence: list[dict[str, str]]) -> str:
        """The full source lines the quotes come from: the unit every claim is judged against."""
        return " ".join(pages_text[ev["page_id"]].context(ev["quote"]) or "" for ev in evidence)

    def in_one_quote(text: str, evidence: list[dict[str, str]]) -> bool:
        needle = _norm(text)
        return any(needle in _norm(ev["quote"]) for ev in evidence)

    def unsupported(claim: str, evidence: list[dict[str, str]], numbers_from: str | None = None) -> str | None:
        """Why `claim` says more than its cited source lines, or None if it does not."""
        ctx = context(evidence)
        quotes = " ".join(_norm(ev["quote"]) for ev in evidence)
        claimed = numbers_from if numbers_from is not None else claim
        if not set(_DIGITS.findall(claimed)) <= set(_DIGITS.findall(quotes)):
            return "NUMBER_NOT_IN_SOURCE"
        words = set(_WORD.findall(ctx))
        if any(n.casefold() not in words for n in _NAME.findall(claim) if n.casefold() not in _NAME_STOPWORDS):
            return "NAME_NOT_IN_SOURCE"
        if any(w not in words for w in _WORD.findall(_norm(claim)) if w in _TIME_WORDS):
            return "TIME_NOT_IN_SOURCE"
        return None

    uncertain_spans = [(u["evidence"], u) for u in ex["uncertainties"] if quotes_ok(u["evidence"])]

    def overlaps_uncertainty(evidence: list[dict[str, str]]) -> bool:
        for ev in evidence:
            q = _norm(ev["quote"])
            for u_evidence, _u in uncertain_spans:
                for uev in u_evidence:
                    uq = _norm(uev["quote"])
                    if uev["page_id"] == ev["page_id"] and (uq in q or q in uq):
                        return True
        return False

    # Summary: verbatim evidence AND no name/number/time beyond its cited lines.
    if ex["summary"] is not None:
        reason = None if ex["summary_evidence"] and quotes_ok(ex["summary_evidence"]) else "SUMMARY_UNSUPPORTED"
        reason = reason or unsupported(ex["summary"], ex["summary_evidence"])
        if reason:
            result.note(reason, "summary dropped: it says more than the cited page lines")
            ex["summary"], ex["summary_evidence"] = None, []

    kept_mentions = []
    for m in ex["mentions"]:
        if quotes_ok(m["evidence"]) and in_one_quote(m["raw_text"], m["evidence"]):
            kept_mentions.append(m)
        else:
            result.note("MENTION_UNSUPPORTED", f"mention {m['local_id']} dropped: not verbatim within one quote")
    ex["mentions"] = kept_mentions
    live_mentions = {m["local_id"] for m in kept_mentions}

    kept_statements = []
    for s in ex["statements"]:
        sid = s["local_id"]
        if not quotes_ok(s["evidence"]):
            result.note("STATEMENT_UNSUPPORTED", f"statement {sid} dropped: evidence is not verbatim on the page")
            continue
        reason = unsupported(s["text"], s["evidence"], numbers_from=f"{s['text']} {s['value_text'] or ''}")
        if reason:
            result.note(reason, f"statement {sid} dropped: it says more than its cited page lines")
            continue
        if s["epistemic_state"] in MODEL_FORBIDDEN_STATES:
            new = MODEL_FORBIDDEN_STATES[s["epistemic_state"]]
            result.note("AUTHORITY_DOWNGRADED", f"statement {sid}: model may not set {s['epistemic_state']}; set {new}")
            s["epistemic_state"] = new
        doubtful = "?" in context(s["evidence"]) or overlaps_uncertainty(s["evidence"])
        if s["epistemic_state"] == "reported" and doubtful:
            s["epistemic_state"] = "uncertain"  # a "?" anywhere on the cited line, or a recorded doubt, stays a doubt
            result.note(
                "QUESTION_MARK_KEPT", f"statement {sid}: source line is uncertain; kept uncertain", review=False
            )
        for key, code in (("temporal_text", "TIME_NOT_IN_SOURCE"), ("attribution_text", "ATTRIBUTION_NOT_IN_SOURCE")):
            if s[key] is not None and not in_one_quote(s[key], s["evidence"]):
                result.note(code, f"statement {sid}: {key.split('_')[0]} wording not within one quote; removed")
                s[key] = None
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
        reason = unsupported(a["text"], a["evidence"], numbers_from=f"{a['text']} {a['due_text'] or ''}")
        if reason:
            result.note(reason, f"action {a['local_id']} dropped: it says more than its cited page lines")
            continue
        if a["due_text"] is not None and not in_one_quote(a["due_text"], a["evidence"]):
            result.note("TIME_NOT_IN_SOURCE", f"action {a['local_id']}: due wording not within one quote; removed")
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
