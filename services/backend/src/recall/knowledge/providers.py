from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import re
import sqlite3
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

_budget_path: Path | None = None
_budget_lock = threading.Lock()
EMBED_REPO = "Qdrant/bge-small-en-v1.5-onnx-Q"
EMBED_REVISION = "aa8f8b060edb00e03bfdd08813a2949946c8ba55"
EMBED_ONNX_SHA256 = "51f1bd0addd6e859e42c2c8021a5e5461385bb676a649f4b269aa445449f2431"


def configure_budget_path(path: str | Path) -> None:
    global _budget_path
    _budget_path = Path(path)


def provider_disclosures() -> dict[str, str]:
    budget = _float_env("RECALL_GRAPH_BUDGET_USD")
    input_price = _float_env("RECALL_GRAPH_INPUT_USD_PER_MTOK")
    output_price = _float_env("RECALL_GRAPH_OUTPUT_USD_PER_MTOK")
    configured = (
        os.environ.get("RECALL_GRAPH_LLM_PROVIDER") == "anthropic"
        and bool(os.environ.get("RECALL_GRAPH_ANTHROPIC_API_KEY"))
        and bool(os.environ.get("RECALL_GRAPH_ANTHROPIC_MODEL"))
        and budget > 0
        and math.isfinite(budget)
        and input_price > 0
        and math.isfinite(input_price)
        and output_price > 0
        and math.isfinite(output_price)
    )
    model = os.environ.get("RECALL_GRAPH_ANTHROPIC_MODEL", "")
    if not re.fullmatch(r"claude-[A-Za-z0-9.-]{1,56}", model):
        model = "configured model"
    suffix = "(configured)" if configured else "(not configured)"
    return {
        "extraction": f"Anthropic Claude {model} {suffix}",
        "embedding": "Local FastEmbed BAAI/bge-small-en-v1.5 384d @ aa8f8b060edb",
        "reranking": "Local reciprocal-rank fusion (no external reranker)",
    }


