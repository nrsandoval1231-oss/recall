"""Synthetic, deterministic RCL003B rank/fusion tests; no provider or semantic-quality claim."""

import json
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

from recall.db.database import Tx
from recall.ingestion.embeddings import EmbeddingConfig, EmbeddingProviderError, VoyageEmbeddingProvider, pending_chunks
from recall.retrieval.hybrid import (
    SemanticIndexUnavailable,
    hybrid_search,
    merge_authorized_candidates,
    reciprocal_rank_fusion,
)


def hit(key: str, lane: str, captured_at: str = "2026-01-01T00:00:00+00:00") -> dict[str, object]:
    return {"chunk_id": key, "match_lane": lane, "captured_at": captured_at, "eligible": True}


def test_rrf_rewards_independent_keyword_and_entity_agreement() -> None:
    results = reciprocal_rank_fusion([hit("a", "keyword"), hit("b", "keyword")], [hit("b", "entity")], [], limit=2)
    assert [row["chunk_id"] for row in results] == ["b", "a"]
    assert results[0]["match_lanes"] == ["keyword", "entity"]


def test_as_of_and_eligibility_filter_before_fusion() -> None:
    results = merge_authorized_candidates(
        [hit("old", "keyword"), hit("future", "keyword", "2027-01-01T00:00:00+00:00")],
        [],
        [dict(hit("stale", "semantic"), eligible=False)],
        limit=10,
        as_of="2026-06-01T00:00:00+00:00",
    )
    assert [row["chunk_id"] for row in results] == ["old"]


def test_voyage_adapter_validates_dimensions_without_live_call() -> None:
    config = EmbeddingConfig("test-key", "voyage-3.5", 3, "voyage-3.5-v1", 0.1)
    provider = VoyageEmbeddingProvider(config)

    class Response:
        status_code = 200

        def json(self) -> dict[str, object]:
            return {"data": [{"index": 0, "embedding": [1, 2]}]}

    class Client:
        def post(self, *args: object, **kwargs: object) -> Response:
            return Response()

    provider.client = Client()  # type: ignore[assignment]
    try:
        provider.embed(["synthetic fixture"], input_type="query")
    except EmbeddingProviderError as exc:
        assert str(exc) == "VOYAGE_DIMENSION_MISMATCH"
    else:
        raise AssertionError("dimension mismatch must be rejected")


