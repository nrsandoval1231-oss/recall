# Local vault lifecycle implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task, with independent review and a final adversarial whole-branch review.

**Goal:** Keep local memories correct when their Markdown is renamed, missing, explicitly removed, or interrupted during a write.

**Architecture:** Extend the existing native journal/history and per-vault lock. Stable-ID inventory resolves same-folder renames; explicit restore and retained tombstone events resolve missing/deleted memory without erasing files. Search continues to rebuild deterministically from validated vault records, with no new database or service.

**Tech stack:** Existing Rust/Tauri, React/TypeScript and Playwright; no new runtime dependency.

**Spec:** [RCL-005B design](../specs/2026-10-07-rcl-005b-no-signin-vault-design.md), particularly direct-edit, tombstone and reconstruction requirements. The owner's October 8 continuation explicitly authorizes this plan followed by implementation and a separate stacked draft PR, without another routine stage approval. Full semantic reconstruction, phone transport and AI remain outside this local annotation slice.

**Baseline:** PR11 `650e9eae6878b46673d81411789d02e9388077a0`; branch `implement/local-vault-lifecycle`, targeting `implement/local-vault-foundation`. Preserve PR11 and its installer artifact `11521925107` (run `37708945255`; ZIP file reference `file_0000000099f081f599ed9c8fa1be3aa9`).

## Global constraints

- No account/password/email-link sign-in, including first use. Every selected-vault command retains ephemeral `expectedVaultId` authorization; paths never come from renderer authority.
- Synthetic fixture vaults only. Preserve original bytes, histories, journals and user-created/edited files. Removal is a logical Recall tombstone, not physical erasure; no automatic deletion or resurrection.
- Keep expected revisions and idempotency. A tombstone dominates stale capture/correction receipts and replay; no implicit undelete.
- No merge, deployment, production configuration, credentials, grants, pairing or provider spending. QR remains unanswered. Authorized Windows desktop is offline; do not use another connected desktop or claim installed acceptance.
- No unmeasured claim of actual disk exhaustion, power-loss resilience or installed native integration from injected faults/browser fixtures.

## Design decisions and self-review

1. Inventory only direct `Recall/Memories/*.md` children, bounded and safe-path checked. A unique unchanged stable identity may have a new basename; corrections retain that basename. Keyword terms may match the validated note basename as well as annotation/original-photo filename, retaining per-term AND and eligibility checks. Duplicate IDs and nested moves stay explicit conflicts. This bounds scope and preserves existing relative source links.
2. Preserve exact v1 history bytes/validation. New lifecycle records require versioned decoding and a durable manifest writer-version fence before any v2 operation; old binaries must fail closed. Hash stored predecessor bytes, not newly extended reserialization. Interrupted format transition must leave the vault recognizable, and v1 fixtures must reopen and retain their original hashes.
3. Missing Markdown remains a decision. Restore explicitly republishes the latest validated note only if still missing and no duplicate/changed file exists. Remove explicitly appends a tombstone, retains files, and excludes the record from active search/evidence. Deleted records remain inspectable in a separate removed-items view with history. No undelete or secure purge in this slice.
4. Recovery orders pending events by memory/revision, validates parent and current head, and reports forks rather than using UUID order as a winner. A stale operation cannot publish over a tombstone or overwrite a renamed/edited file.
5. The existing list operation builds the keyword projection from canonical files; expose an explicit rebuild action using that boundary and keep the previous rendered list if rebuilding fails. Repeated reopen/rebuild produces the same eligible records and ordering after reconciliation. Corrupt/tombstoned records never become evidence; this is annotation projection recovery, not full semantic reconstruction.

Self-review: all new behavior is covered below; storage/renderer names must match Task1's committed contract before Task2 starts. No competing index, network authority or physical deletion is introduced. Same-folder rename and retained removal are deliberate bounded semantics. Downgrade after v2 writes is unsupported; preserve original v1 fixtures and use a separate synthetic copy to verify compatibility, never migrate real data.

## Review focus

