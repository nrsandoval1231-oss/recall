# Monolith build roadmap

## Active continuation — VOICE-01 native implementation

Update 2026-10-22: a native/UI/Ask-wire VOICE-01 candidate exists (Record/Stop, local transcription, correction, cited playback) with synthetic and fixture evidence only; it is not accepted. Audio automatic organization, installed Windows/microphone proof and independent review remain open. See [CURRENT_STATE](../.agent/CURRENT_STATE.md).

Ask and automatic future text/photo organization have bounded independent acceptance. Current evidence-backed links within the vault also have bounded acceptance. Anchored retained historical Ask also has bounded independent acceptance. UTF-8 .txt/.md import has bounded independent acceptance at 2aa36435. The active frontier is native Record/Stop implementation after pinned offline speech and packaging feasibility passed on the tested host. [CONTEXT-01](../.agent/CONTEXT-01.md) adds bounded excerpts, a fresh purpose-policy opt-in and a v7 journaled link projection. It preserves source-first capture and requires no per-note approval. The accepted [HISTORY-01 packet](../.agent/HISTORY-01.md) handles anchored historical questions and correction counterpoints. [TEXT-FILE-01](../.agent/TEXT-FILE-01.md) is accepted; proceed with [VOICE-01](../.agent/VOICE-01.md), then remaining input/device work. Live provider, installed-device and held-out quality gates remain separate.

## Accepted bounded Ask — INTELLIGENCE-01

Local photo organization and typed/pasted text capture have bounded independent acceptance. Grounded vault Ask has bounded independent acceptance: native current evidence -> separately authorized inference -> cited answer -> original. See `.agent/INTELLIGENCE-01/COMPLETION.json` for the exact acceptance state. Automatic text/photo organization with remembered purpose consent is also accepted; grounded context links are accepted, with anchored historical retrieval accepted before remaining input/device adapters. A successful Ask packet does not finish the product.

Version: 0.6 | Updated 2026-10-09 | Dependency-ordered, not delivery-date promises

## Product delivery sequence

The product target accepts unstructured notes, photos, voice and files without requiring user filing or taxonomy knowledge, organizes them into useful Obsidian memory, and supports natural-language source-backed recall. Delivery order is photo organization first, text capture next, grounded natural-language Ask next, then voice and broader file adapters. This sequence is not a deferral of text/voice/files from the product; it stages shared-source-contract implementation. Screenshots/share sheet, email/calendar, proactive actions and assistant connectors remain later scope. The renderer has bounded local acceptance recorded in `.agent/REALIGN-01/COMPLETION.json`; see [DOCUMENTATION-MAP](DOCUMENTATION-MAP.md) for current/historical document boundaries.

The existing pilot uses the Cloudflare browser adapter for iPhone photo capture and Windows retrieval; native clients remain preserved. [V1-STATUS](V1-STATUS.md) records deployment of the older email-authenticated pilot. Deployment of the newer canonical Memory Surface is not established by its [local/fixture evidence](implementation/memory-surface/README.md), and real signed-in cross-device acceptance remains open. The authorized local-only RCL-005B foundation/lifecycle and selected-photo reading have bounded implementation evidence; v4 automatic photo organization and simplified UI have bounded local acceptance. Full product/platform acceptance remains open. QR pairing remains proposed and unimplemented.

## Accepted local text checkpoint — TEXT-01

Typed/pasted text capture is an independently accepted local v5 implementation using the existing vault journal and immutable UTF-8 original. It requires no photo or remote account. Exact evidence is in `.agent/FINISH-02/TEXT-COMPLETION.json`. Grounded vault Ask and automatic future text/photo organization also have bounded acceptance; current context also has bounded acceptance; anchored historical retrieval has bounded acceptance, while broader/vague recall quality and remaining input adapters retain separate acceptance requirements.

## Required architecture decision

Obsidian is the required memory spine. Legacy cloud database-authoritative capture/retrieval and one-way Markdown export are the pre-migration baseline; new local desktop records are vault-authoritative. RCL-005B below is a mandatory dependency for claiming the architecture fulfills this vision; completed earlier packets do not prove vault integration.

## Historical rollout reference — earlier stages

RCL-001 through RCL-005A record earlier cloud, desktop, ownership and Memory Surface candidates. Their dated evidence and limits remain useful, but this history is not the active product frontier or proof of current full-spine acceptance.

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

Historical cloud-pilot status: native persistence/sync/offline implemented; CI verified, installed Windows acceptance OPEN. This is not the current local-vault acceptance state.

Objective: normal desktop work remains useful through connectivity loss and reconnection.