@pytest.fixture
def retrieval_db(pg_cluster: object) -> tuple[psycopg.Connection, uuid.UUID]:
    cluster = pg_cluster
    dsn = cluster.dsn()  # type: ignore[attr-defined]
    name = f"hybrid_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(dsn, autocommit=True) as admin:
        admin.execute(f'create database "{name}"')
    conn = psycopg.connect(cluster.dsn(name), row_factory=dict_row)  # type: ignore[attr-defined]
    conn.autocommit = True
    conn.execute("create extension if not exists pgcrypto")
    workspace = uuid.uuid4()
    memory = uuid.uuid4()
    capture = uuid.uuid4()
    chunk = uuid.uuid4()
    entity = uuid.uuid4()
    conn.execute(
        "create table captures (id uuid primary key, workspace_id uuid, captured_at timestamptz not null, context_hint text)"
    )
    conn.execute(
        "create table memories (id uuid primary key, workspace_id uuid, capture_id uuid, current_revision integer)"
    )
    conn.execute(
        "create table memory_revisions (workspace_id uuid, memory_id uuid, revision integer, created_at timestamptz)"
    )
    conn.execute(
        "create table search_chunks (id uuid primary key, workspace_id uuid, memory_id uuid, revision integer, source_id uuid, kind text, ordinal integer, text text, epistemic_state text, eligible boolean, claim_id uuid, tsv tsvector)"
    )
    conn.execute("create table claims (id uuid primary key, workspace_id uuid, current_version integer)")
    conn.execute(
        "create table claim_revisions (workspace_id uuid, claim_id uuid, memory_id uuid, version integer, "
        "origin text, epistemic_state text, valid_from timestamptz, valid_to timestamptz, evidence jsonb, created_at timestamptz)"
    )
    conn.execute("create table entities (id uuid primary key, workspace_id uuid, canonical_name text)")
    conn.execute("create table entity_aliases (workspace_id uuid, entity_id uuid, alias text)")
    conn.execute(
        "create table mentions (workspace_id uuid, memory_id uuid, revision integer, local_id text, evidence_key text, "
        "entity_id uuid, resolution_status text)"
    )
    conn.execute("insert into captures values (%s,%s,'2026-01-01T00:00:00Z',null)", (capture, workspace))
    conn.execute("insert into memories values (%s,%s,%s,1)", (memory, workspace, capture))
    conn.execute("insert into memory_revisions values (%s,%s,1,'2026-01-01T00:00:00Z')", (workspace, memory))
    text = "synthetic Florence restaurant recommendation"
    conn.execute(
        "insert into search_chunks values (%s,%s,%s,1,%s,'statement',1,%s,'reported',true,null,to_tsvector('english',%s))",
        (chunk, workspace, memory, uuid.uuid4(), text, text),
    )
    conn.execute("insert into entities values (%s,%s,'Florence restaurant')", (entity, workspace))
    conn.execute("insert into entity_aliases values (%s,%s,'Sarah')", (workspace, entity))
    conn.execute("insert into mentions values (%s,%s,1,'m1',%s,%s,'accepted')", (workspace, memory, "a" * 64, entity))
    yield conn, workspace
    conn.close()
    with psycopg.connect(dsn, autocommit=True) as admin:
        admin.execute(f'drop database "{name}"')


def test_real_postgres_keyword_entity_scope_and_vector_gate(retrieval_db: tuple[psycopg.Connection, uuid.UUID]) -> None:
    conn, workspace = retrieval_db
    tx = Tx(conn=conn, user_id=uuid.uuid4(), workspace_id=workspace)
    hits = hybrid_search(tx, "Florence restaurant", 5)
    assert hits and hits[0]["match_lanes"] == ["keyword", "entity"]
    assert hybrid_search(tx, "Sarah", 5)[0]["match_lanes"] == ["entity"]
    with pytest.raises(SemanticIndexUnavailable, match="SEMANTIC_RETRIEVAL_DISABLED"):
        hybrid_search(tx, "Florence", 5, query_vector=[1.0, 0.0])


def test_real_postgres_marks_changed_chunk_for_rebuild(retrieval_db: tuple[psycopg.Connection, uuid.UUID]) -> None:
    conn, workspace = retrieval_db
    conn.execute(
        "create table search_chunk_embeddings (workspace_id uuid, chunk_id uuid, memory_id uuid, memory_revision integer, "
        "embedding_version text, source_text_sha256 text, status text)"
    )
    row = conn.execute("select id,memory_id,revision,text from search_chunks limit 1").fetchone()
    assert row is not None
    conn.execute(
        "insert into search_chunk_embeddings values (%s,%s,%s,%s,'v1','stale-hash','current')",
        (workspace, row["id"], row["memory_id"], row["revision"]),
    )
    tx = Tx(conn=conn, user_id=uuid.uuid4(), workspace_id=workspace)
    pending = pending_chunks(tx, version="v1", limit=10)
    assert [item["chunk_id"] for item in pending] == [row["id"]]


