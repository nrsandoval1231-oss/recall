"""Measured hybrid retrieval primitives.

Keyword, entity/alias and semantic candidates are ranked independently, then merged with
reciprocal rank fusion. The semantic lane is deliberately opt-in: an absent vector index is
an explicit unavailable condition, never a locally invented semantic substitute.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from math import isfinite
from typing import Any

from ..db.database import Tx
from ..ingestion.embeddings import EmbeddingConfig


class SemanticIndexUnavailable(RuntimeError):
    """Raised when semantic retrieval was requested but pgvector is unavailable or stale."""


def hybrid_search(
    tx: Tx,
    text: str,
    limit: int,
    *,
    entity_ids: Sequence[str] = (),
    as_of: str | datetime | None = None,
    query_vector: Sequence[float] | None = None,
    embedding_config: EmbeddingConfig | None = None,
) -> list[dict[str, Any]]:
    """Run authorized keyword/entity/vector lanes and fuse them.

    Every lane applies workspace, eligible, and revision gates before rank fusion. ``query_vector``
    is accepted only when semantic retrieval is enabled and the optional pgvector table exists.
    """
    from .search import search

    cutoff = validate_as_of(as_of)
    candidate_limit = max(limit * 4, 20)
    keyword_source = (
        _search_as_of(tx, text, candidate_limit, cutoff, entity_ids=entity_ids)
        if cutoff is not None
        else search(tx, text, candidate_limit)
    )
    keyword = [dict(hit, match_lane="keyword") for hit in keyword_source]
    entity: list[dict[str, Any]] = []
    if cutoff is None and (entity_ids or text.strip()):
        rows = tx.all(
            """
            select distinct c.id as chunk_id, c.memory_id, c.revision, c.source_id, c.kind, c.ordinal, c.text,
                   c.epistemic_state, cap.id as capture_id, cap.captured_at, c.eligible
              from search_chunks c
              join memories m on m.workspace_id=c.workspace_id and m.id=c.memory_id
              join captures cap on cap.workspace_id=m.workspace_id and cap.id=m.capture_id
              left join claims cl on cl.workspace_id=c.workspace_id and cl.id=c.claim_id
              left join claim_revisions cr on cr.workspace_id=cl.workspace_id and cr.claim_id=cl.id
                and cr.version=cl.current_version
              join mentions mn on mn.workspace_id=c.workspace_id and mn.memory_id=c.memory_id
                 and mn.resolution_status='accepted'
                 and mn.revision=(select max(mn2.revision) from mentions mn2
                                    where mn2.workspace_id=mn.workspace_id and mn2.memory_id=mn.memory_id
                                      and mn2.evidence_key=mn.evidence_key)
              join entities e on e.workspace_id=mn.workspace_id and e.id=mn.entity_id
              left join entity_aliases a on a.workspace_id=e.workspace_id and a.entity_id=e.id
             where c.workspace_id=%s and c.eligible and c.revision=m.current_revision
               and (c.claim_id is null or (cr.epistemic_state not in ('retracted','superseded')
                    and (cr.valid_from is null or cr.valid_from <= now())
                    and (cr.valid_to is null or cr.valid_to >= now())))
               and not (c.kind in ('transcription','summary') and c.source_id is not null and exists (
                 select 1 from claim_revisions u where u.workspace_id=c.workspace_id and u.memory_id=c.memory_id
                   and u.origin='user'
                   and u.evidence @> jsonb_build_array(jsonb_build_object('page_id', c.source_id::text))))
               and (%s::uuid[] = '{}' or e.id = any(%s::uuid[]))
               and (lower(e.canonical_name) like any(%s) or lower(a.alias) like any(%s) or lower(c.text) like any(%s))
             order by cap.captured_at desc, c.id limit %s
            """,
            (
                tx.workspace_id,
                list(entity_ids),
                list(entity_ids),
                [f"%{word.lower()}%" for word in text.split() if word],
                [f"%{word.lower()}%" for word in text.split() if word],
                [f"%{word.lower()}%" for word in text.split() if word],
                limit * 4,
            ),
        )
        entity = [_row_to_hit(row, "entity") for row in rows]
    semantic: list[dict[str, Any]] = []
    # Current entity/vector projections can contain a correction made after
    # the requested instant. Until those lanes carry historical versions,
    # historical requests use only the selected historical keyword projection.
    if query_vector is not None and cutoff is None:
        if embedding_config is None:
            raise SemanticIndexUnavailable("SEMANTIC_RETRIEVAL_DISABLED")
        if len(query_vector) != embedding_config.dimensions:
            raise SemanticIndexUnavailable("SEMANTIC_QUERY_DIMENSION_MISMATCH")
        if not all(isfinite(float(value)) for value in query_vector):
            raise SemanticIndexUnavailable("SEMANTIC_QUERY_INVALID")
        table = tx.one("select to_regclass('public.search_chunk_embeddings') as table_name")
        if not table or not table["table_name"]:
            raise SemanticIndexUnavailable("SEMANTIC_INDEX_UNAVAILABLE")
        vector_literal = "[" + ",".join(str(float(value)) for value in query_vector) + "]"
        rows = tx.all(
            """
            select c.id as chunk_id, c.memory_id, c.revision, c.source_id, c.kind, c.ordinal, c.text,
                   c.epistemic_state, cap.id as capture_id, cap.captured_at, e.embedding <=> %s::vector as distance,
                   c.eligible
              from search_chunk_embeddings e
              join search_chunks c on c.workspace_id=e.workspace_id and c.id=e.chunk_id
              join memories m on m.workspace_id=c.workspace_id and m.id=c.memory_id
              join captures cap on cap.workspace_id=m.workspace_id and cap.id=m.capture_id
              left join claims cl on cl.workspace_id=c.workspace_id and cl.id=c.claim_id
              left join claim_revisions cr on cr.workspace_id=cl.workspace_id and cr.claim_id=cl.id
                and cr.version=cl.current_version
             where e.workspace_id=%s and e.status='current' and c.eligible and c.revision=m.current_revision
               and e.memory_revision=c.revision
               and e.embedding_version=%s and e.model_id=%s and e.dimensions=%s
               and e.source_text_sha256=encode(digest(convert_to(c.text, 'UTF8'), 'sha256'), 'hex')
               and (c.claim_id is null or (cr.epistemic_state not in ('retracted','superseded')
                    and (cr.valid_from is null or cr.valid_from <= now())
                    and (cr.valid_to is null or cr.valid_to >= now())))
               and not (c.kind in ('transcription','summary') and c.source_id is not null and exists (
                 select 1 from claim_revisions u where u.workspace_id=c.workspace_id and u.memory_id=c.memory_id
                   and u.origin='user'
                   and u.evidence @> jsonb_build_array(jsonb_build_object('page_id', c.source_id::text))))
             order by distance asc, c.id limit %s
            """,
            (
                vector_literal,
                tx.workspace_id,
                embedding_config.version,
                embedding_config.model_id,
                embedding_config.dimensions,
                limit * 4,
            ),
        )
        semantic = [_row_to_hit(row, "semantic") for row in rows]
    return merge_authorized_candidates(keyword, entity, semantic, limit=limit, as_of=cutoff)


def _row_to_hit(row: dict[str, Any], lane: str) -> dict[str, Any]:
    hit = {
        "chunk_id": str(row["chunk_id"]),
        "memory_id": str(row["memory_id"]),
        "memory_revision": row["revision"],
        "capture_id": str(row["capture_id"]),
        "source_id": str(row["source_id"]) if row.get("source_id") else None,
        "page": row["ordinal"],
        "kind": row["kind"],
        "epistemic_state": row["epistemic_state"],
        "captured_at": row["captured_at"].isoformat(),
        "text": row["text"],
        "eligible": row.get("eligible", True),
        "excerpt": row.get("excerpt") or row["text"],
        "match_lane": lane,
    }
    for key in ("recorded_at", "valid_from", "valid_to", "supersedes_claim_id", "history_status"):
        if key in row:
            value = row[key]
            hit[key] = value.isoformat() if isinstance(value, datetime) else (str(value) if value is not None else None)
    return hit


def _search_as_of(
    tx: Tx, text: str, limit: int, cutoff: datetime, *, entity_ids: Sequence[str] = ()
) -> list[dict[str, Any]]:
    """Keyword evidence as it existed at ``cutoff``; do not retrofit later corrections."""
    rows = tx.all(
        """
        with q as (
          select to_tsquery('simple', coalesce(string_agg(quote_literal(lexeme), ' | '), '')) as query
            from unnest(tsvector_to_array(to_tsvector('english', %s))) as lexeme
        ), revisions as (
          select mr.memory_id, max(mr.revision) as revision
            from memory_revisions mr where mr.workspace_id=%s and mr.created_at <= %s
           group by mr.memory_id
        )
        select c.id as chunk_id,c.memory_id,c.revision,c.source_id,c.kind,c.ordinal,c.text,c.epistemic_state,
               cap.id as capture_id,cap.captured_at,c.eligible,ts_rank_cd(c.tsv,q.query) as rank,
               ts_headline('english',c.text,q.query,
                 'StartSel="", StopSel="", MaxWords=35, MinWords=12, MaxFragments=2') as excerpt
          from q join search_chunks c on true
          join revisions r on r.memory_id=c.memory_id and r.revision=c.revision
          join memories m on m.workspace_id=c.workspace_id and m.id=c.memory_id
          join captures cap on cap.workspace_id=m.workspace_id and cap.id=m.capture_id
          left join lateral (
            select cr.* from claim_revisions cr where cr.workspace_id=c.workspace_id and cr.claim_id=c.claim_id
              and cr.created_at <= %s order by cr.created_at desc,cr.version desc limit 1
          ) claim_at on c.claim_id is not null
         where c.workspace_id=%s and q.query <> ''::tsquery and c.tsv @@ q.query
           and (%s::uuid[]='{}' or exists(select 1 from mentions mn where mn.workspace_id=c.workspace_id
                and mn.memory_id=c.memory_id and mn.revision<=c.revision and mn.entity_id=any(%s::uuid[])
                and mn.resolution_status='accepted'))
           and (c.claim_id is null or (claim_at.epistemic_state not in ('retracted','superseded')
                and (claim_at.valid_from is null or claim_at.valid_from <= %s)
                and (claim_at.valid_to is null or claim_at.valid_to >= %s)))
         order by rank desc,cap.captured_at desc,c.id limit %s
        """,
        (
            text,
            tx.workspace_id,
            cutoff,
            cutoff,
            tx.workspace_id,
            list(entity_ids),
            list(entity_ids),
            cutoff,
            cutoff,
            limit,
        ),
    )
    # A later correction marks its obsolete projection ineligible for *current* retrieval.
    # The selected historical revision remains eligible for an explicitly historical question.
    for row in rows:
        row["eligible"] = True
    return [_row_to_hit(row, "keyword") for row in rows]


def temporal_claim_search(
    tx: Tx, text: str, limit: int, *, mode: str, cutoff: datetime | None = None
) -> list[dict[str, Any]]:
    """Return relevant canonical claim revisions for a bounded natural-time question.

    This deliberately searches the claim history, rather than deriving an arbitrary
    workspace-wide timestamp from the oldest memory.  A historical answer therefore
    remains about the matching claim even when an unrelated note was saved earlier.
    """
    if mode not in {"original", "history", "all", "before", "after"}:
        raise ValueError("Unsupported temporal retrieval mode")
    if mode in {"before", "after"} and cutoff is None:
        raise ValueError("Temporal before/after questions need an ISO-8601 timestamp")
    direction_clause = {
        "before": "and cr.created_at <= %s",
        "after": "and cr.created_at >= %s",
    }.get(mode, "")
    order = (
        "cr.created_at asc, cr.claim_id, cr.version"
        if mode == "original"
        else "rank desc, cr.created_at asc, cr.claim_id, cr.version"
    )
    statement = """
        with q as (
          select to_tsquery('simple', coalesce(string_agg(quote_literal(lexeme), ' | '), '')) as query
            from unnest(tsvector_to_array(to_tsvector('english', %s))) as lexeme
        ), ranked as (
          select cr.*, ts_rank_cd(to_tsvector('english', cr.text), q.query) as rank
            from claim_revisions cr cross join q
           where cr.workspace_id=%s and q.query <> ''::tsquery
             and to_tsvector('english', cr.text) @@ q.query
             __DIRECTION_CLAUSE__
        )
        select (cr.claim_id::text || ':' || cr.version::text) as chunk_id,
               cr.memory_id, cr.memory_revision as revision, source.source_id,
               cr.kind, 0 as ordinal, cr.text, cr.epistemic_state,
               cap.id as capture_id, cap.captured_at, true as eligible,
               cr.created_at as recorded_at, cr.valid_from, cr.valid_to, cr.supersedes_claim_id,
               case
                 when cr.epistemic_state in ('retracted', 'superseded') then cr.epistemic_state
                 when cr.supersedes_claim_id is not null then 'superseding'
                 when exists (select 1 from claim_revisions successor
                              where successor.workspace_id=cr.workspace_id
                                and successor.supersedes_claim_id=cr.claim_id) then 'superseded'
                 else 'recorded'
               end as history_status,
               ts_headline('english', cr.text, q.query,
                 'StartSel="", StopSel="", MaxWords=35, MinWords=12, MaxFragments=2') as excerpt
          from ranked cr cross join q
          join memories m on m.workspace_id=cr.workspace_id and m.id=cr.memory_id
          join captures cap on cap.workspace_id=m.workspace_id and cap.id=m.capture_id
          left join lateral (
            select (part.value->>'page_id')::uuid as source_id
              from jsonb_array_elements(cr.evidence) part(value)
             where coalesce(part.value->>'page_id', '') ~*
                   '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             limit 1
          ) source on true
         order by __ORDER_CLAUSE__
         limit %s
        """
    # The two fragments are selected from closed local enum maps above, never request data.
    statement = statement.replace("__DIRECTION_CLAUSE__", direction_clause).replace("__ORDER_CLAUSE__", order)
    rows = tx.all(
        statement,
        (text, tx.workspace_id, *([cutoff] if direction_clause else []), limit),
    )
    # "Original" asks for the oldest matching version of a claim, rather than every
    # matching claim in the workspace.  The caller's fixed packet bound keeps this
    # evidence-only history lane small.
    if mode == "original":
        seen: set[object] = set()
        oldest: list[dict[str, Any]] = []
        for row in rows:
            if row["memory_id"] not in seen:
                seen.add(row["memory_id"])
                oldest.append(row)
        rows = oldest
    return [_row_to_hit(row, "history") for row in rows]


@dataclass(frozen=True)
class HybridWeights:
    keyword: float = 1.0
    entity: float = 1.15
    semantic: float = 0.9
    rrf_k: int = 60


def _key(hit: dict[str, Any]) -> str:
    return str(hit.get("chunk_id") or hit.get("memory_id") or hit.get("record_id"))


def reciprocal_rank_fusion(
    keyword: Sequence[dict[str, Any]],
    entity: Sequence[dict[str, Any]],
    semantic: Sequence[dict[str, Any]],
    *,
    limit: int,
    weights: HybridWeights = HybridWeights(),
) -> list[dict[str, Any]]:
    """Merge independently ranked authorized candidates without allowing one lane to dominate."""
    merged: dict[str, dict[str, Any]] = {}
    scores: dict[str, float] = {}
    for lane, weight in ((keyword, weights.keyword), (entity, weights.entity), (semantic, weights.semantic)):
        for rank, hit in enumerate(lane, start=1):
            key = _key(hit)
            if key not in merged:
                merged[key] = dict(hit)
                merged[key]["match_lanes"] = []
            if hit.get("match_lane") and hit["match_lane"] not in merged[key]["match_lanes"]:
                merged[key]["match_lanes"].append(hit["match_lane"])
            scores[key] = scores.get(key, 0.0) + weight / (weights.rrf_k + rank)
    output = sorted(merged.values(), key=lambda hit: (-scores[_key(hit)], _key(hit)))
    for hit in output:
        hit["rank"] = scores[_key(hit)]
    return output[: max(0, limit)]


def validate_as_of(value: str | datetime | None) -> datetime | None:
    if value is None:
        return value
    if isinstance(value, datetime):
        return value
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("as_of must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError("as_of must include a timezone")
    return parsed


def merge_authorized_candidates(
    keyword_hits: Iterable[dict[str, Any]],
    entity_hits: Iterable[dict[str, Any]],
    semantic_hits: Iterable[dict[str, Any]],
    *,
    limit: int,
    as_of: str | datetime | None = None,
) -> list[dict[str, Any]]:
    """Apply the final temporal gate before constructing an evidence packet."""
    cutoff = validate_as_of(as_of)
    lanes = []
    for hits in (keyword_hits, entity_hits, semantic_hits):
        filtered = []
        for hit in hits:
            captured = hit.get("captured_at")
            if cutoff is not None and captured is not None:
                when = validate_as_of(captured)
                if when is not None and when > cutoff:
                    continue
            if hit.get("eligible", True):
                filtered.append(hit)
        lanes.append(filtered)
    return reciprocal_rank_fusion(*lanes, limit=limit)
