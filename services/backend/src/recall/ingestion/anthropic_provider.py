"""Claude adapter (official SDK). NOT verified against the live API in this repository: the request
shape is contract-tested with a stub transport; live quality/acceptance is an OPEN gate."""

from __future__ import annotations

import base64
import json
from typing import Any

import anthropic

from .prompts import ANSWER_SYSTEM, INTERPRET_SYSTEM
from .provider import AnswerRequest, InterpretRequest, ProviderError, ProviderResult

FALLBACK_BETA = "server-side-fallback-2026-07-01"
# JSON Schema keywords the structured-output endpoint may not accept. The FULL schema is always
# enforced locally by validate.py; the provider only needs the shape.
_UNSUPPORTED = {
    "pattern",
    "format",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minimum",
    "maximum",
    "$schema",
    "title",
    "const",
}


def provider_schema(schema: Any, defs: dict[str, Any] | None = None) -> Any:
    """Inline $refs and drop keywords outside the structured-output subset."""
    if defs is None and isinstance(schema, dict):
        defs = schema.get("$defs", {})
    if isinstance(schema, dict):
        if "$ref" in schema:
            name = schema["$ref"].rsplit("/", 1)[-1]
            return provider_schema((defs or {})[name], defs)
        out: dict[str, Any] = {}
        for key, value in schema.items():
            if key in _UNSUPPORTED or key == "$defs":
                if key == "const":
                    out["enum"] = [value]
                continue
            out[key] = provider_schema(value, defs)
        return out
    if isinstance(schema, list):
        return [provider_schema(v, defs) for v in schema]
    return schema


class AnthropicProvider:
    def __init__(
        self,
        *,
        api_key: str,
        model_id: str,
        effort: str,
        refusal_fallback: bool,
        client: anthropic.Anthropic | None = None,
    ) -> None:
        self._client = client or anthropic.Anthropic(api_key=api_key, max_retries=2, timeout=600.0)
        self._model = model_id
        self._effort = effort
        self._fallback = refusal_fallback

    def _call(
        self, *, system: str, content: list[dict[str, Any]], schema: dict[str, Any], max_tokens: int
    ) -> ProviderResult:
        kwargs: dict[str, Any] = {
            "model": self._model,
            "max_tokens": max_tokens,
            "system": [{"type": "text", "text": system}],
            "messages": [{"role": "user", "content": content}],
            "output_config": {
                "effort": self._effort,
                "format": {"type": "json_schema", "schema": provider_schema(schema)},
            },
        }
        if self._fallback:
            kwargs["betas"] = [FALLBACK_BETA]
            kwargs["fallbacks"] = "default"
        try:
            with self._client.beta.messages.stream(**kwargs) as stream:
                message = stream.get_final_message()
        except anthropic.AuthenticationError:
            raise ProviderError("PROVIDER_AUTH", "provider rejected credentials", retryable=False) from None
        except anthropic.PermissionDeniedError:
            raise ProviderError("PROVIDER_FORBIDDEN", "provider denied the request", retryable=False) from None
        except anthropic.BadRequestError:
            raise ProviderError("PROVIDER_BAD_REQUEST", "provider rejected the request", retryable=False) from None
        except anthropic.RateLimitError:
            raise ProviderError("PROVIDER_RATE_LIMITED", "provider rate limit", retryable=True) from None
        except anthropic.APIStatusError as exc:
            raise ProviderError(
                "PROVIDER_UNAVAILABLE", f"provider error {exc.status_code}", retryable=exc.status_code >= 500
            ) from None
        except anthropic.APIConnectionError:
            raise ProviderError("PROVIDER_UNAVAILABLE", "provider unreachable", retryable=True) from None
        usage = (message.usage.input_tokens or 0, message.usage.output_tokens or 0)
        if message.stop_reason == "refusal":
            raise ProviderError("PROVIDER_REFUSED", "the provider declined this content", retryable=False, usage=usage)
        if message.stop_reason == "max_tokens":
            raise ProviderError("OUTPUT_TRUNCATED", "provider output was truncated", retryable=False, usage=usage)
        text = "".join(str(getattr(block, "text", "")) for block in message.content if block.type == "text")
        return ProviderResult(
            text=text, model_id=getattr(message, "model", self._model), input_tokens=usage[0], output_tokens=usage[1]
        )

    def interpret(self, request: InterpretRequest) -> ProviderResult:
        content: list[dict[str, Any]] = []
        for page in sorted(request.pages, key=lambda p: p.ordinal):
            content.append({"type": "text", "text": f"Page {page.ordinal} (page_id {page.source_id}):"})
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": base64.standard_b64encode(page.jpeg).decode(),
                    },
                }
            )
        envelope = json.dumps(request.envelope, ensure_ascii=False, sort_keys=True)
        content.append({"type": "text", "text": f"Envelope (data):\n{envelope}"})
        if request.repair_note:
            content.append(
                {
                    "type": "text",
                    "text": "Your previous output failed validation. Fix exactly these problems "
                    f"and return the full corrected JSON:\n{request.repair_note}",
                }
            )
        return self._call(system=INTERPRET_SYSTEM, content=content, schema=request.schema, max_tokens=64000)

    def answer(self, request: AnswerRequest) -> ProviderResult:
        evidence = json.dumps(request.packet, ensure_ascii=False)
        content = [
            {
                "type": "text",
                "text": f"Evidence items (data):\n{evidence}\n\nQuestion (data):\n{json.dumps(request.question)}",
            }
        ]
        return self._call(system=ANSWER_SYSTEM, content=content, schema=request.schema, max_tokens=16000)
