"""Versioned Voyage embedding adapter.

The adapter performs no database writes and makes no live call unless explicitly invoked by a
worker. Callers persist results only after rechecking the source memory revision.
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from ..config import Settings
from ..db.database import Database, Tx
from ..domain import processing

log = logging.getLogger(__name__)


class EmbeddingProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class EmbeddingConfig:
    api_key: str
    model_id: str
    dimensions: int
    version: str
    input_usd_per_mtok: float
    timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        if not self.api_key or not self.model_id or self.dimensions < 1 or not self.version:
            raise ValueError("embedding provider, model, dimensions, and version are required")
        if self.input_usd_per_mtok < 0:
            raise ValueError("embedding input price must be non-negative")


@dataclass(frozen=True)
class EmbeddingResult:
    vectors: list[list[float]]
    model_id: str
    dimensions: int
    version: str
    input_tokens: int


class VoyageEmbeddingProvider:
    endpoint = "https://api.voyageai.com/v1/embeddings"

    def __init__(self, config: EmbeddingConfig, client: httpx.Client | None = None) -> None:
        self.config = config
        self.client = client or httpx.Client(timeout=config.timeout_seconds)

    def embed(self, texts: Sequence[str], *, input_type: str) -> EmbeddingResult:
        if not texts or any(not isinstance(text, str) or not text.strip() for text in texts):
            raise ValueError("embedding input must contain non-empty text")
        if input_type not in ("query", "document"):
            raise ValueError("embedding input_type must be query or document")
        response = self.client.post(
            self.endpoint,
            headers={"Authorization": f"Bearer {self.config.api_key}"},
            json={
                "input": list(texts),
                "model": self.config.model_id,
                "output_dimension": self.config.dimensions,
                "input_type": input_type,
            },
        )
        if response.status_code >= 400:
            raise EmbeddingProviderError(f"VOYAGE_HTTP_{response.status_code}")
        try:
            body: dict[str, Any] = response.json()
            data = sorted(body["data"], key=lambda item: item["index"])
            vectors = [list(map(float, item["embedding"])) for item in data]
            usage = int(body.get("usage", {}).get("total_tokens", 0))
        except (KeyError, TypeError, ValueError) as exc:
            raise EmbeddingProviderError("VOYAGE_INVALID_RESPONSE") from exc
        if (
            len(vectors) != len(texts)
            or any(len(vector) != self.config.dimensions for vector in vectors)
            or any(not math.isfinite(value) for vector in vectors for value in vector)
        ):
            raise EmbeddingProviderError("VOYAGE_DIMENSION_MISMATCH")
        return EmbeddingResult(vectors, self.config.model_id, self.config.dimensions, self.config.version, usage)


def _text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def vector_index_available(tx: Tx) -> bool:
    """Return true only when the optional table exists in this database."""
    row = tx.one("select to_regclass('public.search_chunk_embeddings') as table_name")
    return bool(row and row["table_name"])


def configured_embedding(tx: Tx, settings: Settings) -> EmbeddingConfig | None:
    """Return the one active workspace configuration only when it matches server configuration.

    The database row selects a version; environment configuration supplies the secret.  A stale
    row must disable the semantic lane rather than accidentally mix vector spaces.
    """
    if not settings.embedding_configured:
        return None
    row = tx.one(
        "select provider,model_id,dimensions,embedding_version,enabled from retrieval_index_config "
        "where workspace_id=%s",
        (tx.workspace_id,),
    )
    if not row or not row["enabled"]:
        return None
    if (
        row["provider"] != settings.embedding_provider
        or row["model_id"] != settings.embedding_model_id
        or row["dimensions"] != settings.embedding_dimensions
        or row["embedding_version"] != settings.embedding_version
    ):
        return None
    assert settings.embedding_api_key is not None
    assert settings.embedding_model_id is not None
    assert settings.embedding_dimensions is not None
    assert settings.embedding_version is not None
    assert settings.embedding_input_usd_per_mtok is not None
    return EmbeddingConfig(
        settings.embedding_api_key,
        settings.embedding_model_id,
        settings.embedding_dimensions,
        settings.embedding_version,
        settings.embedding_input_usd_per_mtok,
    )


def pending_chunks(tx: Tx, *, version: str, limit: int = 32, max_input_bytes: int = 4096) -> list[dict[str, Any]]:
    """Select only eligible current-revision chunks needing this embedding version."""
    if not vector_index_available(tx):
        raise EmbeddingProviderError("SEMANTIC_INDEX_UNAVAILABLE")
    rows = tx.all(
        """
        select c.id as chunk_id, c.memory_id, c.revision, c.text,
               m.current_revision, e.source_text_sha256,
               coalesce(e.status, 'missing') as embedding_status
          from search_chunks c
          join memories m on m.workspace_id=c.workspace_id and m.id=c.memory_id
          left join search_chunk_embeddings e on e.workspace_id=c.workspace_id
             and e.chunk_id=c.id and e.embedding_version=%s
         where c.workspace_id=%s and c.eligible and c.revision=m.current_revision
           and (e.chunk_id is null or e.status not in ('current','failed')
                or e.source_text_sha256<>encode(digest(c.text,'sha256'),'hex')
                or (e.status='failed' and octet_length(c.text)<=%s))
         order by c.id limit %s
        """,
        (version, tx.workspace_id, max_input_bytes, limit),
    )
    return [
        row
        for row in rows
        if row["embedding_status"] != "current" or row["source_text_sha256"] != _text_hash(str(row["text"]))
    ][:limit]


def mark_oversize_chunk(tx: Tx, chunk: dict[str, Any], config: EmbeddingConfig) -> None:
    """Durable semantic unavailability; preserve full keyword/source content.

    No invented vector is stored. Raising the configured byte limit or changing
    the text/config makes the chunk eligible for another bounded attempt.
    """
    tx.run(
        "insert into search_chunk_embeddings(workspace_id,chunk_id,memory_id,memory_revision,embedding_version,"
        "model_id,dimensions,source_text_sha256,status,embedding) values(%s,%s,%s,%s,%s,%s,%s,%s,'failed',null) "
        "on conflict(workspace_id,chunk_id,embedding_version) do update set status='failed',embedding=null,"
        "source_text_sha256=excluded.source_text_sha256,memory_revision=excluded.memory_revision",
        (
            tx.workspace_id,
            chunk["chunk_id"],
            chunk["memory_id"],
            chunk["revision"],
            config.version,
            config.model_id,
            config.dimensions,
            _text_hash(str(chunk["text"])),
        ),
    )


def request_embeddings(
    provider: VoyageEmbeddingProvider, chunks: Sequence[dict[str, Any]], *, budget_available: bool, input_type: str
) -> EmbeddingResult:
    """Perform the bounded provider call outside a database transaction."""
    if not chunks:
        return EmbeddingResult([], provider.config.model_id, provider.config.dimensions, provider.config.version, 0)
    if not budget_available:
        raise EmbeddingProviderError("BUDGET_EXHAUSTED")
    return provider.embed([str(row["text"]) for row in chunks], input_type=input_type)


def reserve_embedding_budget(
    tx: Tx, settings: Settings, config: EmbeddingConfig, *, purpose: str, input_tokens: int
) -> uuid.UUID:
    """Durably reserve worst-case embedding spend before a provider call.

    This runs in a short transaction.  The caller must make the network call after it commits and
    then finalize the reservation in a new transaction.  Pending reservations count toward the
    shared AI budget, preventing concurrent callers from overspending it.
    """
    if purpose not in ("query", "document") or input_tokens < 1:
        raise ValueError("invalid embedding reservation")
    if not processing.consent_active(tx, settings):
        raise EmbeddingProviderError("CONSENT_REQUIRED")
    tx.run("select pg_advisory_xact_lock(7402007)")
    day, month = processing.spend(tx)
    estimated = input_tokens * config.input_usd_per_mtok / 1_000_000
    assert settings.ai_daily_budget_usd is not None and settings.ai_monthly_budget_usd is not None
    if day + estimated > settings.ai_daily_budget_usd or month + estimated > settings.ai_monthly_budget_usd:
        raise EmbeddingProviderError("BUDGET_EXHAUSTED")
    reservation_id = uuid.uuid4()
    tx.run(
        "insert into embedding_reservations (id,workspace_id,purpose,model_id,estimated_cost_usd,status) "
        "values (%s,%s,%s,%s,%s,'reserved')",
        (reservation_id, tx.workspace_id, purpose, config.model_id, estimated),
    )
    return reservation_id


def finalize_embedding_reservation(
    tx: Tx, reservation_id: uuid.UUID, result: EmbeddingResult | None, *, config: EmbeddingConfig
) -> None:
    """Turn a reservation into recorded usage, or release it after a failed call."""
    reservation = tx.one(
        "select * from embedding_reservations where workspace_id=%s and id=%s for update",
        (tx.workspace_id, reservation_id),
    )
    if reservation is None:
        # Workspace erasure deletes every reservation while provider I/O is
        # intentionally outside the database transaction.  The remote call may
        # already have completed, but erasure wins: do not recreate private
        # usage state and do not turn the expected race into a worker crash.
        return
    if reservation["status"] != "reserved":
        raise EmbeddingProviderError("EMBEDDING_RESERVATION_INVALID")
    if result is None:
        tx.run("update embedding_reservations set status='released', finished_at=now() where id=%s", (reservation_id,))
        return
    actual = result.input_tokens * config.input_usd_per_mtok / 1_000_000
    tx.run("update embedding_reservations set status='completed', finished_at=now() where id=%s", (reservation_id,))
    tx.run(
        "insert into ai_usage (id,workspace_id,job_id,purpose,model_id,input_tokens,output_tokens,estimated_cost_usd) "
        "values (%s,%s,null,'embedding',%s,%s,0,%s)",
        (uuid.uuid4(), tx.workspace_id, result.model_id, result.input_tokens, actual),
    )


def write_embeddings(
    tx: Tx, chunks: Sequence[dict[str, Any]], result: EmbeddingResult, *, provider: VoyageEmbeddingProvider
) -> int:
    """Commit a provider result in a fresh transaction, rechecking source revisions."""
    if not chunks:
        return 0
    if not vector_index_available(tx):
        raise EmbeddingProviderError("SEMANTIC_INDEX_UNAVAILABLE")
    written = 0
    for row, vector in zip(chunks, result.vectors, strict=True):
        current = tx.one(
            "select c.revision, c.text, m.current_revision from search_chunks c "
            "join memories m on m.workspace_id=c.workspace_id and m.id=c.memory_id "
            "where c.workspace_id=%s and c.id=%s and c.eligible",
            (tx.workspace_id, row["chunk_id"]),
        )
        if current is None or current["revision"] != row["revision"] or current["current_revision"] != row["revision"]:
            tx.run(
                "update search_chunk_embeddings set status='stale' "
                "where workspace_id=%s and chunk_id=%s and embedding_version=%s",
                (tx.workspace_id, row["chunk_id"], result.version),
            )
            continue
        digest = _text_hash(str(current["text"]))
        vector_literal = "[" + ",".join(str(float(value)) for value in vector) + "]"
        tx.run(
            """
            insert into search_chunk_embeddings
              (workspace_id,chunk_id,memory_id,memory_revision,embedding_version,model_id,dimensions,source_text_sha256,status,embedding)
            values (%s,%s,%s,%s,%s,%s,%s,%s,'current',%s::vector)
            on conflict (workspace_id,chunk_id,embedding_version) do update set
              memory_id=excluded.memory_id,memory_revision=excluded.memory_revision,model_id=excluded.model_id,
              dimensions=excluded.dimensions,source_text_sha256=excluded.source_text_sha256,status='current',embedding=excluded.embedding
            """,
            (
                tx.workspace_id,
                row["chunk_id"],
                row["memory_id"],
                row["revision"],
                result.version,
                result.model_id,
                result.dimensions,
                digest,
                vector_literal,
            ),
        )
        written += 1
    return written


def main() -> int:
    """Explicit, workspace-scoped embedding rebuild; never an automatic startup task."""
    if os.environ.get("RECALL_EMBEDDINGS_RUN") != "1":
        log.error("set RECALL_EMBEDDINGS_RUN=1 to run an embedding rebuild explicitly")
        return 2
    try:
        user_id = uuid.UUID(os.environ["RECALL_EMBEDDINGS_USER_ID"])
    except (KeyError, ValueError):
        log.error("RECALL_EMBEDDINGS_USER_ID must name an authorized workspace member")
        return 2
    from ..config import get_settings

    settings = get_settings()
    db = Database(settings.database_url)
    db.open()
    try:
        return rebuild_workspace(db, settings, user_id)
    finally:
        db.close()


def rebuild_workspace(db: Database, settings: Settings, user_id: uuid.UUID) -> int:
    """Embed one bounded batch with durable consent/budget gates and no transaction-held I/O."""
    with db.tx(user_id) as tx:
        config = configured_embedding(tx, settings)
        if config is None or not vector_index_available(tx):
            return 0
        if not processing.consent_active(tx, settings):
            return 0
        chunks = pending_chunks(tx, version=config.version, max_input_bytes=settings.embedding_max_batch_tokens)
        if not chunks:
            return 0
        bounded_chunks = []
        planned_tokens = 0
        for chunk in chunks:
            # UTF-8 byte count bounds token count conservatively, including
            # multilingual and punctuation-heavy content.
            tokens = max(1, len(str(chunk["text"]).encode("utf-8")))
            if tokens > settings.embedding_max_batch_tokens:
                mark_oversize_chunk(tx, chunk, config)
                continue
            if planned_tokens + tokens > settings.embedding_max_batch_tokens:
                continue
            bounded_chunks.append(chunk)
            planned_tokens += tokens
        chunks = bounded_chunks
        if not chunks:
            return 0
        reserved = reserve_embedding_budget(
            tx,
            settings,
            config,
            purpose="document",
            input_tokens=planned_tokens,
        )
    provider = VoyageEmbeddingProvider(config)
    result: EmbeddingResult | None = None
    try:
        result = request_embeddings(provider, chunks, budget_available=True, input_type="document")
    except (EmbeddingProviderError, httpx.HTTPError, ValueError):
        result = None
    with db.tx(user_id) as tx:
        if (
            result is not None
            and processing.consent_active(tx, settings)
            and configured_embedding(tx, settings) == config
        ):
            write_embeddings(tx, chunks, result, provider=provider)
        finalize_embedding_reservation(tx, reserved, result, config=config)
    return len(result.vectors) if result is not None else 0


if __name__ == "__main__":
    raise SystemExit(main())
