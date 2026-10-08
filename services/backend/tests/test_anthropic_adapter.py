"""Contract test of the Claude adapter's request/response handling against a stub HTTP transport.
This verifies what WE send and how we map responses; it is NOT live-API acceptance."""

from __future__ import annotations

import json

import anthropic
import httpx2
import pytest

from conftest import REPO_ROOT
from recall.ingestion.anthropic_provider import FALLBACK_BETA, AnthropicProvider, provider_schema
from recall.ingestion.provider import AnswerRequest, InterpretRequest, PageImage, ProviderError
from recall.retrieval.ask import ANSWER_SCHEMA


def sse(text: str, stop_reason: str = "end_turn", model_id: str | None = "claude-opus-5-5") -> bytes:
    events = [
        (
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": "msg_test",
                    "type": "message",
                    "role": "assistant",
                    **({"model": model_id} if model_id is not None else {}),
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 1234, "output_tokens": 1},
                },
            },
        ),
        (
            "content_block_start",
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        ),
        (
            "content_block_delta",
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}},
        ),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        (
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": stop_reason, "stop_sequence": None},
                "usage": {"output_tokens": 77},
            },
        ),
        ("message_stop", {"type": "message_stop"}),
    ]
    return "".join(f"event: {name}\ndata: {json.dumps(body)}\n\n" for name, body in events).encode()


def make(handler) -> AnthropicProvider:  # type: ignore[no-untyped-def]
    client = anthropic.Anthropic(
        api_key="test-key-not-real", max_retries=0, http_client=httpx2.Client(transport=httpx2.MockTransport(handler))
    )
    return AnthropicProvider(
        api_key="unused", model_id="claude-opus-5-5", effort="high", refusal_fallback=True, client=client
    )


SCHEMA = json.loads((REPO_ROOT / "packages/contracts/extraction.schema.json").read_text())
REQUEST = InterpretRequest(
    envelope={
        "capture_id": "c",
        "input_manifest_sha256": "f",
        "context_hint": None,
        "pages": [{"page_id": "p1", "ordinal": 1}],
    },
    pages=[PageImage(source_id="p1", ordinal=1, jpeg=b"\xff\xd8\xffsynthetic")],
    schema=SCHEMA,
)


def test_interpret_request_shape_and_success() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=sse('{"ok": true}'))

    result = make(handler).interpret(REQUEST)
    assert result.text == '{"ok": true}' and result.input_tokens == 1234 and result.output_tokens == 77
    req = seen[0]
    body = json.loads(req.content)
    assert req.url.path.endswith("/v1/messages") and body["stream"] is True
    assert body["model"] == "claude-opus-5-5" and body["max_tokens"] == 64000
    assert FALLBACK_BETA in req.headers["anthropic-beta"] and body["fallbacks"] == "default"
    assert body["output_config"]["effort"] == "high" and body["output_config"]["format"]["type"] == "json_schema"
    assert "thinking" not in body  # adaptive by default on this model; never disabled
    sent_schema = json.dumps(body["output_config"]["format"]["schema"])
    assert '"pattern"' not in sent_schema and "$ref" not in sent_schema  # full schema is enforced locally
    content = body["messages"][0]["content"]
    image = next(c for c in content if c["type"] == "image")
    assert image["source"]["media_type"] == "image/jpeg" and image["source"]["type"] == "base64"
    assert "DATA" in body["system"][0]["text"] and "cache_control" not in body["system"][0]
    assert req.headers["x-api-key"] == "test-key-not-real"


def test_answer_uses_the_answer_schema() -> None:
    seen: list[dict] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(json.loads(request.content))
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=sse("{}"))

    make(handler).answer(AnswerRequest(question="q", packet=[{"citation_id": "c1", "text": "t"}], schema=ANSWER_SCHEMA))
    assert seen[0]["output_config"]["format"]["schema"]["required"] == ["status", "sentences", "limitations"]
    assert seen[0]["max_tokens"] == 16000


@pytest.mark.parametrize(
    ("status", "code", "retryable"),
    [
        (401, "PROVIDER_AUTH", False),
        (400, "PROVIDER_BAD_REQUEST", False),
        (429, "PROVIDER_RATE_LIMITED", True),
        (529, "PROVIDER_UNAVAILABLE", True),
        (500, "PROVIDER_UNAVAILABLE", True),
    ],
)
def test_http_errors_map_to_stable_codes(status: int, code: str, retryable: bool) -> None:
    provider = make(lambda r: httpx2.Response(status, json={"type": "error", "error": {"type": "x", "message": "m"}}))
    with pytest.raises(ProviderError) as caught:
        provider.interpret(REQUEST)
    assert (caught.value.code, caught.value.retryable) == (code, retryable)


@pytest.mark.parametrize(("stop", "code"), [("refusal", "PROVIDER_REFUSED"), ("max_tokens", "OUTPUT_TRUNCATED")])
def test_refusal_and_truncation_are_failures_with_billed_usage(stop: str, code: str) -> None:
    provider = make(
        lambda r: httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=sse("{", stop))
    )
    with pytest.raises(ProviderError) as caught:
        provider.interpret(REQUEST)
    assert caught.value.code == code and not caught.value.retryable and caught.value.usage == (1234, 77)


def test_connection_failure_is_retryable() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("down")

    with pytest.raises(ProviderError) as caught:
        make(handler).interpret(REQUEST)
    assert caught.value.code == "PROVIDER_UNAVAILABLE" and caught.value.retryable


def test_provider_schema_inlines_refs_and_keeps_shape() -> None:
    out = provider_schema(SCHEMA)
    assert "$defs" not in out and out["properties"]["schema_version"] == {"enum": ["1.1"]}
    ev = out["properties"]["summary_evidence"]["items"]
    assert ev["required"] == ["page_id", "quote"] and ev["additionalProperties"] is False


@pytest.mark.parametrize("stop", ["refusal", "max_tokens"])
@pytest.mark.parametrize("model_id", ["claude-opus-5-5", "different-model", None])
def test_billed_errors_preserve_actual_model_metadata(stop: str, model_id: str | None) -> None:
    provider = make(
        lambda r: httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=sse("{}", stop, model_id))
    )
    with pytest.raises(ProviderError) as caught:
        provider.interpret(REQUEST)
    assert caught.value.usage == (1234, 77)
    assert caught.value.model_id == model_id
