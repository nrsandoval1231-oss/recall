"""SYNTHETIC test double for the AI provider. Used only to test Recall's own deterministic machinery
(gates, jobs, leases, validation, retrieval, citation checks). It proves nothing about real model
quality; live-provider acceptance is a separate OPEN gate (docs/ACCEPTANCE.md)."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

from recall.ingestion.provider import AnswerRequest, InterpretRequest, ProviderError, ProviderResult


def faithful_extraction(request: InterpretRequest, texts: list[str]) -> dict[str, Any]:
    """What a careful reader would return for pages whose true text is `texts` (by ordinal)."""
    env = request.envelope
    pages = sorted(env["pages"], key=lambda p: p["ordinal"])
    out_pages, statements, uncertainties = [], [], []
    for page, text in zip(pages, texts, strict=True):
        out_pages.append(
            {
                "page_id": page["page_id"],
                "ordinal": page["ordinal"],
                "transcription": text,
                "legibility": "clear" if text.strip() else "unreadable",
            }
        )
        for line in [ln.strip() for ln in text.splitlines() if ln.strip()]:
            n = len(statements) + 1
            uncertain = "?" in line
            statements.append(
                {
                    "local_id": f"s{n}",
                    "kind": "question" if line.endswith("?") and " " not in line else "observation",
                    "subject_mention_id": None,
                    "predicate": "notes",
                    "text": line,
                    "value_text": (re.findall(r"\d+(?:\.\d+)?\s*\w*", line) or [None])[0],
                    "epistemic_state": "uncertain" if uncertain else "reported",
                    "attribution_text": None,
                    "temporal_text": None,
                    "object_mention_id": None,
                    "evidence": [{"page_id": page["page_id"], "quote": line}],
                }
            )
            if uncertain:
                uncertainties.append(
                    {
                        "kind": "other",
                        "description": f"Marked uncertain on the page: {line}",
                        "evidence": [{"page_id": page["page_id"], "quote": line}],
                    }
                )
    first_line = next((ln.strip() for t in texts for ln in t.splitlines() if ln.strip()), None)
    first_page = pages[0]["page_id"]
    return {
        "schema_version": "1.1",
        "capture_id": env["capture_id"],
        "input_manifest_sha256": env["input_manifest_sha256"],
        "summary": f"Notes beginning: {first_line}" if first_line else None,
        "summary_evidence": [{"page_id": first_page, "quote": first_line}] if first_line else [],
        "pages": out_pages,
        "mentions": [],
        "statements": statements,
        "action_suggestions": [],
        "uncertainties": uncertainties,
    }


class FakeProvider:
    def __init__(self) -> None:
        self.truth: dict[str, list[str]] = {}  # context_hint -> page texts
        self.interpret_calls: list[InterpretRequest] = []
        self.answer_calls: list[AnswerRequest] = []
        # Optional per-call overrides, consumed in order: a raw string, an exception, or a callable.
        self.interpret_script: list[Any] = []
        self.answer_script: list[Any] = []
        self.mutate: Callable[[dict[str, Any]], None] | None = None

    def interpret(self, request: InterpretRequest) -> ProviderResult:
        self.interpret_calls.append(request)
        if self.interpret_script:
            step = self.interpret_script.pop(0)
            if isinstance(step, Exception):
                raise step
            if callable(step):
                return ProviderResult(text=step(request), model_id="fake-model", input_tokens=1000, output_tokens=500)
            return ProviderResult(text=step, model_id="fake-model", input_tokens=1000, output_tokens=500)
        texts = self.truth[request.envelope["context_hint"]]
        data = faithful_extraction(request, texts)
        if self.mutate:
            self.mutate(data)
        return ProviderResult(text=json.dumps(data), model_id="fake-model", input_tokens=1000, output_tokens=500)

    def answer(self, request: AnswerRequest) -> ProviderResult:
        self.answer_calls.append(request)
        if self.answer_script:
            step = self.answer_script.pop(0)
            if isinstance(step, Exception):
                raise step
            text = step(request) if callable(step) else step
            return ProviderResult(text=text, model_id="fake-model", input_tokens=200, output_tokens=50)
        first = request.packet[0]
        body = {
            "status": "answered",
            "sentences": [{"text": f"Your note says: {first['text'][:120]}", "citation_ids": [first["citation_id"]]}],
            "limitations": [],
        }
        return ProviderResult(text=json.dumps(body), model_id="fake-model", input_tokens=200, output_tokens=50)


def refusal() -> ProviderError:
    return ProviderError("PROVIDER_REFUSED", "declined", retryable=False, usage=(900, 3))


def outage() -> ProviderError:
    return ProviderError("PROVIDER_UNAVAILABLE", "503", retryable=True)
