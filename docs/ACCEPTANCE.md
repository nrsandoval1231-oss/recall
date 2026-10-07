# Recall acceptance and evaluation

Version: 0.3 | Automated evidence and OPEN live gates

## Evidence standard

Record exact commit, environment/device, provider/configuration, dataset version, procedure, results, skips, and limitations. Synthetic tests, live-provider tests, installed-client tests, and private-user acceptance are distinct evidence.

## Required Obsidian-spine acceptance — OPEN

The target requires an Obsidian vault as durable user-owned memory, not one-way export. Existing V1 evidence below is pre-migration and does not satisfy this gate.

- Capture durably commits the original and supported memory to the workspace's vault; unavailable vaults retain pending originals and truthful status.
- Edit a memory directly in Obsidian, reconcile it into Recall, and retrieve the accepted understanding with original evidence. Concurrent edits preserve both versions for explicit resolution.
- Recall corrections, uncertainty, temporal revisions and source hashes survive restart and vault synchronization; reprocessing does not undo accepted human changes.
- Rebuild semantic/search projections from vault notes, attachments and versioned metadata/history without relying on the old database as the exclusive memory store. Preserve IDs, citations and tombstones.
- Exercise interrupted writes, retries, disk-full/read-only roots, renames, cross-device edits, deleted memory and revoked/cross-workspace access. Vault text must not modify service permissions.
- Demonstrate migration parity and rollback for existing memory. No paid sync subscription, community plugin or manual taxonomy is necessary for the memory loop.

## Core release scenarios

1. Authenticated ordered photo capture preserves exact originals across phone/cloud/desktop.
2. Local save survives force-close before upload.
3. Network retries are idempotent and do not duplicate captures or processing.
4. Corrupt/oversized/unsupported media fails recoverably.
5. Offline/permission-denied capture preserves recoverable work.
6. Clear source yields supported interpretation and answer with correct original.
7. Ambiguous number/unit/name remains unresolved or uncertain.
8. Relative dates do not acquire fabricated exact dates.
9. Same-name people/things do not unsafe-auto-merge.
10. User correction survives reprocessing and stale indexes are excluded.
11. Unsupported/conflicting question abstains or reports conflict.
12. Cross-workspace source/search/mutation access is denied.
13. Malicious instructions inside a source remain inert content.
14. Worker crash/expired lease cannot commit stale results.
15. Concurrent device edits surface conflicts instead of silently losing changes.
16. Change-feed ordering, replay, cursor expiry, and snapshot-to-feed continuity produce no skipped or duplicate effective state.
17. Offline desktop clearly distinguishes cached search from fresh synthesis.
18. Export preserves local edits/conflicts and cannot escape approved paths.
19. Export crash/restart, read-only, and disk-full recovery preserve managed files and manifest consistency.
20. Delete/reconnect/retry cannot resurrect deleted evidence.
21. Independent export/restore verifies database plus originals.
22. Historical query returns prior state while “latest” returns current eligible state.
23. Vague associative query can recover the right memory when evidence supports it.
24. Real-user first run succeeds without builder assistance.

## Evaluation corpus

Use two private sets.

### Design-partner stress set
Consented real Paul material representing difficult handwriting, technical values, people, organizations, equipment, projects, arrows, cross-outs, margins, multipage notes, and ambiguity.

### Universal-memory set
Consented/private or carefully constructed representative cases across domains such as:
- education/lecture notes;
- sales/relationship notes;
- household/personal logistics;
- travel/place recommendations;
- contractor/measurement notes;
- ideas/voice-like text;
- executive/project decisions;
- receipts/screenshots/files when those adapters exist.

The held-out set must contain vague associative questions, exact questions, historical/latest contrasts, ambiguity, contradictions, and deliberately unsupported prompts.

Do not tune prompts/models against holdout answers.

## Metrics

- capture success and organizational effort;
- transcription/critical-field accuracy where a gold reading exists;
- uncertainty/abstention quality where it does not;
- entity-resolution precision and unsafe-merge count;
- temporal latest-vs-historical correctness;
- evidence recall@k and correct-source rank;
- supported-answer rate and unsupported-claim rate;
- vague-recall recovery success;
- source-opening success;
- corrections/review burden;
- latency, failures, retry amplification, and cost.

