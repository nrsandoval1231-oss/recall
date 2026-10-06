"""Authorized keyword retrieval over the current, eligible revision of each memory.

The question's English lexemes are OR-ed, so a vague recollection matches on whatever words it shares
with the note; ts_rank_cd rewards matching more of them, closer together. Workspace scoping is enforced
by RLS and repeated explicitly in every query.
"""

from __future__ import annotations

from typing import Any

from ..db.database import Tx

MAX_QUESTION_CHARS = 1000


def search(tx: Tx, text: str, limit: int) -> list[dict[str, Any]]:
    text = text[:MAX_QUESTION_CHARS]
    rows = tx.all(
        """
        with q as (
          select to_tsquery('simple', coalesce(string_agg(quote_literal(lexeme), ' | '), '')) as query
          from unnest(tsvector_to_array(to_tsvector('english', %s))) as lexeme
        )
        select c.id as chunk_id, c.memory_id, c.revision, c.source_id, c.kind, c.ordinal, c.text,
               c.epistemic_state, m.capture_id, cap.captured_at, cap.context_hint,
               ts_rank_cd(c.tsv, q.query) as rank,
               ts_headline('english', c.text, q.query,
                           'StartSel="", StopSel="", MaxWords=35, MinWords=12, MaxFragments=2') as excerpt
        from q, search_chunks c
        join memories m on m.workspace_id = c.workspace_id and m.id = c.memory_id
        join captures cap on cap.workspace_id = m.workspace_id and cap.id = m.capture_id
        where c.workspace_id = %s and c.eligible and c.revision = m.current_revision
          and q.query <> ''::tsquery and c.tsv @@ q.query
        order by rank desc, cap.captured_at desc, c.id
        limit %s
        """,
        (text, tx.workspace_id, limit),
    )
    return [
        {
            "chunk_id": str(r["chunk_id"]),
            "memory_id": str(r["memory_id"]),
            "memory_revision": r["revision"],
            "capture_id": str(r["capture_id"]),
            "source_id": str(r["source_id"]) if r["source_id"] else None,
            "page": r["ordinal"],
            "kind": r["kind"],
            "epistemic_state": r["epistemic_state"],
            "captured_at": r["captured_at"].isoformat(),
            "excerpt": r["excerpt"],
            "text": r["text"],
            "rank": float(r["rank"]),
        }
        for r in rows
    ]
