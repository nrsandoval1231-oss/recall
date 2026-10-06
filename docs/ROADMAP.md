# Recall build roadmap

Version: 0.2 | Dependency-ordered, not delivery-date promises

## Foundation

Universal product thesis, trust model, contracts, repository boundaries, synthetic examples, and release criteria. Paul is the first design partner, not a domain boundary.

## RCL-001 — Trusted capture

Status: **implemented; automated evidence recorded; live iPhone → Windows acceptance OPEN** (see ACCEPTANCE "RCL-001 evidence").

Objective: any pilot user can save a photographed source safely and see the same original on desktop.

Build minimal mobile/desktop shells, authentication, workspace/device identity, ordered durable drafts, private uploads, server hash verification, idempotent finalization, recent captures, original viewing.

Exit: capture/retry/isolation tests plus real iPhone -> cloud -> installed Windows original viewing. AI is not required.

## RCL-002 — First useful recall

Objective: one source becomes one supported answer with original evidence.

Add durable worker, evaluated multimodal configuration, structured interpretation, source memory, validation, keyword retrieval, minimal Ask UI, citation checks, and bounded retry.

Acceptance includes vague-recall questions, not only exact keyword lookup.

## RCL-003 — Connected and temporal memory

Objective: repeated people/things/topics across unrelated domains connect without false certainty, and changing knowledge preserves history.

Add universal entities, aliases/mentions, relationships, claims, temporal validity/supersession, correction precedence, review, suggested/accepted actions, and measured pgvector hybrid retrieval.

Exit includes same-name ambiguity, historical-vs-latest queries, correction reprocessing, and cross-domain generalization.

## RCL-004 — Resilient desktop

Objective: normal desktop work remains useful through connectivity loss and reconnection.

Add SQLite cache, downloaded-original inventory, local text search, durable outbox, ordered sync feed, conflict UX, snapshots, revocation handling, and resumed synchronization.

## RCL-005 — Ownership and portability

Objective: Recall is not a data trap.

Add complete Markdown/JSON/original export, deletion/purge, controlled-cache tombstones, backup/restore, and optional managed Obsidian adapter with local-edit conflict protection.

Obsidian remains optional and must never be required for Recall correctness.

## RCL-006 — Private multi-domain pilot

Objective: prove Recall solves real memory retrieval, not merely Paul's specific note structure.

Run the private Paul pilot plus general-domain acceptance fixtures/tasks spanning people, places, education, travel, household/personal logistics, ideas, and professional work. Measure capture burden, vague-recall success, correction burden, trust, latency, and cost.

## V1.5 — Natural Capture

Voice, screenshots/share sheet, files, and links through the same source-memory contract. Add adapters individually with privacy and reliability acceptance.

## V2 — Connected Memory

Improve identity resolution, temporal reasoning, relationships, cross-source context, and correction learning. Expand entity projections without adding domain-specific core schemas.

## V3 — Active Memory

Surface accepted commitments, useful related memories, stale/conflicting information, and clearly labeled cross-memory patterns at appropriate moments.

No autonomous external action. Proactivity must be measured for usefulness and annoyance.

## V4 — Memory Everywhere

Claude/ChatGPT-style assistant adapters, browser, email/calendar and other authorized connectors, public API/MCP, additional platforms.

Each adapter uses the same authorization, provenance, and memory contracts.

## Explicit non-goals until justified

Teams, billing, generic agents, graph UI, ERP/CRM/CMMS replacement, separate vector/graph database, domain-specific schema forks, or broad autonomous workflows.

The product earns complexity by first proving faithful memory.
