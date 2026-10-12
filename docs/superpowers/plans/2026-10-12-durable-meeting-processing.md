# Durable Meeting Processing Implementation Plan

> For agentic workers: implement inline with superpowers:executing-plans and independently review each PR. The user has authorized execution without further plan approval.

**Goal:** Execute the real Jev parser through a durable, consented, budgeted native operation whose original evidence and result survive restart.
**Architecture:** The selected native Vault supplies evidence and revision authority. A bounded job record under Recall/_meta tracks parser state; a native process lock protects job replay and budget reservation. Model calls occur only after originals and a conservative reservation are flushed. Uncertain attempts are never automatically resent.
**Tech stack:** Existing Rust, serde/serde_json, SHA-256, ureq, UUID and native vault primitives; no new dependencies.
**Spec:** docs/CANONICAL-FOUNDATION.md and PR #27 docs/MEETING-TO-MEMORY.md, as authorized by RCL-INT-001.

## Global constraints

Keep PR #26 isolated. Preserve originals before provider calls. No PostgreSQL, login or hosted service. Model output cannot choose paths or bypass validation. Preserve uncertainty and human corrections. Missing configuration leaves saved captures pending. Synthetic provider responses are validation fixtures, never live integration proof.

## Review focus

- Crash after reservation but before response: retain spend and block resend after restart.
- Same operation ID with different memory/revision: reject rather than return another source.
- Externally edited or human-corrected notes: do not send stale context or publish over corrections.
- Corrupted/symlinked job metadata: reject before provider calls.
- Text-only original evidence: preserve exact bytes/hash separately from derived notes.

## Task 1 — durable source snapshot

Files: local_vault.rs and native tests.
Produces: processing_snapshot(memory_id, expected_revision) -> ProcessingSnapshot, containing current VaultMemory, verified VaultSource and human-correction flag. Legacy text evidence comes from the immutable first capture record and is preserved as Recall/Sources/<UUID>.txt.
- [ ] Write original-byte/restart, source-tamper, stale revision and human-correction regressions; observe failures.
- [ ] Implement source snapshot under the existing writer lock; retain old capture/history format.
- [ ] Run the full native-core harness, inspect results, commit.

## Task 2 — parser job and budget

Files: processing.rs, jev.rs validation, librarian.rs currency/date helper visibility, lib.rs commands.
Consumes: processing_snapshot and the documented jev::parse API.
Produces: parse_note(vault, config, operation, memory, revision, consent, transport) -> Job; status(vault, operation) -> Job. Stored Job is strict, source-bound and contains original/transcription hashes, model, reservation and validated parsed output.
- [ ] Write replay/restart, uncertain delivery, budget limit, missing config/consent, malformed output, metadata tamper and stale-source regressions; observe failures.
- [ ] Implement safe atomic job records, exclusive native job locking and conservative 100,000-input-token reservations. Validate results before persisting them. Do not expose secrets through status.
- [ ] Bind native selected-vault commands and actual ureq transport; preserve unavailable-photo-transcription state honestly.
- [ ] Run full native-core tests and remote exact-head CI; obtain independent review; update ACCEPTANCE/DEVELOPMENT and open focused PR.

Ruling: this slice persists parser output but does not publish organization. Photo inputs remain pending transcription until the existing Claude reader is connected in the next dependent slice. This avoids pretending Jev accepts images.
