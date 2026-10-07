"""Source-located search projections committed from canonical claim revisions."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections import Counter
from collections.abc import Collection
from typing import Any

from ..db.database import Row, Tx


def evidence_key(evidence: list[dict[str, str]]) -> str:
    """Stable source-span identity within one memory."""
    canonical = sorted(evidence, key=lambda item: (item["page_id"], item["quote"]))
    payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def mention_evidence_keys(extraction: dict[str, Any]) -> dict[str, str]:
    """Resolve model-local mention ids to source identities before ids are discarded."""
    return {mention["local_id"]: evidence_key(mention["evidence"]) for mention in extraction["mentions"]}


def claim_identity_key(statement: dict[str, Any], mention_keys: dict[str, str]) -> str:
    """Identify a claim without using unstable model prose or model-local ids."""

    def referenced_mention(local_id: Any) -> str | None:
        return mention_keys.get(local_id) if isinstance(local_id, str) else None

    identity = {
        "evidence": evidence_key(statement["evidence"]),
        "kind": str(statement["kind"]).strip().casefold(),
        "predicate": str(statement["predicate"]).strip().casefold(),
        "subject": referenced_mention(statement.get("subject_mention_id")),
        "object": referenced_mention(statement.get("object_mention_id")),
    }
    payload = json.dumps(identity, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def duplicate_claim_identity_keys(extraction: dict[str, Any]) -> set[str]:
    """Return ambiguous identities so callers can reject them conservatively."""
    mention_keys = mention_evidence_keys(extraction)
    counts = Counter(claim_identity_key(statement, mention_keys) for statement in extraction["statements"])
    return {key for key, count in counts.items() if count > 1}


def write_search_chunks(
    tx: Tx,
    memory_id: uuid.UUID,
    revision: int,
    cap: Row,
    extraction: dict[str, Any],
    source_by_page: dict[str, Row],
    *,
    excluded_claim_keys: Collection[str] = (),
) -> None:
    # Imported at execution time because the worker also calls this function.
    from .worker import _chunks

    chunks: list[tuple[str, Any, Any, str, Any, uuid.UUID | None]] = [
        (*chunk, None) for chunk in _chunks(cap, extraction, source_by_page) if chunk[0] != "statement"
    ]
    if extraction["summary"] and not extraction["summary_evidence"]:
        chunks.append(("context", None, None, extraction["summary"], "confirmed_by_user", None))
    claims = tx.all(
        "select c.id,c.evidence_key,r.text,r.value_text,r.epistemic_state,r.evidence from claims c "
        "join claim_revisions r "
        "on r.claim_id=c.id and r.version=c.current_version where c.workspace_id=%s and c.memory_id=%s order by c.id",
        (tx.workspace_id, memory_id),
    )
    for claim in claims:
        if claim["evidence_key"] in excluded_claim_keys:
            continue
        text = claim["text"]
        if claim["value_text"] and claim["value_text"] not in text:
            text += f" ({claim['value_text']})"
        for page_id in dict.fromkeys(item["page_id"] for item in claim["evidence"]):
            source = source_by_page.get(page_id)
            if source is not None:
                chunks.append(
                    ("statement", source["id"], source["ordinal"], text, claim["epistemic_state"], claim["id"])
                )
    for kind, source_id, ordinal, text, state, claim_id in chunks:
        tx.run(
            "insert into search_chunks(id,workspace_id,memory_id,revision,source_id,kind,ordinal,text,"
            "epistemic_state,claim_id) "
            "values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                uuid.uuid4(),
                tx.workspace_id,
                memory_id,
                revision,
                source_id,
                kind,
                ordinal,
                text[:40000],
                state,
                claim_id,
            ),
        )
