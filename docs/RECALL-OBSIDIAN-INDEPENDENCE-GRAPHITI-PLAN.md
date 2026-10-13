> Owner mission update, 2026-10-12: the full Graphiti integration is now explicitly authorized. This retained reference originated on open PR #26 at 0d36d891. Its historical instructions to keep implementation out of that PR remain correct; integration is on integrate/graphiti from current main. Existing Jev/Claude capabilities and the current canonical UI are preserved. Current implementation and evidence: .agent/GRAPHITI-01. The staged plan below is context, not a claim of completion or a requirement to merge PR #26.
# Recall: Obsidian-independent knowledge workspace and Graphiti evaluation plan

## Implemented candidate setup (2026-10-12)

This branch adds an optional local service, not a cloud platform. On Windows, use WSL Ubuntu with Python 3.12 or newer; the tested runtime is Ubuntu 26.04/Python 3.14.4. Native Windows embedded FalkorDB is unsupported. From the repository in WSL:

```sh
cd services/backend
uv sync --frozen --extra graphiti
```

Configure the service's environment through a local secret mechanism. Never put keys in committed files or paste them into Recall notes:

| Variable | Purpose |
|---|---|
| `RECALL_GRAPH_DB_PATH` | Absolute persistent WSL-local file path, e.g. `/home/you/.local/share/recall/knowledge.db` |
| `RECALL_GRAPH_TOKEN` | Random bearer secret of at least 32 bytes; same value in the native desktop/phone process |
| `RECALL_GRAPH_LLM_PROVIDER` | `anthropic` (the implemented extraction adapter) |
| `RECALL_GRAPH_ANTHROPIC_API_KEY` | Authorized Anthropic key, supplied outside Git |
| `RECALL_GRAPH_ANTHROPIC_MODEL` | Explicit model ID; real structured extraction verified with `claude-sonnet-5-5` |
| `RECALL_GRAPH_BUDGET_USD` | Explicit positive cumulative budget for this persisted service ledger |
| `RECALL_GRAPH_INPUT_USD_PER_MTOK` | Current input price for the chosen model, explicitly configured |
| `RECALL_GRAPH_OUTPUT_USD_PER_MTOK` | Current output price for the chosen model, explicitly configured |
| `RECALL_GRAPH_EMBED_CACHE` | Optional persistent model cache directory |
| `RECALL_GRAPH_PORT` | Optional port; default `8766`, loopback only |

Run `uv run recall-knowledge` in WSL. Start the native desktop with matching `RECALL_GRAPH_TOKEN` and `RECALL_GRAPH_URL=http://127.0.0.1:8766`. Provider keys belong only to the service process. The first local embedding use downloads the pinned public ONNX model; subsequent embedding inference uses local CPU. Source text is sent to the configured extraction provider only after separate vault purpose consent. Graphiti telemetry is disabled by the adapter.

In Recall Settings, review the named providers and enable Connected knowledge. Existing notes are excluded unless the separate existing-note option is selected. New notes remain ordinary authoritative Markdown/original records; processing runs after persistence. Disabling the feature fences retrieval and queues scope removal; an unavailable service cannot stop local notes or keyword Ask. Keep the service private on loopback; do not expose its token endpoint through Tailscale or a public reverse proxy.

The graph file and adjacent queue/budget SQLite files are private derived data. Keep them on a protected local filesystem. Stop the service cleanly before copying them. Back up the entire authoritative vault, including original attachments, history and `_meta` control records; graph rebuild must preserve human corrections and dismissals from those controls. Budget ledgers are operational cost records and must not be reset to evade an authorized cap. Graphiti is Apache-2.0, the falkordblite wrapper is New BSD, and the embedded FalkorDB engine is SSPLv1. The engine is operator-installed and is not redistributed in Recall's Windows installer.

The bounded candidate indexes at most 100 sources per operation and 32 KiB characters per source, and returns at most 50 relationships per view. Oversized inputs remain saved but cannot currently be indexed; these are explicit pilot limitations, not large-vault acceptance. Graph results use current eligible source revisions. Retained historical-revision graph queries abstain; inferred temporal dates on current evidence remain visible. Jev compatibility, fully local extraction and arbitrary configured provider compatibility are not established by the Anthropic adapter. See [the acceptance ledger](../.agent/GRAPHITI-01/ACCEPTANCE.md) for actual runtime evidence and remaining gates.

## Historical PR #26 proposal

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
