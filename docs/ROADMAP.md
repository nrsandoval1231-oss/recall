# Recall build roadmap

Version: 0.1 | Dependency-ordered packets, not delivery-date promises

## Foundation — this repository

Deliver PRD, technical contracts, scope boundaries, folder ownership, synthetic examples, and release criteria. No runtime, deployment, model selection, or live acceptance is claimed.

## RCL-001 — Trusted capture

Objective: Paul can save a photographed page safely and see the same original on his desktop.

Build the minimum mobile and desktop shells, established authentication, workspace/device identity, ordered local drafts, private uploads, server hash verification, idempotent finalization, recent capture listing, and original viewing. Implement only the required capture/auth/storage tables.

Exit: A01–A05 plus applicable A12 isolation checks pass, including an actual iPhone upload and installed Windows view when distribution credentials/hardware are available. Explicitly separate live gates from mocks. The AI is not involved.

## RCL-002 — First useful memory

Objective: one real page becomes one supported answer with its original evidence.

Add a durable worker, evaluated single multimodal configuration, structured transcription, source memory, schema/semantic validation, keyword retrieval, minimal Ask UI, citation checks, and bounded retry. Select the provider on a development corpus; do not tune against holdout answers.

Exit: clear-page capture-to-answer works end to end; ambiguous/unreadable/unsupported cases fail safely; A06–A08, A11, A13–A14 pass for implemented scope. This is the first useful alpha, not full pilot acceptance.

## RCL-003 — Connected and correctable memory

Objective: multiple businesses and repeated entities remain useful without false certainty.

Add conservative entities/aliases/mentions, claims, revision history, correction precedence, review, and suggested/accepted actions. Expand keyword/entity retrieval and introduce pgvector only against an established evaluation baseline.

Exit: A09–A10 and the full live retrieval/critical-field evaluation pass; accepted actions are distinct from suggestions; corrections invalidate stale indexes/answers.

## RCL-004 — Resilient desktop

Objective: a normal desktop session remains useful through lost connectivity and safe reconnection.

Add desktop SQLite cache, downloaded-original inventory, local text search, durable outbox, commit-ordered feed, conflict UX, snapshots, revocation handling, and resumed synchronization. The installed desktop uses the same design language as mobile; no parallel product or new web app.

Exit: A15–A17 pass with restart and real network interruptions. No offline generative-Ask claim. Mobile offline scope remains durable capture drafts.

## RCL-005 — Ownership and recovery

Objective: Recall is not a data trap and does not damage the existing Obsidian vault.

Add managed Markdown export, local-edit conflicts, scoped native file access, complete Markdown/JSON/original export, delete/purge flow, controlled-cache tombstones, and database-plus-object backup/restore.

Exit: A18–A21 pass, including a real local edit and an isolated restore with hash verification. Explain offline/export deletion limits.

## RCL-006 — Private pilot acceptance

Objective: prove the app helps Paul in normal work.

Finish accessibility, actual signing/install/update route, consent/retention/spend configuration, operational alerts, held-out evaluation, and unassisted onboarding. Record all real-device/provider evidence and run the two-week pilot.

Exit: A22 and all remaining gates pass; owner accepts usability, evidence quality, operational burden, and cost. No public launch is implied.

## After V1, in order of demonstrated need

Voice capture and typed/voice retrieval extensions; broader documents; Claude/MCP; meeting briefs and consented connectors; then measured proactive pattern discovery. Each requires a bounded specification and actual platform capability checks.

Claude attachment access is a feasibility gate, not an assumed API: prove how the connector receives original image bytes, identifies the user/workspace, and handles approval before advertising "photograph in Claude and save".

Do not build teams, billing, a graph UI, generic agents, inventory, ERP, or a separate vector database before the pilot provides a concrete reason.

## Dependencies

Owner authorizes infrastructure/spending, private-data processing, and native distribution. Builder verifies current compatible versions, commits lockfiles when runnable projects exist, and records hardware/provider limitations. The absence of these resources is not permission to mark simulated acceptance as real.