## Proposed pass criteria

At least 90% of answerable held-out recall questions return a supported answer with the correct original source. Deliberately unsupported questions abstain or clearly report insufficient evidence.

Any observed fabricated confirmation, material silent number/unit alteration, unsafe identity merge, temporal overwrite that destroys required history, or cross-workspace leak blocks release until fixed and regressed.

Performance targets remain requirements to measure: local Save feedback p95 under 1 second; clear 3-page processing p95 within 60 seconds after upload; online Ask p95 under 10 seconds; cached desktop keyword search p95 under 500 ms on the documented reference setup.

## Pilot interpretation

Paul's two-week pilot proves usefulness for one demanding user, not universal product-market fit. Record what he actually captures, asks, corrects, and reuses.

Universal readiness requires separate evidence that the memory model and retrieval behavior work across multiple domains without adding domain-specific core schema or prompt hacks.

The goal is not high note count. The goal is trustworthy recovery from imperfect human recollection.

## RCL-001 evidence (Trusted Capture)

Candidate: branch `rcl-001-trusted-capture` (exact SHA in the PR description). Environment: Linux x86_64 sandbox, Python 3.13, Node 22, PostgreSQL 16 (throwaway local cluster per test run), Rust stable. **Everything below marked PASS is synthetic/automated evidence on that environment; none of it is installed-client, signed-build, live-provider, or private-user acceptance.**

### Automated results

| Suite | Result |
| --- | --- |
| Backend `pytest` (real PostgreSQL 16, real RLS, local object store) | 88 passed, 0 failed, 0 skipped |
| Backend `ruff check`, `ruff format --check`, `mypy --strict` | clean |
| `packages/sync` vitest (durable save, crash sweep, recovery, upload engine) | 29 passed |
| `packages/api-client` vitest | 12 passed |
| `packages/design-tokens` vitest (WCAG AA contrast, status vocabulary) | 3 passed |
| `apps/mobile` vitest (view model, config) | 5 passed |
| `apps/desktop` vitest + jsdom (empty state, statuses, hash verification, keyboard paging) | 8 passed |
| Desktop Rust `cargo test --lib` (credential-key validation) / `cargo check` | 3 passed / clean (Linux only) |
| `eslint .`, `tsc` for every workspace and `tests/e2e` | clean |
| `vite build` (desktop), `expo export --platform ios` (mobile JS bundle) | succeeded |
| Migration validation: empty DB, rerun no-op, `--check`, checksum tamper, upgrade, failed-migration rollback | in backend suite |
| E2E: real uvicorn + PG + TypeScript sync engine/API client, interrupted upload + relaunch | passed |

### Scenario map

| ID | Scenario | Status | Evidence / limit |
| --- | --- | --- | --- |
| A01 | Ordered capture, exact originals | PASS (synthetic) | `test_capture.py`, e2e: local = server = cloud-on-disk = desktop-fetched SHA-256 for 3 ordered pages. Real-photo/iPhone/Windows run is **OPEN (G1)** |
| A02 | Force-close/reopen keeps local capture | PASS (logic, node:fs adapter) | `local-store.test.ts`: crash injected at *every* file operation of Save; acknowledged saves never lost, partial saves never visible. The Expo file adapter on a real device is **OPEN (G3)** |
| A03 | Retries/idempotency | PASS | `test_idempotency.py` (duplicate create/finalize, mismatched payload, lost acks, retry after upload/finalize, concurrent identical requests), `syncer.test.ts` |
| A04 | Corrupt/oversized/unsupported | PASS | `test_capture.py`, `test_failures.py`; nothing is stored for rejected bytes |
| A05 | Offline / permission denied | PARTIAL | Offline and signed-out upload behaviour PASS (`syncer.test.ts`). Camera/photo permission-denied UI is implemented but **not exercised** (needs device) |
| A12 | Cross-workspace access incl. source bytes | PASS | `test_isolation.py` (two workspaces; list, fetch, source, finalize, authorizations, upload tokens, ID inference, header/body workspace injection, raw SQL as the API role) |
| A06–A11, A13–A24 | Interpretation, AI, sync feed, export, delete, restore… | Not in scope | RCL-002+; not implemented, not claimed |

### Remaining live gates (OPEN, not simulated)

