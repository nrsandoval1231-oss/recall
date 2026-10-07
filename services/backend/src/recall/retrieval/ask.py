"""Grounded Ask: retrieve → bounded evidence packet with server citation ids → model answer → server
verification. The model never sees anything outside the packet and cannot invent a citation: every
sentence must cite packet ids, or the response degrades to an honest non-answer plus the sources."""

from __future__ import annotations

import json
from typing import Any

from jsonschema import Draft202012Validator

from ..ingestion.provider import AnswerRequest, Provider, ProviderError, ProviderResult

PACKET_SIZE = 8
EXCERPT_CHARS = 1500
QUOTE_CHARS = 300

ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["status", "sentences", "limitations"],
    "properties": {
        "status": {"enum": ["answered", "insufficient_evidence", "ambiguous"]},
        "sentences": {
            "type": "array",
            "maxItems": 12,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["text", "citation_ids"],
                "properties": {
                    "text": {"type": "string", "minLength": 1, "maxLength": 1000},
                    "citation_ids": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 8,
                        "items": {"type": "string", "pattern": "^c[1-9][0-9]*$"},
                    },
                },
            },
        },
        "limitations": {"type": "array", "maxItems": 6, "items": {"type": "string", "maxLength": 500}},
    },
}

UNVERIFIED = "The answer could not be verified against your sources, so here are the closest matching sources."


def build_packet(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    packet = []
    for i, hit in enumerate(hits[:PACKET_SIZE], start=1):
        history_fields: dict[str, Any] = {
            key: hit[key]
            for key in ("recorded_at", "valid_from", "valid_to", "supersedes_claim_id", "history_status")
            if key in hit
        }
        packet.append(
            {
                "citation_id": f"c{i}",
                "kind": hit["kind"],
                "page": hit["page"],
                "captured_at": hit["captured_at"][:10],
                "epistemic_state": hit["epistemic_state"],
                "text": hit["text"][:EXCERPT_CHARS],
                **history_fields,
            }
        )
    return packet


def _citation(hit: dict[str, Any], citation_id: str) -> dict[str, Any]:
    citation = {
        "citation_id": citation_id,
        "memory_id": hit["memory_id"],
        "memory_revision": hit["memory_revision"],
        "capture_id": hit["capture_id"],
        "source_id": hit["source_id"],
        "page": hit["page"],
        "quote": (hit["excerpt"] or hit["text"])[:QUOTE_CHARS],
        "captured_at": hit["captured_at"],
        "epistemic_state": hit["epistemic_state"],
        "kind": hit["kind"],
    }
    for key in ("recorded_at", "valid_from", "valid_to", "supersedes_claim_id", "history_status"):
        if key in hit:
            citation[key] = hit[key]
    return citation


def sources_of(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_citation(h, f"s{i}") for i, h in enumerate(hits, start=1)]


def verify_answer(raw: str, packet_hits: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the verified answer body, or None if anything about it cannot be trusted."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if list(Draft202012Validator(ANSWER_SCHEMA).iter_errors(data)):
        return None
    by_id = {f"c{i}": h for i, h in enumerate(packet_hits, start=1)}
    sentences = data["sentences"]
    if data["status"] in ("answered", "ambiguous") and not sentences:
        return None
    if data["status"] == "insufficient_evidence":
        sentences = []
    used: dict[str, dict[str, Any]] = {}
    for sentence in sentences:
        for cid in sentence["citation_ids"]:
            if cid not in by_id:
                return None  # invented or out-of-packet citation: reject the whole answer
            used.setdefault(cid, _citation(by_id[cid], cid))
    return {
        "status": data["status"],
        "answer": " ".join(s["text"] for s in sentences) or None,
        "sentences": [{"text": s["text"], "citation_ids": s["citation_ids"]} for s in sentences],
        "citations": list(used.values()),
        "limitations": data["limitations"],
    }


def answer(
    provider: Provider, question: str, hits: list[dict[str, Any]]
) -> tuple[dict[str, Any], ProviderResult | None]:
    """Returns (response body without sources/index fields, provider result for usage accounting)."""
    packet_hits = hits[:PACKET_SIZE]
    try:
        result = provider.answer(
            AnswerRequest(question=question, packet=build_packet(packet_hits), schema=ANSWER_SCHEMA)
        )
    except ProviderError as err:
        billed = None
        if any(err.usage):  # a refusal or truncation is still billed: it must count against the budget
            billed = ProviderResult(text="", model_id="unknown", input_tokens=err.usage[0], output_tokens=err.usage[1])
        return {
            "status": "unavailable",
            "answer": None,
            "sentences": [],
            "citations": [],
            "limitations": ["Answers are unavailable right now; showing matching sources instead."],
            "reason": err.code,
        }, billed
    verified = verify_answer(result.text, packet_hits)
    if verified is None:
        return {
            "status": "insufficient_evidence",
            "answer": None,
            "sentences": [],
            "citations": [],
            "limitations": [UNVERIFIED],
            "reason": "ANSWER_UNVERIFIED",
        }, result
    return {**verified, "reason": None}, result
