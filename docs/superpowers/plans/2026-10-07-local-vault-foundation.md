# Local vault foundation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship a usable native desktop loop that opens without sign-in, selects an Obsidian vault, imports an original photo, records/corrects a source-linked human note, reconciles direct Markdown edits and retrieves local evidence after restart.

**Architecture:** A narrow Rust native adapter owns scoped local filesystem commitment and validation; React uses explicit Tauri commands and never receives arbitrary filesystem privileges. Vault originals and append-only revisions are authoritative; an in-memory derived search view rebuilds from validated files, so losing a search cache cannot lose memory. Existing cloud domain/authorization code remains unchanged; this slice introduces no AI extraction or cloud semantic-model replacement.

**Tech Stack:** Existing Tauri/Rust, rfd native dialogs, serde/sha2/uuid, React/TypeScript/Vitest; avoid new services.

**Spec:** [RCL-005B design](../specs/2026-10-07-rcl-005b-no-signin-vault-design.md), local-only subset. Owner subsequently directed continued implementation without routine approval questions; QR association remains unresolved and excluded.

## Global Constraints

- No account/password/email-link sign-in, including first use. Local-only requires no remote account/configuration/network request.
- Synthetic fixtures only; no production auth, credentials, grants, real-data migration/deletion, purchases, merge or deployment.
- Immutable originals, source hashes, stable IDs, human attribution, expected revisions and retained prior versions; no silent overwrite of direct edits.
- Only native picker-selected scope; reject symlink/reparse/traversal and malformed metadata. No renderer-selected absolute path.
- Local keyword retrieval and user-authored notes must never be presented as OCR, AI interpretation or verified source facts.
- Preserve legacy cloud code and privacy contracts; local mode is the desktop default, legacy cloud mode only by deliberate opt-in.
- Required canonical Memory Surface direction: sparse home, focus/evidence/correction and reversible navigation, warm material styling and accessible native controls.

## Review Focus

1. Interrupted commits and corrupt history must not acknowledge success or silently discard a user's original.
2. An Obsidian edit racing a correction must preserve both draft and disk content and require explicit resolution.
3. Missing/changed original bytes must not produce a valid source citation or a false saved/searchable result.
4. Restart and vault switching must not show one vault's private records in another vault's surface.
5. No configured cloud variables or sessions on first launch must still allow real local setup; browser preview must truthfully lack native persistence.

## Task 1: Durable scoped native vault adapter

**Files:** create `apps/desktop/src-tauri/src/local_vault.rs`; modify `apps/desktop/src-tauri/src/lib.rs`; native tests colocated in local_vault module (split test file if substantial).

**Interfaces:** Tauri commands `vault_status() -> VaultStatus`, `vault_select() -> VaultStatus | null`, `vault_capture(operationId, note) -> VaultMemory | null` (native image picker), `vault_list(query) -> VaultMemory[]`, `vault_correct(memoryId, expectedRevision, operationId, note) -> VaultMemory`, `vault_source(memoryId) -> VaultSource`, `vault_history(memoryId) -> VaultRevision[]`. snake_case serialized fields: status `{root: string|null}`; memory `{id, revision, note, source_sha256, source_name, captured_at, updated_at, conflict: string|null}`; source `{bytes: number[], mime_type, sha256}`; revision `{revision, note, recorded_at, origin}`. Commands validate selected root from native state, never frontend paths. Native selected-root path may be saved in app-private settings for restart; revalidate before every operation.

- [ ] Write failing native tests for create/capture/reopen/hash equality, idempotent retry, changed-payload operation reuse rejection, direct edit ingestion and stale correction conflict, corrupt originals/history, missing note preservation, symlink/path escape, interrupted commit recovery and independent vault selection.
- [ ] Run native tests and record expected failures before implementation; install missing build tooling only in workspace if required.
- [ ] Implement versioned managed subtree under `Recall/` with immutable source bytes, complete append-only revision records, readable Markdown and recoverable journal/commit boundary. Existing unrelated files and legacy exporter collisions must be refused safely. Use stable UUID IDs; limited photo sizes and valid supported image signatures; original bytes never rewritten. Preserve human-note uncertainty without inference. Reconcile explicitly through list/refresh, not speculative watchers. History stores raw human note and origin; wall-clock timestamps do not resolve conflicts.
- [ ] Implement native picker wrappers and register commands; no arbitrary file access exposed. Atomic settings/journal writes, bounded reads and source verification. Search matches words against validated notes, returns only evidence whose originals/history verify; label problems rather than indexing corrupt content.
- [ ] Run `cargo test --lib` and `cargo check`; commit native task and write report with exact checks and limits.

## Task 2: No-sign-in local Memory Surface and real app routing

**Files:** create `apps/desktop/src/platform/local-vault.ts`, `apps/desktop/src/local/LocalVaultApp.tsx`, local tests and styles; modify `apps/desktop/src/main.tsx`, add an entry/router component as needed. Preserve App.tsx legacy cloud behavior.

**Interfaces:** consume Task 1 commands through typed `LocalVault` adapter with `status/select/capture/list/correct/source/history` promises; test injection uses the same interface, never a production fake mode.

- [ ] Write failing tests for first-use setup without cloud config or auth, cancellation, captured note search/evidence, correction/history, stale edit retaining user draft, restart selection, vault switching stale response exclusion, unavailable/corrupt original and honest browser limitation.
- [ ] Run desktop tests to observe failures; implement local mode as default before any cloud auth construction. Use an explicit legacy-cloud option with unchanged auth/config semantics.
- [ ] Implement sparse home, native vault select/create instruction, photo import with optional context/note, local keyword search, memory focus, original evidence, human correction and history. Display `Saved in vault · This device only`, no cloud AI/phone sync promise. Preserve draft on failure; operation IDs stable across retry. Revoke evidence object URLs on focus/session changes. Handle empty and filesystem failure states accessibly.
- [ ] Add production CSS reflecting warm glass/physical-evidence direction and reduced motion. Native preview unavailable message cannot masquerade as persisted vault data.
- [ ] Run root lint/typecheck/client tests and desktop build; commit and report.

## Task 3: Integrated verification, independent review and delivery

**Files:** add/update developer delivery docs and status/acceptance evidence; add rendered journey coverage if tooling permits, using synthetic originals only.

- [ ] Independently review Task 1 and Task 2 diffs for spec compliance and quality before integration completion; address important findings with focused regression tests.
- [ ] Validate the rendered no-sign-in local journey with native command-boundary fixtures and separately validate real Rust disk/restart behavior; clearly distinguish these from installed Windows/iPhone acceptance. Inspect screenshots if browser tooling permits.
- [ ] Record runnable `npm ci`, `npm run tauri -w @recall/desktop -- dev` instructions and local limitations. Mark local-only foundation separately from complete RCL-005B; pairing, migration and live AI remain unimplemented.
- [ ] Push new implementation branch and open draft PR against `docs/obsidian-memory-spine`; monitor exact-head CI, repair scoped failures, perform final independent review and return precise SHA/evidence/gates. Never merge or deploy.

## Self-review

Covered local-only spec sections 1–4, desktop bootstrap, originals/history/commit, direct edits/rebuild, offline UX and scoped acceptance. Deliberately excluded: phone app capture changes, QR/enrollment/relay, keys, migration and full cloud AI/domain integration. Native Rust stores human annotation/provenance, not an alternate AI/semantic inference service. Source bytes plus human notes are the smallest honest local retrieval loop; handwritten image content is not searchable without a user note yet. These limits must remain visible in UI and delivery docs.
