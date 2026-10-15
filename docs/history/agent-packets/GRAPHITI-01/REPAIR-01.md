# Exact-candidate review repair

Candidate reviewed: 9fab143a92c662e6eaac5bb9ad8d9a22cf6de4bb. Sol verdict FIX.

R1 READY: native revocation must persist the disabled generation without enumerating source records; oversized notes cannot block revocation. Disabled snapshot is empty and must not call source enumeration. Failed cancellation/purge transport must be reported as locally disabled but remotely unconfirmed, not success; current native status must be reloaded by UI after failure. Reconnection sends the empty disabled snapshot. Ownership: knowledge.rs, lib.rs, narrowly scoped updateKnowledgeConsent in MemorySurface.tsx and related UI test only. Tests: oversized source disable, unavailable service control persists/fence remains, pending/error UI, eventual empty purge snapshot.

R2 READY independently: Graphiti episode provenance does not prove names appear in notes. Add deterministic Unicode-aware endpoint anchoring in the actual supporting source context. Unanchored subject/object suppress the relationship; matching names remain inferred and are never proof of identity. Ownership: services/backend/src/recall/knowledge/graph.py and tests/test_knowledge_service.py. Test invented endpoint rejection, grounded names accepted, case/Unicode rules and existing stale/scope controls. Do not claim fact entailment or verified identity from the anchor.

Two Luna builders maximum, disjoint ownership, no provider calls, no merge/deploy. Preserve other edits. Repair budget two materially distinct attempts. Root reruns affected checks and actual persisted retrieval, commits candidate, then Sol re-reviews exact repair candidate. Mission production gates remain open. Direction CORRECT.