def configured_clients() -> tuple[Any, Any]:
    """Construct explicit Anthropic and local embedding clients, with pre-call budget reservation."""
    os.environ["GRAPHITI_TELEMETRY_ENABLED"] = "false"
    provider = os.environ.get("RECALL_GRAPH_LLM_PROVIDER")
    api_key = os.environ.get("RECALL_GRAPH_ANTHROPIC_API_KEY")
    model = os.environ.get("RECALL_GRAPH_ANTHROPIC_MODEL")
    budget = _float_env("RECALL_GRAPH_BUDGET_USD")
    input_price = _float_env("RECALL_GRAPH_INPUT_USD_PER_MTOK")
    output_price = _float_env("RECALL_GRAPH_OUTPUT_USD_PER_MTOK")
    if provider != "anthropic" or not api_key or len(api_key) < 20 or not model:
        raise RuntimeError("Explicit Anthropic provider, model, and RECALL_GRAPH_ANTHROPIC_API_KEY are required.")
    if (
        budget <= 0
        or not math.isfinite(budget)
        or input_price <= 0
        or output_price <= 0
        or not math.isfinite(input_price)
        or not math.isfinite(output_price)
    ):
        raise RuntimeError("Explicit finite provider budget and model input/output prices are required.")
    if _budget_path is None:
        raise RuntimeError("Durable provider budget ledger is not configured.")
    budget_path = _budget_path

    import anthropic
    from graphiti_core.embedder.client import EmbedderClient
    from graphiti_core.llm_client.anthropic_client import AnthropicClient
    from graphiti_core.llm_client.config import LLMConfig, ModelSize

    class RecallAnthropicClient(AnthropicClient):  # type: ignore[misc]
        def _create_tool(self, response_model: Any = None) -> tuple[list[Any], Any]:
            tools, _ = super()._create_tool(response_model)
            # Sonnet 5.5 rejects forced tool selection; auto output is validated locally.
            return tools, {"type": "auto"}

        async def generate_response(
            self,
            messages: list[Any],
            response_model: type[Any] | None = None,
            max_tokens: int | None = None,
            model_size: ModelSize = ModelSize.medium,
            group_id: str | None = None,
            prompt_name: str | None = None,
            *,
            attribute_extraction: bool = False,
        ) -> dict[str, Any]:
            self._apply_attribute_extraction_preamble(messages, attribute_extraction)
            cap = min(max_tokens or 2048, 2048)
            input_bytes = sum(len(str(getattr(message, "content", "")).encode("utf-8")) for message in messages)
            schema_bytes = len(json.dumps(response_model.model_json_schema()).encode("utf-8")) if response_model else 0
            # Include tool schema and fixed protocol overhead; thinking/output is bounded by cap.
            estimated_input = max(1, (input_bytes + schema_bytes + 8_192) * 2)
            reserve = estimated_input * input_price / 1_000_000 + cap * output_price / 1_000_000
            call_id = _reserve_budget(budget_path, reserve, budget)
            if call_id is None:
                raise RuntimeError("Configured Graphiti provider budget is exhausted; no request was sent.")
            started = time.monotonic()
            settled = False
            try:
                response, input_tokens, output_tokens = await self._generate_response(
                    messages, response_model, cap, model_size
                )
                self.token_tracker.record(prompt_name, input_tokens, output_tokens)
                actual = input_tokens * input_price / 1_000_000 + output_tokens * output_price / 1_000_000
                _settle_budget(budget_path, call_id, actual, input_tokens, output_tokens, time.monotonic() - started)
                settled = True
                if response_model is not None:
                    return dict(response_model(**response).model_dump())
                return dict(response)
            except BaseException:
                # A timeout may have been delivered; keep its full reservation as UNKNOWN spend.
                if not settled:
                    _mark_budget_unknown(budget_path, call_id, time.monotonic() - started)
                raise

    config = LLMConfig(api_key=api_key, model=model, temperature=1, max_tokens=2048, small_model=model)
    logging.getLogger("graphiti_core").disabled = True
    logging.getLogger("graphiti_core.llm_client.anthropic_client").disabled = True
    official_client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=0, timeout=45)
    original_create = official_client.messages.create

    async def compatible_create(**kwargs: Any) -> Any:
        # Sonnet 5.5 accepts between-tools thinking, but rejects sampling parameters.
        kwargs["tool_choice"] = {"type": "auto"}
        if model == "claude-sonnet-5-5":
            kwargs.pop("temperature", None)
            kwargs.pop("top_p", None)
            kwargs.pop("top_k", None)
            kwargs["thinking"] = {"type": "between_tools"}
            kwargs["output_config"] = {"effort": "low"}
        return await original_create(**kwargs)

    client_proxy = SimpleNamespace(messages=SimpleNamespace(create=compatible_create))

    class RecallFastEmbedder(LocalFastEmbedder, EmbedderClient):  # type: ignore[misc]
        pass

    llm = RecallAnthropicClient(config=config, cache=False, client=cast(Any, client_proxy), max_tokens=2048)
    return llm, RecallFastEmbedder()


class LocalFastEmbedder:
    """Local BAAI/bge-small-en-v1.5 embeddings; source text never reaches an embedding API."""

    def __init__(self) -> None:
        self._model: Any = None
        self.embedding_dim = 384

    def _load(self) -> Any:
        if self._model is None:
            from fastembed import TextEmbedding
            from huggingface_hub import snapshot_download

            cache = os.environ.get("RECALL_GRAPH_EMBED_CACHE") or str(Path.home() / ".cache" / "recall-graphiti-models")
            snapshot = Path(snapshot_download(repo_id=EMBED_REPO, revision=EMBED_REVISION, cache_dir=cache))
            model_file = snapshot / "model_optimized.onnx"
            digest = hashlib.sha256(model_file.read_bytes()).hexdigest()
            if digest != EMBED_ONNX_SHA256:
                raise RuntimeError("Pinned local embedding model failed its SHA-256 integrity check.")
            self._model = TextEmbedding(
                model_name="BAAI/bge-small-en-v1.5",
                cache_dir=cache,
                specific_model_path=str(snapshot),
                local_files_only=True,
                threads=2,
            )
        return self._model

    async def create(self, input_data: str | list[str] | Any) -> list[float]:
        text = input_data if isinstance(input_data, str) else " ".join(str(value) for value in input_data)
        vectors = await asyncio.to_thread(lambda: list(self._load().embed([text])))
        return [float(value) for value in vectors[0].tolist()]

    async def create_batch(self, input_data_list: list[str]) -> list[list[float]]:
        vectors = await asyncio.to_thread(lambda: list(self._load().embed(input_data_list)))
        return [[float(value) for value in vector.tolist()] for vector in vectors]


