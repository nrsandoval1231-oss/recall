# I1 — Ambiguous person identity boundary

Sol read-only audit identified that Graphiti may reuse a Person node UUID for two first-name mentions. Source text anchors do not verify shared identity. Controller direction CORRECT, after A1-P releases its builder slot. This is a response boundary, not replacement graph resolution.

Ownership: services/backend/src/recall/knowledge/graph.py and tests/test_knowledge_service.py only. No concurrent edits in those files. No provider calls or commits. Preserve others' changes.

Keep supported Graphiti ingestion/search. Expose Person endpoints as source-local mentions until explicit human identity bindings exist. If an edge has any Person endpoint and more than one current supporting source, suppress it rather than imply deduplicated identity. For a single-source Person endpoint, derive displayed node ID from scope, source ID and Graphiti UUID. Other ontology endpoints keep scoped Graphiti IDs. Stable relationship dismissal identity must include the same source identity. Uncertainty must explicitly say person identity across notes is unverified.

Acceptance: two synthetic notes with ambiguous Brad mentions, same upstream Person UUID, different single-source relationships => distinct exposed Person IDs and exact supports. A shared multi-source Person edge is suppressed. Non-Person edges retain existing IDs/provenance, stale/foreign supports remain rejected. Existing KnowledgePanel focus follows exposed IDs so cannot merge the two person mentions. Tests prove the service boundary; no claim of live provider identity accuracy. Document that human cross-note person identity approval is not yet implemented. This conservative boundary is a product limitation, not completion of the mission's entity-curation goal.

Run focused knowledge tests, Ruff, mypy, diff check. Root reruns and includes this change in final independent exact-candidate review.
