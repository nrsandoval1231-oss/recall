> **CURRENT PRODUCT AUTHORITY — 2026-10-13:** [Native Memory Product Contract](NATIVE-MEMORY-PRODUCT-CONTRACT.md) supersedes Obsidian-as-required-application, Obsidian-only editing/opening, and previous dashboard/UI directions. Obsidian references below describe **historical pilot implementation or optional Markdown compatibility**, not the intended required user workflow. The user-owned local-first Markdown/source library stays; **no storage migration or PR #26 merge is authorized**. The approved photo-free ivory graph-field Camera/Speak/Write UI remains canonical. Preserve evidence and implementation status; do not assume new product behavior is already built.

# Recall build roadmap

## Immediate build sequence — RCL-INT-001

1. Canonical UI asset handoff verified: see the committed owner image and SHA-256 in UX-SPEC.
2. Build and test the real Jev → Claude → deterministic vault writer path for one messy meeting note, with corrections, source provenance and honest processing states.
3. Bind the approved warm-glass Memory Surface to actual vault data and open-in-Obsidian evidence.
4. Complete installed Windows and real iPhone/Tailscale acceptance. No feature expansion until the loop works.

See [Meeting to Memory](MEETING-TO-MEMORY.md). Keep PR #26 isolated.


## Active execution order (2026-10-11)

The RCL-001 through RCL-005 cloud-first milestones below are historical implementation/evidence tracks, not the current pilot's dependency order. Current gates: (1) installed Windows desktop vault save/reopen/correction; (2) real iPhone over restricted Tailscale photo and text capture, retrieval, and denied-peer checks; (3) consented Claude reading and grounded organization on representative handwriting; (4) vague question → cited answer → original evidence, with abstention and correction survival; (5) only then expand features. No new platform, cloud sync, or login UI before these gates. See [Canonical Foundation](CANONICAL-FOUNDATION.md).


> **HISTORICAL — 2026-10-09 PWA pilot note.** Superseded by the [2026-10-10 amendment](PILOT-CONTRACT.md). The current product center is the desktop Memory Surface, with organized notes in Obsidian and the phone as a capture/ask companion. No login or email-auth UX still applies. PR #16 remains the installable web companion and enrollment transport. The owner visual reference is [memory-surface-reference-2026-10-10.jpg](assets/memory-surface-reference-2026-10-10.jpg).


Version: 0.3 | Dependency-ordered, not delivery-date promises

**Historical path, 2026-10-09, implemented by PR #16 and superseded 2026-10-10.** That path was the Cloudflare-served, installable iPhone Home Screen PWA and Windows browser, with zero login UI and private provisioned device access. The web app has a manifest, service worker, and operator enrollment with synthetic negative tests; Add to Home Screen, a real Windows browser, and deployment acceptance remain open and are not the launch gate. The active product center is the desktop Memory Surface and a local Obsidian vault. See the [realignment audit](audits/2026-10-10-obsidian-desktop-realignment.md). Browser implementation/local verification recorded in V1-STATUS before 2026-10-10 is historical.

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

Add complete Markdown/JSON/original export, deletion/purge, controlled-cache tombstones, backup/restore, and optional managed Obsidian adapter with local-edit conflict protection.

The desktop vault slice keeps memory in the user's Obsidian folder and will not silently replace a local edit. Ask there is keyword search, not a live Claude answer. The phone companion is a local Tailscale page on that same computer; a real iPhone session, live reading, and installed-Windows proof remain open. See [DEVELOPMENT](DEVELOPMENT.md) and [ACCEPTANCE](ACCEPTANCE.md).

## RCL-005A — Canonical Memory Surface

Objective: replace conventional dashboard/page presentation with the approved Recall interaction language without changing canonical memory semantics.

Build the smallest real vertical slice first: sparse Home -> Ask reconstruction -> contextual glass boards -> memory focus -> original evidence forward -> entity refocus -> historical/current state -> correction -> Back restores context. Mobile adapts this to one primary board at a time.

The visual semantics are locked in [UX-SPEC](UX-SPEC.md): glass = understanding; physical artifacts = evidence; light = intelligence; space = relationships; depth = context; time = memory evolution. DOM/CSS-first; add GPU/WebGL only where measured value justifies it. Preserve keyboard/reduced-motion/accessibility and honest loading/error/uncertain states. Do not hard-code the synthetic Brooks Campus design fixture.

Exit: the vertical slice runs against real Recall contracts/data, remains source-grounded, passes interaction/accessibility regression coverage, and is visually recognizable as Recall rather than a generic notes/dashboard/chat application.

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