def test_claim_chunk_uses_canonical_current_or_historical_revision(
    retrieval_db: tuple[psycopg.Connection, uuid.UUID],
) -> None:
    conn, workspace = retrieval_db
    row = conn.execute("select id,memory_id,revision,source_id,text from search_chunks limit 1").fetchone()
    assert row is not None
    claim = uuid.uuid4()
    conn.execute("insert into claims values (%s,%s,2)", (claim, workspace))
    conn.execute("update search_chunks set claim_id=%s where id=%s", (claim, row["id"]))
    conn.execute(
        "insert into claim_revisions values (%s,%s,%s,1,'model','reported',null,null,'[]','2026-01-01T00:00:00Z'),"
        "(%s,%s,%s,2,'user','retracted',null,null,'[]','2026-02-01T00:00:00Z')",
        (workspace, claim, row["memory_id"], workspace, claim, row["memory_id"]),
    )
    tx = Tx(conn=conn, user_id=uuid.uuid4(), workspace_id=workspace)
    assert hybrid_search(tx, "Florence", 5) == []
    historical = hybrid_search(tx, "Florence", 5, as_of="2026-01-15T00:00:00+00:00")
    assert [hit["chunk_id"] for hit in historical] == [str(row["id"])]


def test_real_pgvector_semantic_lane_binds_model_version_dimension_and_text_hash(
    retrieval_db: tuple[psycopg.Connection, uuid.UUID],
) -> None:
    conn, workspace = retrieval_db
    try:
        conn.execute("create extension if not exists vector")
        conn.execute("create extension if not exists pgcrypto")
    except psycopg.Error:
        pytest.skip("pgvector is not installed in this local PostgreSQL")
    conn.execute(
        "create table search_chunk_embeddings (workspace_id uuid, chunk_id uuid, memory_id uuid, "
        "memory_revision integer, embedding_version text, model_id text, dimensions integer, "
        "source_text_sha256 text, status text, embedding vector)"
    )
    row = conn.execute("select id,memory_id,revision,text from search_chunks limit 1").fetchone()
    assert row is not None
    conn.execute(
        "insert into search_chunk_embeddings values (%s,%s,%s,%s,'v1','synthetic-model',3,"
        "encode(digest(convert_to(%s,'UTF8'),'sha256'),'hex'),'current','[1,0,0]')",
        (workspace, row["id"], row["memory_id"], row["revision"], row["text"]),
    )
    tx = Tx(conn=conn, user_id=uuid.uuid4(), workspace_id=workspace)
    config = EmbeddingConfig("not-a-real-key", "synthetic-model", 3, "v1", 0.1)
    hits = hybrid_search(tx, "associative paraphrase", 5, query_vector=[1.0, 0.0, 0.0], embedding_config=config)
    assert hits[0]["chunk_id"] == str(row["id"])
    assert hits[0]["match_lanes"] == ["semantic"]
    conn.execute("update search_chunk_embeddings set model_id='wrong-space'")
    assert hybrid_search(tx, "associative paraphrase", 5, query_vector=[1.0, 0.0, 0.0], embedding_config=config) == []


def test_synthetic_corpus_keyword_matrix_uses_real_postgres_sql(
    retrieval_db: tuple[psycopg.Connection, uuid.UUID],
) -> None:
    """This exercises the production keyword/entity SQL, not the pure fixture scorer."""
    conn, workspace = retrieval_db
    corpus_path = Path(__file__).parents[3] / "tests" / "evaluation" / "rcl003b_hybrid_corpus.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    for ordinal, item in enumerate(corpus["items"], start=2):
        memory, capture, chunk = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        conn.execute("insert into captures values (%s,%s,now(),null)", (capture, workspace))
        conn.execute("insert into memories values (%s,%s,%s,1)", (memory, workspace, capture))
        conn.execute("insert into memory_revisions values (%s,%s,1,now())", (workspace, memory))
        conn.execute(
            "insert into search_chunks values (%s,%s,%s,1,%s,'statement',%s,%s,'reported',true,null,to_tsvector('english',%s))",
            (chunk, workspace, memory, uuid.uuid4(), ordinal, item["text"], item["text"]),
        )
    tx = Tx(conn=conn, user_id=uuid.uuid4(), workspace_id=workspace)
    assert hybrid_search(tx, "mitochondrial DNA", 3)[0]["text"].startswith("Professor Miller")
    assert hybrid_search(tx, "garage battery", 3)[0]["text"].startswith("The garage")
    assert hybrid_search(tx, "Riverside cleanup", 3)[0]["text"].startswith("April neighborhood")