Add SQLite cache, downloaded-original inventory, local text search, durable outbox, ordered sync feed, conflict UX, snapshots, revocation handling, and resumed synchronization.

## RCL-005 — Ownership and portability

Status: export/delete/backup/managed Markdown implemented; partial processed-source erasure safely restricted.

Objective: Monolith is not a data trap.

Add complete Markdown/JSON/original export, deletion/purge, controlled-cache tombstones, backup/restore, and the existing managed Markdown exporter with local-edit conflict protection.

The existing exporter is insufficient for the required Obsidian spine. Its conflict protections must be preserved during migration.

## RCL-005A — Canonical Memory Surface

Objective: replace conventional dashboard/page presentation with the approved Monolith interaction language without changing canonical memory semantics.

Build the smallest real vertical slice first: sparse Home -> Ask reconstruction -> contextual glass boards -> memory focus -> original evidence forward -> entity refocus -> historical/current state -> correction -> Back restores context. Mobile adapts this to one primary board at a time.

The visual semantics are locked in [UX-SPEC](UX-SPEC.md): glass = understanding; physical artifacts = evidence; light = intelligence; space = relationships; depth = context; time = memory evolution. DOM/CSS-first; add GPU/WebGL only where measured value justifies it. Preserve keyboard/reduced-motion/accessibility and honest loading/error/uncertain states. Do not hard-code the synthetic Brooks Campus design fixture.

Exit: the vertical slice runs against real Monolith contracts/data, remains source-grounded, passes interaction/accessibility regression coverage, and is visually recognizable as Monolith rather than a generic notes/dashboard/chat application.

## RCL-005B — Required Obsidian memory spine

Status: **bounded local desktop foundation/lifecycle and selected-photo reading implemented candidates; full RCL-005B and installed-device acceptance OPEN**.

[Review the RCL-005B design](superpowers/specs/2026-10-07-rcl-005b-no-signin-vault-design.md). Product requirement: no account/password/email-link sign-in, including first use. Private local-only use needs no remote account. Cross-device private use needs secure owner-approved device association; PAIR-01 implements a manual inference-only invitation, while one-time QR pairing remains proposed. Subsequent owner direction authorized the [local-only plan](superpowers/plans/2026-10-07-local-vault-foundation.md), implemented with independent reviews and [synthetic evidence](implementation/local-vault/README.md). The separately authorized [lifecycle plan](superpowers/plans/2026-10-08-local-vault-lifecycle.md) now adds flat renames, missing-note restore, retained tombstones and annotation-search rebuild, with [bounded evidence](implementation/local-vault-lifecycle/README.md). Phone transport, secure purge/undelete, semantic reconstruction and migration remain excluded. Historical email-auth acceptance is not the new target.

Make an Obsidian vault the user-owned durable memory spine while retaining Monolith's Memory Surface and universal memory model. Specify the versioned vault schema, workspace association, authorized browser/mobile bridge, direct-edit reconciliation and migration/rollback before changing storage authority. Keep PostgreSQL/jobs/authorization and SQLite where useful as supporting services/projections, not exclusive owners of semantic memory.

Build the smallest real round trip: capture -> preserved vault original and memory -> edit in Obsidian -> validated Monolith understanding -> grounded Ask -> correction/history retained in vault. Do not require manual folders/tags, a community plugin, paid Obsidian Sync, or account sign-in. Stage local vault correctness before optional device pairing and transport; preserve phone drafts when the desktop is off and label relay receipt separately from vault commitment.

Exit: crash-safe/idempotent vault writes, direct-edit conflicts, concurrent devices, immutable sources/hash checks, temporal/correction/tombstone preservation, revoked access and cross-workspace isolation, and reconstruction of memory/search projections from vault data. Existing users' memory must migrate with verified parity and a safe rollback; legacy Markdown export alone does not pass.

The selected-photo Claude path adds full-page vision, explicit one-photo cloud consent, unreviewed original comparison, separate human transcription corrections, effective reading keyword search and retained provenance/history. PAIR-01 provides owner-approved, inference-only device association; it does not authorize a photo request by itself. The v4 renderer, current-vault Ask and remembered future text/photo organization now have separate bounded acceptance records. Current-context links have bounded acceptance; full semantic reconstruction, phone synchronization and RCL-005B remain open. See [reading evidence and remaining gates](implementation/claude-vault-reading/README.md); legacy email-auth deployment and PR11/PR12 evidence remain historical.

## RCL-006 — Private multi-domain pilot

Objective: prove Monolith solves real memory retrieval, not merely Paul's specific note structure.

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