- **G1 — Real device end-to-end.** Photograph real pages on a physical iPhone, Save, interrupt/retry, view the verified original in an *installed* Windows build, compare hashes (procedure: `docs/DEVELOPMENT.md`). Needs: Apple developer signing, a Windows machine, a live API.
- **G2 — Live Supabase.** Real Auth (email OTP, signups restricted, JWKS/issuer values), private Storage bucket, `SupabaseObjectStore` against the real service (currently only a stub HTTP transport), non-owner DB role on the managed Postgres, RLS verified there. Needs an authorized, provisioned project.
- **G3 — Native adapters on device.** `ExpoFiles`, `ExpoFileUploader` (assumes non-2xx upload responses are returned, per the SDK 57 type docs), SecureStore chunking, `expo-camera`/`expo-image-picker` behaviour (HEIC from the picker, camera JPEG), and Tauri keyring on Windows Credential Manager.
- **G4 — Desktop installer.** Only the Linux Rust check ran; no Windows build, NSIS installer, WebView2 behaviour (e.g. HEIC preview, CORS origin `http://tauri.localhost`) or code signing was exercised.
- **G5 — Performance.** Local Save p95 < 1 s was not measured on a device.

### Known limitations

Upload spool files live in the OS temp dir and are not swept after a hard kill; Pillow decode memory is bounded only by the pixel limit and there is no upload concurrency cap. The mobile manifest write is not fsynced (device-only risk; unreadable manifests are reported, not deleted, and not auto-rebuilt). 
Local originals are kept after upload (no cleanup yet). Draft pages exist only in memory until Save. Upload goes through the API (25 MiB/page) rather than directly to storage. No quotas/rate limits, deletion, backup/restore, or telemetry. Mobile/desktop icons are tool-generated placeholders, not an approved brand. Server list ordering is by server creation time and can skip a late-committing capture during a paginated walk. HEIC/HEIF are signature-checked but not decoded server-side. Multi-picture (MPO) camera JPEGs are accepted. `expo-doctor` could not complete two network-dependent checks in the sandbox (19/21 passed).

## RCL-002 evidence (First Useful Recall)

Candidate: branch `rcl-002-first-useful-recall` (exact SHA in the PR). Same environment as RCL-001. **Every interpretation and answer below was produced by a SYNTHETIC scripted fake provider** (`services/backend/tests/fake_provider.py`). That tests Recall's own gates, jobs, validation, retrieval, and citation checks; it says nothing about how well a real model reads real handwriting. No live provider was called (no key or budget has been authorized).

### Automated results

| Suite | Result |
| --- | --- |
| Backend `pytest` (real PostgreSQL 16 + RLS incl. worker role, local object store) | 140 passed, 0 failed, 0 skipped (incl. 10 adversarial validator unit tests) |
| `ruff`, `ruff format --check`, `mypy --strict` | clean |
| Claude adapter contract (`test_anthropic_adapter.py`, stub HTTP transport; official SDK) | request shape, structured output, effort, refusal fallback, error/stop-reason mapping |
| E2E: real uvicorn + worker + TypeScript clients (`rcl002.e2e.ts`) | phone upload → consent → worker reads → desktop Ask → cited original byte-identical to the phone's copy; unrelated question abstains with no model call. 12 consecutive runs after a fix (see below) |
| TypeScript vitest: api-client 13, design-tokens 4, sync 30, mobile 6, desktop 16 | all passed |
| Independent adversarial review of bc7c2e4 | 9 findings (3 high, 3 medium, 3 low), all fixed with regression tests; the 7 validator regressions fail on bc7c2e4 and pass on the fix |
| `eslint`, `tsc` all workspaces, `vite build`, `expo export --platform ios` | clean / built |

The independent review found that the first validator judged claims only against their quotes: a model could quote "800 psi" from "800 psi?" and record a fact, add names/amounts/days to a summary or statement backed by a one-word quote, or stitch a name from two separate quotes. Validation now judges every claim against its full cited lines (see API-CONTRACT). It also found lifecycle gaps (a capture stranded in `processing` after consent was revoked during retry backoff; cancelled work never resuming; billed Ask failures not counted against the budget), all fixed.

The PR's bot review (Codex) found two more, both fixed with tests: multi-page claims were indexed only against their first page (a citation could open a page that does not support the sentence), and the retry-processing idempotency key was validated but not recorded.