def _reserve_budget(path: Path, amount: float, limit: float) -> int | None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _budget_lock, sqlite3.connect(path, timeout=15, isolation_level=None) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            "CREATE TABLE IF NOT EXISTS provider_budget ("
            "name TEXT PRIMARY KEY, reserved_usd REAL NOT NULL, spent_usd REAL NOT NULL)"
        )
        db.execute(
            "CREATE TABLE IF NOT EXISTS provider_calls ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL, reserved_usd REAL NOT NULL, "
            "actual_usd REAL, input_tokens INTEGER, output_tokens INTEGER, started_at TEXT NOT NULL, "
            "finished_at TEXT, latency_seconds REAL)"
        )
        row = db.execute("SELECT reserved_usd,spent_usd FROM provider_budget WHERE name='anthropic'").fetchone()
        reserved, spent = (float(row[0]), float(row[1])) if row else (0.0, 0.0)
        if not math.isfinite(amount) or amount <= 0 or reserved + spent + amount > limit:
            db.rollback()
            return None
        cur = db.execute(
            "INSERT INTO provider_calls(status,reserved_usd,started_at) VALUES('reserved',?,?)",
            (amount, datetime.now(UTC).isoformat()),
        )
        if cur.lastrowid is None:
            db.rollback()
            raise RuntimeError("Provider budget reservation could not be recorded.")
        call_id = cur.lastrowid
        db.execute(
            "INSERT INTO provider_budget(name,reserved_usd,spent_usd) VALUES('anthropic',?,?) "
            "ON CONFLICT(name) DO UPDATE SET reserved_usd=excluded.reserved_usd",
            (reserved + amount, spent),
        )
        db.commit()
        return call_id


def _settle_budget(
    path: Path, call_id: int, actual: float, input_tokens: int, output_tokens: int, latency: float
) -> None:
    with _budget_lock, sqlite3.connect(path, timeout=15, isolation_level=None) as db:
        db.execute("BEGIN IMMEDIATE")
        call = db.execute("SELECT reserved_usd FROM provider_calls WHERE id=?", (call_id,)).fetchone()
        if call is None:
            db.rollback()
            raise RuntimeError("Provider budget reservation disappeared.")
        db.execute(
            "UPDATE provider_budget SET reserved_usd=MAX(0,reserved_usd-?),spent_usd=spent_usd+? "
            "WHERE name='anthropic'",
            (call[0], actual),
        )
        db.execute(
            "UPDATE provider_calls SET status='settled',actual_usd=?,input_tokens=?,output_tokens=?, "
            "finished_at=?,latency_seconds=? WHERE id=?",
            (actual, input_tokens, output_tokens, datetime.now(UTC).isoformat(), latency, call_id),
        )
        db.commit()


def _mark_budget_unknown(path: Path, call_id: int, latency: float) -> None:
    with _budget_lock, sqlite3.connect(path, timeout=15, isolation_level=None) as db:
        db.execute(
            "UPDATE provider_calls SET status='unknown',finished_at=?,latency_seconds=? WHERE id=?",
            (datetime.now(UTC).isoformat(), latency, call_id),
        )


def _float_env(name: str) -> float:
    try:
        value = float(os.environ[name])
    except (KeyError, ValueError):
        return 0.0
    return value
