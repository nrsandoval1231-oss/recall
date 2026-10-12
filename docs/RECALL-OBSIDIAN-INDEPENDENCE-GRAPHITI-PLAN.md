# Recall: Obsidian-independent knowledge workspace and Graphiti evaluation plan

**Status:** Proposed follow-on plan for PR #26; not implemented by this document.
**Decision:** Recall is the primary user-facing note and knowledge application. Markdown originals and attachments remain portable and authoritative. Obsidian is optional and never required for core operation.

## Current PR #26 baseline
PR #26 establishes Recall-owned local vault directories (Sources, Memories, History, _meta), in-app Memories browsing/light edits, keyword Ask with citations, and no required Claude key. Preserve those behaviors. Do not represent desktop/iPhone/provider acceptance as complete until real-device verification.

## Product outcome
A person can capture messy handwritten notes, typed notes, links, and meeting materials; review and correct extracted content; retrieve exact original sources; discover related knowledge; and maintain notes entirely in Recall without installing Obsidian. Core capture, read, edit, keyword search, and export work with AI disabled.

## Non-negotiable invariants
1. Original captures and approved Markdown records are the source of truth; derived indexes, embeddings, and graph databases are disposable/rebuildable.
2. Never silently overwrite externally modified files; use revision-aware writes, atomic persistence, and explicit conflict handling.
3. AI-extracted claims are suggestions until verified or accepted; do not silently turn inferred commitments, relationships, or decisions into facts.
4. Every AI answer and graph relationship must carry source identity, scope, timestamps, and evidence; distinguish asserted, inferred, rejected, and superseded claims.
5. Privacy scopes and revocation apply before retrieval and outbound model calls. Never assume employer or client data may be sent to third-party providers.
6. Offline capture/read/search must not depend on Graphiti, network access, or model keys.
7. Avoid rebuilding Obsidian's plugin ecosystem or creating a second editable copy of the vault.

## Delivery sequence

### Phase 0 — Land and verify PR #26
- Reconcile this plan with the current PR #26 implementation and canonical docs. Do not reintroduce obsolete Obsidian-required language.
- Run existing unit, Rust, lint, and type checks. Verify real installed Windows desktop and iPhone/PWA journeys separately; document gaps honestly.
- Acceptance: capture, open, lightly edit, and keyword-search a real approved vault note; reopen after restart; source paths and citations are correct.

### Phase 1 — Complete independent note workflows
- Support reliable capture of photos, documents, text, links, and meeting notes while preserving original binaries.
- Add useful note review/correction, basic Markdown rendering/editing, backlinks and navigation, import/export, search, and backup/restore.
- Provide explicit pending/synced/offline/error states, conflict recovery, and no-login pilot behavior consistent with current product decisions.
- Acceptance: a seven-day user pilot without opening Obsidian; notes remain readable as Markdown and attachments after full export and restore.

### Phase 2 — Establish a measurable retrieval baseline
- Create an owner-approved evaluation corpus with synthetic fixtures plus separately authorized real examples.
- Benchmark keyword/SQLite full-text search and lightweight relationships against 20-30 representative questions: exact note lookup, related person/project, current decision, superseded decision, ambiguous name, unsupported question.
- Record retrieval relevance, citation accuracy, stale-claim errors, latency, operating cost, and privacy leakage.
- Acceptance: all test queries have reproducible expected evidence; unsupported queries abstain; no invented citations.

### Phase 3 — Graphiti isolated proof of concept
- Build an optional adapter under the knowledge/indexing boundary, not a second application or mandatory runtime.
- Start with a small ontology: Person, Organization, Project, Decision, KnowledgeItem; relations such as RELATES_TO, DECIDED, SUPERSEDES, DEPENDS_ON, SUPPORTED_BY.
- Ingest only approved episodes with stable source IDs, source revisions, privacy scopes, timestamps, and idempotency keys. Preserve raw originals outside Graphiti.
- Test incremental changes, deletions/revocations, alias collisions, contradictory claims, temporal validity, and rebuild from vault.
- Choose a supported graph backend only for the experiment; keep graph storage and inference credentials outside the repo.
- Graphiti extraction may use model APIs; require explicit provider choice and opt-in for sensitive content. A failed extraction must never block capture.
- Acceptance: measurable improvement over Phase 2 on relationship and temporal questions, with no material citation/privacy regression and acceptable cost/latency. If not demonstrated, retain the simpler index and stop.

### Phase 4 — Intelligent Recall features, conditional on Phase 3
- Introduce source-backed related-memory suggestions, decision timeline, relationship explorer, and question answering with citations.
- Separate explicit links from inferred connections; allow correction, dismissal, and explanation of why two records are related.
- Keep the visual graph optional and navigable via accessible list/search alternatives.
- Never auto-activate inferred tasks or silently rewrite canonical notes.

### Phase 5 — Production hardening and Obsidian exit criteria
- Verify backups and full restore, original-file integrity, incremental indexing, failure recovery, provider outage, graph deletion/rebuild, mobile/desktop usability, and privacy isolation.
- Verify portable export without Recall-specific services; optional Obsidian compatibility remains a convenience, not a dependency.
- Only then describe Recall as a practical Obsidian replacement for the pilot workflow.

## Architecture boundary

Capture / UI -> revision-safe Markdown vault + original attachments (authority)
                 -> SQLite metadata, full-text search, outbox (rebuildable where applicable)
                 -> optional Graphiti temporal relationship index (rebuildable)
                 -> evidence-filtered retrieval -> optional LLM synthesis
                 -> cited answers and user-correctable relationships

Graphiti does **not** own notes, attachments, user-approved decisions, reminder delivery, authentication, or the authoritative edit history.

## Execution guardrails
- Treat this as a plan, not a request to implement all phases inside PR #26.
- Keep PR #26's immediate user-visible outcome small; subsequent phases should be separately reviewed slices.
- Update the existing canonical product and architecture documents when implementation decisions are accepted; avoid parallel contradictory PRDs.
- Do not claim that a graph improves recall until measured against the baseline.
- Do not merge PR #26 solely because this plan was added.