A flaky E2E also exposed a real defect during this packet: summary chunks cited a page without its page number when ranking ties broke toward them. Fixed in the worker and covered by `test_every_cited_original_has_a_page_number`.

### Scenario map

| ID | Scenario | Status | Evidence / limit |
| --- | --- | --- | --- |
| A06 | Clear source → supported interpretation + cited answer with the correct original | PASS (synthetic) | `test_vague_recall_finds_the_right_memory_and_original`, RCL-002 e2e. **Real-model quality OPEN (G6)** |
| A07 | Ambiguous number / "?" / name stays uncertain | PASS (deterministic rules, synthetic adversarial proposals) | `test_validate.py` (partial quotes cannot strip "?", recorded doubts downgrade, no invented names/amounts/days in summaries or statements, no stitched mentions/dates/attributions) + `test_model_cannot_add_certainty…`. The rules are lexical: a model paraphrase that keeps every word and number but changes meaning is not caught at runtime (evaluation, G6). Name resolution is not attempted (RCL-003) |
| A08 | Relative dates not converted | PASS (rules) | time wording not on the page is removed; no date normalization exists |
| A11 | Unsupported question abstains | PASS | no evidence → `insufficient_evidence` with no model call; invented citation → `ANSWER_UNVERIFIED`; empty answer rejected |
| A12 | Cross-workspace isolation incl. memories/search/Ask/worker | PASS | `test_memories_search_and_ask_are_workspace_isolated`, `test_worker_role_is_scoped_to_the_claimed_workspace` (raw SQL as the worker role) |
| A13 | Instructions inside a source stay inert | PASS (mechanism) | `test_instructions_inside_a_source_are_inert`: injected text is stored as content, cannot change permissions or certainty, and reaches the answer model only as delimited data. A real model's susceptibility is part of G6 |
| A14 | Crashed/expired worker cannot commit stale results | PASS | `test_expired_lease_cannot_commit_late_and_no_duplicate_memory` (one memory, one revision) |
| A23 | Vague associative recall | PASS (keyword baseline, synthetic) | 4-domain synthetic corpus (people/solar, travel, lecture, household). Paraphrase-only recall without shared words is expected to fail until measured hybrid retrieval (RCL-003) |
| — | Consent / config / budget gates | PASS | consent required; revocation cancels queued work and never strands a capture in `processing`; re-enabling resumes it; unconfigured server refuses consent; budget stops calls and answers; billed failures count toward the budget |
| — | Original integrity before sending | PASS | altered original → `SOURCE_INTEGRITY`, nothing sent; model receives a metadata-free, orientation-corrected derivative (GPS EXIF removed) |

### Remaining live gates (OPEN)

- **G6 — Live provider quality.** Owner-authorized key + budget, provider retention/training terms checked for the account, consented private multi-domain corpus outside the repository, held-out questions; measure per DEVELOPMENT "Live AI acceptance procedure" (critical-field accuracy, uncertainty retention, entailment of cited sentences, abstention, cost, latency). Release blockers: fabricated confirmation, silent number/unit change, cross-workspace leak.
- **G7 — Live structured-output schema acceptance.** The schema sent to the API drops keywords outside the documented structured-output subset (the full schema is enforced locally); whether the live API accepts it, and the live refusal-fallback behaviour, are unverified.
- **G8 — Deployment of the worker** (process supervision, the `recall_worker` login role on managed Postgres, lease length vs. real call latency).
- G1–G5 from RCL-001 still apply (device, live Supabase, native adapters, Windows installer, latency).

### Known limitations

Keyword-only retrieval (no embeddings); one revision per memory (no reprocessing or corrections yet); no entity linking, review queue, or temporal supersession (RCL-003); Ask is single-turn; no runtime entailment check; no lease heartbeat (a call longer than the lease can be reclaimed and repeated — billed twice, never committed twice); HEIC decoding for derivatives relies on `pillow-heif`; usage cost is an estimate from configured prices.

## V1 build evidence

See [V1 implementation and acceptance ledger](V1-STATUS.md) for exact automated evidence, requirement statuses, limitations and live gates. PR checks supersede intermediate local counts. No simulated test closes physical-device or live-provider acceptance.
