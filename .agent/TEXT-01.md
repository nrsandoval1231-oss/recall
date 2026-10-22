# TEXT-01 — Save a thought directly into the vault

Objective: R5. Owner authorized finishing Recall on 2026-10-09. Continue accepted REALIGN-01 (source/docs digest e68575350c82bb0803921f316eda3b2724e945377f985d9d9a33de5c1967b540), base HEAD fa6390be3e9539b68040379e7e81a3a7bc90491d, branch implement/owner-device-pairing. Preserve all current uncommitted work. Baseline manifest and patch in .agent/FINISH-02. No repeat Tribunal.

## Contract approved by Sol
`vault_capture_text(expectedVaultId, operationId, text)` -> existing VaultMemory. Exact submitted UTF-8 bytes saved immutably in Recall/Sources/<operationId>.txt before journaled memory promotion. Stable safe source_name note.txt; initial human note equals submitted text. Reject whitespace-only, NUL/invalid text and >existing note limit; do not trim original meaningful whitespace/newlines. Idempotent matching retries return authoritative current state, conflicting reused operation IDs fail. Text capture needs no photo, network or account. Text source verification checks UTF8/hash/limits and duplicate identity. v5 writer fence/renderer needed; v1-v4 render/event bytes remain valid and unchanged on read. Text has no photo reading; native photo dispatch rejects text before network. No fake image or generated AI summary.

## Ownership / READY nodes
- Native Luna: apps/desktop/src-tauri/src/local_vault.rs, local_vault_tests.rs, lib.rs, reading_storage.rs only if necessary for pre-network text rejection. Narrow new native helper module allowed if wired here. No UI/backend/docs changes.
- UI Luna: apps/desktop/src/platform/local-vault.ts and local-vault.test.ts; apps/desktop/src/local/LocalVaultApp.tsx, local-app.test.tsx, local.css; affected tests/local-vault fixture/journey/lifecycle/reading tests. No Rust/backend/doc changes. Optional captureText method for old test adapters; NativeLocalVault implements it. Use validated `.txt` source name to render original as inert text and omit PhotoReading for text. A simple note composer with Save note plus existing photo import, no required title/folder/tag. Preserve draft on failures, durable retry identity/payload, vault-switch and stale response guards; original evidence remains immutable after correction.
- Controller: .agent artifacts and canonical docs after implementation handoff.

## Invariants and exclusions
No source deletion, migration, scope widening of existing photo-only grants, provider calls, deployment, merge or push. Preserve uncertainty, correction history, original hashes, conflicts/retries, tombstones and external edit reconciliation. Text capture alone is not AI organization or Ask; next packet handles intelligence. Keep old photo behavior and accepted realignment.

## Acceptance / validation
Real filesystem tests: exact text original/hash, reopen/search, correction + original unchanged, direct Obsidian edit, remove/restore semantics, replay/operation collision including photo-vs-text, crash/recovery boundary, unsupported/oversized text, v1-v4 byte compatibility and v5 writer fence, text rejected by photo reading. UI tests: save/retry/draft reload/current vault isolation; original text rendered inert and no photo reading; old photo flow preserved. Browser synthetic journey save/reload/search/correct/original. Native fmt/test/check; root lint/typecheck/tests; renderer build; affected browser suite; diff and manifest. Freeze then controller gates and fresh independent Sol review. Builders handoff exact changed files, results, UTC times, known limits; no completion certification. Two repair attempts per failure then material reconsideration.

Direction CONTINUE after acceptance: grounded vault Ask/text organization, then voice/file adapters and phone transport; do not treat this packet as parent finish.
