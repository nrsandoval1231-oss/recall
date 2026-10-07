# Recall build roadmap

Version: 0.5 | Dependency-ordered, not delivery-date promises

The existing pilot uses the Cloudflare browser adapter for iPhone photo capture and Windows retrieval; native clients remain preserved. [V1-STATUS](V1-STATUS.md) records deployment of the older email-authenticated pilot. Deployment of the newer canonical Memory Surface is not established by its [local/fixture evidence](implementation/memory-surface/README.md), and real signed-in cross-device acceptance remains open. The next work is review of the proposed local-first RCL-005B design below, not further email-sign-in rollout; QR pairing and written-design approval remain pending.

## Required architecture decision

Obsidian is the required memory spine. Existing database-authoritative capture/retrieval and one-way Markdown export are the pre-migration baseline. RCL-005B below is a mandatory dependency for claiming the architecture fulfills this vision; completed earlier packets do not prove vault integration.

## Foundation

Universal product thesis, trust model, contracts, repository boundaries, synthetic examples, and release criteria. Paul is the first design partner, not a domain boundary.

## RCL-001 — Trusted capture

Status: **implemented; automated evidence recorded; live iPhone → Windows acceptance OPEN** (see ACCEPTANCE "RCL-001 evidence").

Objective: any pilot user can save a photographed source safely and see the same original on desktop.

Build minimal mobile/desktop shells, authentication, workspace/device identity, ordered durable drafts, private uploads, server hash verification, idempotent finalization, recent captures, original viewing.

Exit: capture/retry/isolation tests plus real iPhone -> cloud -> installed Windows original viewing. AI is not required.

## RCL-002 — First useful recall

Status: **implemented with synthetic/fake-provider evidence; live-provider quality on real handwriting OPEN** (see ACCEPTANCE "RCL-002 evidence").

Objective: one source becomes one supported answer with original evidence.

Add durable worker, evaluated multimodal configuration, structured interpretation, source memory, validation, keyword retrieval, minimal Ask UI, citation checks, and bounded retry.

Acceptance includes vague-recall questions, not only exact keyword lookup.

## RCL-003 — Connected and temporal memory

Status: implemented with synthetic automated evidence; live quality OPEN. See [V1-STATUS](V1-STATUS.md).

Objective: repeated people/things/topics across unrelated domains connect without false certainty, and changing knowledge preserves history.

Add universal entities, aliases/mentions, relationships, claims, temporal validity/supersession, correction precedence, review, suggested/accepted actions, and measured pgvector hybrid retrieval.

Exit includes same-name ambiguity, historical-vs-latest queries, correction reprocessing, and cross-domain generalization.

## RCL-004 — Resilient desktop

Status: native persistence/sync/offline implemented; CI verified, installed Windows acceptance OPEN.

Objective: normal desktop work remains useful through connectivity loss and reconnection.

Add SQLite cache, downloaded-original inventory, local text search, durable outbox, ordered sync feed, conflict UX, snapshots, revocation handling, and resumed synchronization.

## RCL-005 — Ownership and portability

Status: export/delete/backup/managed Markdown implemented; partial processed-source erasure safely restricted.

Objective: Recall is not a data trap.

Add complete Markdown/JSON/original export, deletion/purge, controlled-cache tombstones, backup/restore, and the existing managed Markdown exporter with local-edit conflict protection.

The existing exporter is insufficient for the required Obsidian spine. Its conflict protections must be preserved during migration.

## RCL-005A — Canonical Memory Surface

Objective: replace conventional dashboard/page presentation with the approved Recall interaction language without changing canonical memory semantics.

Build the smallest real vertical slice first: sparse Home -> Ask reconstruction -> contextual glass boards -> memory focus -> original evidence forward -> entity refocus -> historical/current state -> correction -> Back restores context. Mobile adapts this to one primary board at a time.

The visual semantics are locked in [UX-SPEC](UX-SPEC.md): glass = understanding; physical artifacts = evidence; light = intelligence; space = relationships; depth = context; time = memory evolution. DOM/CSS-first; add GPU/WebGL only where measured value justifies it. Preserve keyboard/reduced-motion/accessibility and honest loading/error/uncertain states. Do not hard-code the synthetic Brooks Campus design fixture.

Exit: the vertical slice runs against real Recall contracts/data, remains source-grounded, passes interaction/accessibility regression coverage, and is visually recognizable as Recall rather than a generic notes/dashboard/chat application.

## RCL-005B — Required Obsidian memory spine

Status: **written design proposed; awaiting approval; not implemented**.

[Review the RCL-005B design](superpowers/specs/2026-10-07-rcl-005b-no-signin-vault-design.md). Product requirement: no account/password/email-link sign-in, including first use. Private local-only use needs no remote account. Cross-device private use still needs secure owner-approved device association; one-time QR pairing is an unresolved proposal. Approve the written design before an implementation plan, then review that plan and select execution before product code. Historical email-auth acceptance is not the new target.

Make an Obsidian vault the user-owned durable memory spine while retaining Recall's Memory Surface and universal memory model. Specify the versioned vault schema, workspace association, authorized browser/mobile bridge, direct-edit reconciliation and migration/rollback before changing storage authority. Keep PostgreSQL/jobs/authorization and SQLite where useful as supporting services/projections, not exclusive owners of semantic memory.

Build the smallest real round trip: capture -> preserved vault original and memory -> edit in Obsidian -> validated Recall understanding -> grounded Ask -> correction/history retained in vault. Do not require manual folders/tags, a community plugin, paid Obsidian Sync, or account sign-in. Stage local vault correctness before optional device pairing and transport; preserve phone drafts when the desktop is off and label relay receipt separately from vault commitment.

Exit: crash-safe/idempotent vault writes, direct-edit conflicts, concurrent devices, immutable sources/hash checks, temporal/correction/tombstone preservation, revoked access and cross-workspace isolation, and reconstruction of memory/search projections from vault data. Existing users' memory must migrate with verified parity and a safe rollback; legacy Markdown export alone does not pass.

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

Teams, billing, generic agents, dedicated node-link graph UI, ERP/CRM/CMMS replacement, separate vector/graph database, domain-specific schema forks, or broad autonomous workflows. The approved Memory Surface may spatially render relationships without introducing a graph product or graph database.

The product earns complexity by first proving faithful memory.