- Rename or duplicate introduced after confirmation/journaling: preserve both variants and refuse stale publication (Task1).
- Committed tombstone with stale capture/correction replay or deleted completion marker: no reactivation or saved-state receipt (Task1).
- Missing note restored by an external editor while owner confirms restore/remove: compare revision and fresh inventory, never overwrite (Task1/2).
- Partial metadata, flush/rename failure, ENOSPC or read-only error: no success acknowledgment; old committed state or explicit retained recovery diagnostic survives restart (Task1).
- Vault switch, late response or failed destructive confirmation: no action applies to another selection and drafts/review context stay honest (Task2).

## Task1: Native lifecycle and recoverable projection

**Files:** native `local_vault.rs`, `local_vault_tests.rs`, `lib.rs`; split focused lifecycle/format helpers only where it improves clarity.

**Contract:** extend renderer memory DTO with `state: active|missing|deleted|conflict` and optional `note_path` (display-only relative basename); keep `conflict` diagnostics. Revision DTO adds `kind`. Existing list returns active/missing/conflict records by default; add `includeDeleted: boolean` default false to command/adapter. New `vault_restore_note(expectedVaultId,memoryId,expectedRevision,operationId)` and `vault_remove(expectedVaultId,memoryId,expectedRevision,operationId,expectedState)` return the current memory DTO. `expectedState` is `active|missing` and is part of removal idempotency, so a missing-note confirmation cannot remove a file that reappeared before the click. Every request uses native-selected scope and current inventory. Existing capture/correct retries validate historical payload but return current authoritative state; no stale success after deletion. Write the exact native/TS-facing contract in the task report before UI work.

- [ ] Add failing synthetic disk tests for unique rename + edit/correction/reopen, duplicate/header/path rejection, missing restore and stale restore, retained removal and idempotency, stale receipt/replay/fork protection, v1 byte/hash compatibility and interrupted version fence, deterministic reconstruction from a copied complete vault.
- [ ] Add a test-only scoped fault seam at real write/flush/publication boundaries; demonstrate interrupted capture/correct/restore/remove and injected ENOSPC/read-only errors without acknowledging partial work. Preserve healthy neighbors and user bytes. Do not add environment-controlled production fault modes.
- [ ] Implement versioned records, safe inventory/lifecycle commands, ordered recovery and retained tombstones using existing primitives. Original/hash/history validation remains mandatory; distinguish history verification from source eligibility so removed records can be diagnosed honestly.
- [ ] Run focused RED then GREEN, full native tests/check/fmt and commit. Document every remaining recovery limitation. Independent task review and fixes precede Task2.

## Task2: Actual desktop lifecycle controls

**Files:** `platform/local-vault.ts` and tests; `local/LocalVaultApp.tsx`, local tests/CSS as needed.

- [ ] Add failing component/adapter tests for missing-note restore, explicit removal confirmation/cancel, retained deleted history, renamed filename display, rebuild success/failure keeping previous results, and vault-switch/stale-response isolation.
- [ ] Wire Task1's exact commands. Explain removal retains original/note/history and currently has no in-app undo. Require explicit confirmation and disable actions on ambiguous/corrupt records. Show removed items through an explicit view, never as active search results. A replayed import returning deleted state must not say it newly saved an active memory.
- [ ] Use the existing list boundary for a clearly labeled rebuild of local search; no empty success on errors or claim of semantic/AI reconstruction. Retain correction/capture draft behavior.
- [ ] Run affected tests, root lint/typecheck/client suite and desktop build; commit. Independent review and fixes precede Task3.

## Task3: Integrated adversarial evidence and delivery

**Files:** `tests/local-vault/*`, canonical status/architecture/acceptance/development docs and implementation evidence.

- [ ] Extend synthetic native-boundary browser journeys for missing/restore, confirmation/cancel/removal/history/replay and rebuild; retain no-sign-in, axe/reduced-motion and ordinary browser limitations. Distinguish these from native real-file tests.
- [ ] Update docs to precise current vs future capabilities and preserve PR11's successful CI/artifact evidence; include remaining nested moves, secure purge/undelete, full semantic rebuild and device limitations.
- [ ] Run affected browser/client/native checks, self-review links/formatting, commit; get independent delivery review and whole-branch adversarial review, repairing findings with regression tests.
- [ ] Publish a separate stacked draft PR and monitor exact-head full CI plus installer upload. No merge/deploy. Report exact SHA, test counts, artifact and next unblocked requirement; retain the prior installer reference for authorized-device acceptance.
