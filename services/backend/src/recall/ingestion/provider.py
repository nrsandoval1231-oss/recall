"""Provider boundary. Adapters only turn bounded inputs into text; they have no tools, no network
access beyond the provider API, and no authority over state."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class PageImage:
    source_id: str
    ordinal: int
    jpeg: bytes  # server-made derivative, never the original bytes


@dataclass(frozen=True)
class InterpretRequest:
    envelope: dict[str, Any]  # capture_id, input_manifest_sha256, timezone, captured_at, context_hint
    pages: list[PageImage]
    schema: dict[str, Any]
    repair_note: str | None = None  # validation errors from a previous attempt, for one repair call


@dataclass(frozen=True)
class AnswerRequest:
    question: str
    packet: list[dict[str, Any]]
    schema: dict[str, Any]


@dataclass
class ProviderResult:
    text: str
    model_id: str
    input_tokens: int
    output_tokens: int
    extra: dict[str, Any] = field(default_factory=dict)


class ProviderError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool, usage: tuple[int, int] = (0, 0)) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.usage = usage  # tokens billed even though the call failed (e.g. refusal, truncation)


class Provider(Protocol):
    def interpret(self, request: InterpretRequest) -> ProviderResult: ...

    def answer(self, request: AnswerRequest) -> ProviderResult: ...
