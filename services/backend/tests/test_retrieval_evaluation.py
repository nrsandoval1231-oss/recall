"""Measured synthetic retrieval evaluation through the production PostgreSQL hybrid path.

This is a fixed-vector regression corpus, not live Voyage quality evidence.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path

import psycopg
import pytest

from recall.db.database import Tx
from recall.ingestion.embeddings import EmbeddingConfig
from recall.retrieval.hybrid import hybrid_search

CORPUS = Path(__file__).parents[3] / "tests" / "evaluation" / "rcl003b_hybrid_corpus.json"
pytest_plugins = ("test_hybrid_retrieval",)


def _metrics(ranks: list[int | None]) -> dict[str, float]:
    count = len(ranks)
    return {
        "recall_at_1": sum(rank is not None and rank <= 1 for rank in ranks) / count,
        "recall_at_3": sum(rank is not None and rank <= 3 for rank in ranks) / count,
        "mrr": sum(1 / rank for rank in ranks if rank is not None) / count,
    }


def _rank(tx: Tx, query: str, expected: str, expected_chunks: dict[str, str], **kwargs: object) -> int | None:
    hits = hybrid_search(tx, query, 10, **kwargs)
    wanted = expected_chunks[expected]
    for index, hit in enumerate(hits, start=1):
        if hit["chunk_id"] == wanted:
            return index
    return None


def test_synthetic_corpus_measures_keyword_and_pgvector_fusion(
    retrieval_db: tuple[psycopg.Connection, uuid.UUID],
    capsys: pytest.CaptureFixture[str],
) -> None:
    conn, workspace = retrieval_db
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    expected_chunks: dict[str, str] = {}
    vectors: dict[str, list[float]] = {}
    for ordinal, item in enumerate(corpus["items"], start=2):
        memory, capture, chunk = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        expected_chunks[item["id"]] = str(chunk)
        vectors[str(chunk)] = item["vector"]
        conn.execute("insert into captures values (%s,%s,now(),null)", (capture, workspace))
        conn.execute("insert into memories values (%s,%s,%s,1)", (memory, workspace, capture))
        conn.execute("insert into memory_revisions values (%s,%s,1,now())", (workspace, memory))
        conn.execute(
            "insert into search_chunks values (%s,%s,%s,1,%s,'statement',%s,%s,'reported',true,null,to_tsvector('english',%s))",
            (chunk, workspace, memory, uuid.uuid4(), ordinal, item["text"], item["text"]),
        )

    # A matching phrase in another workspace must never affect this workspace's rank.
    foreign = uuid.uuid4()
    foreign_memory, foreign_capture, foreign_chunk = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    conn.execute("insert into captures values (%s,%s,now(),null)", (foreign_capture, foreign))
    conn.execute("insert into memories values (%s,%s,%s,1)", (foreign_memory, foreign, foreign_capture))
    conn.execute("insert into memory_revisions values (%s,%s,1,now())", (foreign, foreign_memory))
    conn.execute(
        "insert into search_chunks values (%s,%s,%s,1,%s,'statement',1,%s,'reported',true,null,to_tsvector('english',%s))",
        (foreign_chunk, foreign, foreign_memory, uuid.uuid4(), "Northline permit contact", "Northline permit contact"),
    )

    tx = Tx(conn=conn, user_id=uuid.uuid4(), workspace_id=workspace)
    keyword_ranks = [_rank(tx, item["query"], item["expected"], expected_chunks) for item in corpus["held_out_queries"]]
    result: dict[str, object] = {"synthetic": True, "queries": len(keyword_ranks), "keyword": _metrics(keyword_ranks)}

    try:
        conn.execute("create extension if not exists vector")
    except psycopg.Error:
        print(json.dumps({**result, "semantic": "skipped: pgvector is not installed"}, sort_keys=True))
        assert result["keyword"]["recall_at_3"] >= 0.25  # type: ignore[index]
        return
    conn.execute(
        "create table search_chunk_embeddings (workspace_id uuid, chunk_id uuid, memory_id uuid, memory_revision integer, embedding_version text, model_id text, dimensions integer, source_text_sha256 text, status text, embedding vector)"
    )
    rows = conn.execute(
        "select id,memory_id,revision,text from search_chunks where workspace_id=%s and id=any(%s)",
        (workspace, [uuid.UUID(chunk) for chunk in vectors]),
    ).fetchall()
    for row in rows:
        conn.execute(
            "insert into search_chunk_embeddings values (%s,%s,%s,%s,'eval-v1','eval-model',3,%s,'current',%s::vector)",
            (
                workspace,
                row["id"],
                row["memory_id"],
                row["revision"],
                hashlib.sha256(row["text"].encode("utf-8")).hexdigest(),
                "[" + ",".join(map(str, vectors[str(row["id"])])) + "]",
            ),
        )
    config = EmbeddingConfig("synthetic", "eval-model", 3, "eval-v1", 0.1)
    hybrid_ranks = [
        _rank(
            tx, item["query"], item["expected"], expected_chunks, query_vector=item["vector"], embedding_config=config
        )
        for item in corpus["held_out_queries"]
    ]
    result["hybrid"] = _metrics(hybrid_ranks)
    print(json.dumps(result, sort_keys=True))
    assert result["hybrid"]["recall_at_1"] >= 0.5  # type: ignore[index]
    assert result["hybrid"]["recall_at_3"] >= 0.75  # type: ignore[index]
    assert "Northline permit contact" not in [
        hit["text"] for hit in hybrid_search(tx, corpus["cross_workspace_queries"][0], 10)
    ]
    assert capsys.readouterr().out
