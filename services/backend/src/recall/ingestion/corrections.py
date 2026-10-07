"""Apply accepted human claim revisions before persisting any new model projection."""

from __future__ import annotations

import uuid
from collections.abc import Collection
from typing import Any

from ..db.database import Tx
from .projection import claim_identity_key, mention_evidence_keys


def apply_claim_overrides(
    tx: Tx,
    memory_id: uuid.UUID,
    extraction: dict[str, Any],
    *,
    rejected_claim_keys: Collection[str] = (),
) -> None:
    rows = tx.all(
        "select c.evidence_key,r.* from claims c join claim_revisions r "
        "on r.claim_id=c.id and r.version=c.current_version "
        "where c.workspace_id=%s and c.memory_id=%s and exists "
        "(select 1 from memory_overrides o where o.workspace_id=c.workspace_id and o.claim_id=c.id)",
        (tx.workspace_id, memory_id),
    )
    overrides = {row["evidence_key"]: row for row in rows}
    mention_keys = mention_evidence_keys(extraction)
    for statement in extraction["statements"]:
        key = claim_identity_key(statement, mention_keys)
        if key in rejected_claim_keys:
            continue
        row = overrides.get(key)
        if row is not None:
            for field in ("text", "value_text", "epistemic_state", "attribution_text", "temporal_text"):
                statement[field] = row[field]
