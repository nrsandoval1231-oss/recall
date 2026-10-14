# Recall acceptance and evaluation

## Native library/editor review repair — 2026-10-13

Authority: [Native Memory Product Contract](NATIVE-MEMORY-PRODUCT-CONTRACT.md); the ivory Adaptive Memory Surface remains unchanged. PR #54 is **not independently cleared for merge**.

- Packet head `04d2990e5b3249558dbd859e2a1e9530c4655e10`, base `0d2a692b809f586b1c2efba1823b345e79618d30`: [packet evidence](audits/native-library-editor/README.md), [13-step ledger](audits/native-library-editor/ACCEPTANCE.md), and its linked runtime JSON/screenshots record Linux Tauri IPC/filesystem checks with synthetic content. Historical intermediate counts (245/111 and 255/115 native/desktop tests) are stage-specific, not proof for later heads. Artifact files do not all embed their generating commit; retain that provenance limitation rather than retroactively certifying them.
- [CI run 38457525519](https://github.com/nrsandoval1231-oss/recall/actions/runs/38457525519) passed six jobs for that candidate, checking out synthetic merge `a040e53a6c675dab2120a7f84934928bce9428e8`, not detached-head independent validation.
- Clean-save repair `c2f7fa5`: ordinary unchanged submission makes no native correction call, so cannot add history/revisions or change processing eligibility. Reviewed proposals retain explicit forced submission; uncertain retries retain their operation identity; conflict review retains the latest expected revision. The new component regression failed before repair (one unexpected native-boundary call) and passed afterward. Editor/session suite: 13 passed; repository lint/typechecks and desktop production build passed; native Rust library: 255 passed. The first full workspace run exposed an older organization test that expected an unchanged correction; its follow-up now asserts no-op first, then a real edit preserving metadata. Final full-suite results must be read against the follow-up head, not inferred from the earlier focused pass. These are builder-run synthetic regressions, not independent clearance.
- The existing native `resume_import` guard executes before opening the import picker. The prior import-cancellation finding was already repaired in the packet; this repair does not alter that path. Existing native import/restart tests remain passing.

Remaining gates: independent review of each final head/actual base and refreshed CI; installed Windows native workflow, physical iPhone/Tailscale, live Jev/Claude handwriting/organization and correction/reprocessing quality remain unverified for this packet. Prior owner-observed Windows/provider evidence below is historical and is not acceptance of this candidate. No completed broader security audit is claimed.

## RCL-INT-001 current native status — 2026-10-12

Implemented: selected-vault text/photo capture → native consent/configuration/budgets → text-only Jev classification (Claude visual adapter for photos) → closed Claude librarian → deterministic source-linked YAML/Markdown publication → desktop/phone source-backed local retrieval. Source-focused project boards and an explicitly unscheduled agenda use persisted notes. No active PostgreSQL/login dependency. PR26 remains isolated. The owner-uploaded canonical PNG is now available in UX-SPEC. Asset handoff is verified; implemented UI fidelity is not accepted.

| Slice | PR | Validated head | Squash merge | Exact-head CI (all five passed) | Independent verification |
|---|---|---|---|---|---|
| Validator | 28 | 0b5f018fb5d2759b03f03d737152a68ef25cfdd3 | f28d07f02f88b811dc01c43883f9dd6845f3cf28 | 38197994123 | 17 focused tests |
| Existing reader recovery | 31 | 4d952b89828de9caa0ac3c75339d3d8a6f36ff35 | e0d7386fed0a89b3475d99ac1db387397c7ef408 | 38200077693 | 123 native-core tests |
| Jev adapter | 30 | 9dda50e34b7e4da45fb1863aa8b0e2b0fc2b4daa | 99b1d711413ef2b744c09dbc3c8972e709dbf729 | 38246208761 | 15 adapter tests |
| Durable parser | 32 | f95c0f2b50f3e6cfa77fc46388a0b6ad74b50565 | b6073fb0dd19df598b0d7b99e547210cff622544 | 38249613484 | 153 native-core tests |
| Claude librarian | 33 | 54ebf30abf35457921d90d0d67e2939a2c2b7192 | 53d3267d5dfbb35506c4c89041a85fef25fa5c5c | 38252323122 | 164 native-core tests |
| YAML writer/retrieval | 34 | 49a0074c7a86601172ec6e86dd5e31e5dc395953 | 2f078251cd1a37a7259ee754bae95322241a15d8 | 38255483857 | 173 native-core tests |
| Desktop typed workflow | 35 | dd53900e989d01b2445d4cb0ea3fba60dfcde79c | 0da44c6474ef7fca412b091e1fce381190ccf55f | 38259230636 | 68 desktop tests/typecheck/build |
| Photo bridge | 36 | 954a7fceec12e68a52c48f8eac9b5024e154049e | 90532bff5b14aacce9f1b2ffcc4b57b200b2d0e7 | 38261409179 | 183 native-core tests |
| Phone Capture/Ask | 37 | ac7304e379c6ca8d3968af392d56b74fdf88d97d | 1d96e7be6e0dbf0e0c2911b4d239474b967d8cbb | 38263514173 | 191 native-core tests |
| Persisted context surface | 38 | 2314d292ebc4761851ba7bc5ea2b04060d7eb476 | e8a9a8e6a6cd970def370005f6610a7620e1dffc | 38263516469 | 72 desktop tests/typecheck/build |

PR39 source-focused project boards accepted: exact head ae210ae95b989b03bd2224c86ff57c3f58b3e1b3 passed all five jobs in CI38267457055 and squash merged as240125bfc4c82b2bbd06c7b67065683477e42b97. Independent74 desktop tests/typecheck/build passed with the older-capture calendar regression. Narrative entries below record evidence at their original stage and do not override this snapshot.

The mandatory meeting text was exercised through real native orchestration/storage with explicitly synthetic Jev/Claude transport fixtures. Persisted YAML has source hashes/wikilinks, exact quoted evidence, unresolved questions, source follow-ups and retracted8MW. Reopening the vault before “What was going on with that utility delay?” retrieves the note and exact original hash. This is NOT authenticated inference or handwriting performance proof. Core tests cover malformed proposals, unknown delivery, stale revisions, source/context mismatch, operation replay, external Obsidian edits, interrupted writes and pre-photo artifact recovery. Native source-linked originals/history remain preserved.

Live acceptance remains OPEN. The engineering workspace has no native provider secrets/configuration. The owner configured both providers on Windows, authenticated their model-list endpoints, installed the CI installer at PR40 candidate56d6779c2c07e08e1bf1454cdfa21320b00f7625 and saved the exact synthetic meeting note in a selected test vault. The original hash matched. UI processing reached Claude after Jev parsing; full parser artifacts/publication/restart have not yet been inspected. Sonnet5.5 rejected forced tool choice; a separate live synthetic compatibility probe succeeded with automatic tool choice (400 input/53 output tokens). The original organization attempt remains uncertain and blocked; no complete live pipeline acceptance is claimed. Actual unauthenticated HTTPS Jev metadata request returned403 via configured proxy/system trust, with no key or capture sent. Windows installation and original capture are now owner-observed; installed application restart, Obsidian inspection and real iPhone/Tailscale/denied-peer tests remain open. Real handwriting evaluation requires configured providers and approved sample images. Pending phone workers require manual retry after restart; uncertain delivery never automatically resends. Ask is bounded local quote retrieval, not a Claude-generated synthesis. Mentions/relationships remain unresolved display hints from user-editable Markdown; no semantic identity/project merges or confirmed calendar commitments are claimed.


### RCL-INT-001 source-focused project boards

Projects now opens a board from each saved unresolved project/organization mention. Context, agenda and capture months stay scoped to that source ID; existing native related targets remain eligible possible relationships. Same names never merge. Returning to all project sources resets Overview; deleted/conflicted/retracted or changed mentions no longer supply a stale focus. Vault changes clear focus.

Verification: 74 desktop tests, lint, typecheck and production build passed. Independent review reproduced 74 tests/typecheck/build; its older-capture calendar finding is fixed with a May/August source regression. Exact-head CI required before merge. This is source-board navigation, not verified semantic project/entity resolution. Live inference and installed-device acceptance remain open.

## RCL-INT-001B first Jev boundary — 2026-10-12

OPEN: bounded native text parser and real documented HTTPS transport implemented; durable provider jobs/budgets, photo transcription provenance, multiword entity extraction, live execution, complete pipeline/restart and UI wiring remain open. No model request sent. This is the next small reviewable slice, not stage completion.

Focused Rust harness compiles the byte-identical native `jev.rs` with existing production dependencies. 15 tests pass: exact UTF-8 spans, decimals, uncertain December, crossed-out scope, source digest/change rejection, supported request shape, candidate entity/quantity offsets, malformed/missing/extra answers, distributions, pinned response model, absent consent/key and request-byte bounds. Synthetic responses are clearly marked and only test validation. Independent adversarial review independently reproduced 12 tests, found model mismatch and mutable Prepared evidence; follow-up fixes make Prepared opaque, bind concrete models, retain input/output usage, and conservatively extend retraction scope. Independent follow-up reproduced 14 tests and approved this disconnected boundary. Version syntax and output-token bounds were subsequently tightened with a failing-then-passing regression. Exact-head repository CI required before merge. Existing vault/phone/librarian/validator modules also passed 116 tests in a byte-identical native-core harness, independently reproduced; this includes restart/reopen, injected interruption recovery, external edits, stale revisions and duplicate operations, not full intelligent-pipeline persistence.

The mandatory meeting note was used as a source-span test fixture, not run through real Jev/Claude or published as a real memory. No vague AI answer or organized Obsidian result is claimed. Missing credentials and the canonical UI PNG remain external gates; installed Windows/iPhone/Tailscale acceptance is unavailable on this Linux machine.

## Claude reader recovery prerequisite — 2026-10-12

Independent work while real Jev/Claude credentials are unavailable. This repairs the existing photo reader, not the unimplemented librarian organization stage. The actual Claude transport now treats delivery errors as uncertain, keeps their reservation and avoids automatic repeat. It bounds responses to 128 KiB, omits provider error bodies, and excludes the key from configuration Debug output. Provider budget/reading files reuse native checked-path, flushed staging and atomic Windows write-through replacement rather than deleting the prior record on rename failure. A vault writer lock serializes reservation/replay and provider calls so concurrent reads cannot overspend the same ledger. Capture may return busy during a reading (up to its 45-second timeout); original data remains intact.

Six meaningful regressions reproduced failures before fixes: credential Debug leakage, symlink destination replacement, oversized valid response, concurrent budget reservation while the vault is locked, symlinked reading loads and unknown budget states. Stored ledger/reading loads now use bounded native no-follow reads and validate metadata; this is structural validation, not proof of model-output authenticity. The byte-identical native-core harness passes 123 tests, including existing budget, uncertain-outcome retry, malformed response, idempotency, original preservation, external-edit, recovery and restart/reopen tests. Full local Tauri build remains blocked by missing GTK/WebKit development libraries; exact-head CI is required. Windows run `38199406084` at `6e3c25c` caught five reader test failures (`Incorrect function`, OS error 1). Root cause: native path walking probed a standalone canonical Windows verbatim drive prefix before its root separator. The fix skips only Prefix metadata, then checks the complete root and every real ancestor. A canonical-root open/create/replace/read regression was added; Windows exact-head CI must verify the fix. Real provider/hardware/complete Meeting-to-Memory acceptance remains OPEN.


### RCL-INT-001 phone engine and source-backed Ask

Implemented native optional per-capture processing and bounded local quote retrieval, original TXT/photo inspection and SHA references. Existing tailnet/same-origin/body/rate protections remain. Native-only keys and configuration; deterministic retry IDs; immutable source-bound consent; native publication receipts override cache. Security regressions cover forged published cache, original tampering, malformed/repeated consent and cross-origin refusal. Restart tests retain captures and publication without another provider call. Pending workers require manual retry after restart.

Source-identical native-core verification: 191 tests passed (synthetic providers only); independent review reproduced all 191 after the final truthful saved-processing-error UI regression. Exact-head CI is required before merge. Live Jev/Claude, handwriting accuracy, installed Windows app and iPhone/Tailscale hardware acceptance remain open.

## RCL-INT-001A validator review — 2026-10-12

PR #28 merged as `f28d07f02f88b811dc01c43883f9dd6845f3cf28` after all five CI jobs passed on candidate `0b5f018fb5d2759b03f03d737152a68ef25cfdd3` (run `38197994123`), including Windows tests/check/unsigned installer. Independent review reproduced 17 validator tests. This is not installed Windows acceptance.

PR #28 original head `2819d6208f35bbd4b4ae1780b1575055e57dbef9` was reviewed against main `3cea9ff9ddb36bdafbe5a323c5996ef71a585ddb`. PR #26 was neither fetched nor incorporated. PR #27 remains draft; its required canonical PNG is absent.

The follow-up validator rejects Windows device names/trailing periods, case-insensitive duplicate targets, undeclared body wikilinks, arbitrary Markdown destinations/HTML/embeds, fabricated evidence excerpts, and explicit uncertainty downgrades. Retracted evidence must retain its context. `validate_grounded` requires caller-supplied, hash-verified transcription; it cannot verify a photo transcription against pixels. No publishing adapter is connected yet, and free-form body entailment, identity resolution, YAML serialization, and authorized existing-target checks remain OPEN. Passing this boundary must never be described as safe automatic organization.

Focused verification: the unchanged native module compiled in an external minimal Rust harness with serde/serde_json; 17 tests passed. Three added security regressions first failed on the original implementation. Full `cargo test --lib` was attempted but failed during dependency build: system `glib-2.0.pc` unavailable; WebKit development libraries also absent and no sudo installed. Remote exact-head CI is required before merge. Follow-up review found a multiline retraction bypass; a regression reproduced it and removing newline as a context delimiter fixed that case. This conservative delimiter-based helper is not a full natural-language uncertainty detector.

Independent adversarial review found and confirmed the issues above; also noted the existing writer's concurrent ancestor replacement race, which is not addressed by this proposal-only slice. Reusable writer behavior includes append-only revision chains, original hashes, optimistic concurrency, journal recovery and external-edit protection. It does not currently produce organization YAML.

Provider/runtime gates: environment readiness reports no configured secrets, runtime variables or outbound identities. No private source or model request was sent. Windows installation, real iPhone/Tailscale/denied peers, Obsidian application launch, real Jev/Claude outputs, restart of the complete intelligent pipeline, and the mandatory meeting-to-vague-Ask demonstration remain OPEN.


> **HISTORICAL — 2026-10-09 PWA pilot note.** Superseded by the [2026-10-10 amendment](PILOT-CONTRACT.md). The current product center is the desktop Memory Surface, with organized notes in Obsidian and the phone as a capture/ask companion. No login or email-auth UX still applies. PR #16 remains the installable web companion and enrollment transport. The owner visual reference is [memory-surface-reference-2026-10-10.jpg](assets/memory-surface-reference-2026-10-10.jpg).


## Current local-first acceptance interpretation (2026-10-11)

The active product is the Obsidian-vault desktop plus Tailscale phone companion. Jev parsing and Claude organization are required product capabilities, not verified live integrations. PostgreSQL, Supabase, Expo and hosted PWA acceptance below is retained historical evidence only; those gates do not block the local-first pilot. Installed Windows, real iPhone/Tailscale and denied-peer tests, live Jev-to-Claude-to-validated-Markdown/YAML writing, correction-safe reprocessing, and vague evidence-backed Ask remain OPEN. The visual timeline remains required under UX-SPEC's 2026-10-11 owner cuts; older acceptance prose saying it was removed is superseded. PR #26 remains isolated. See CANONICAL-FOUNDATION.md.

Version: 0.3 | Automated evidence and OPEN live gates

## Evidence standard

Record exact commit, environment/device, provider/configuration, dataset version, procedure, results, skips, and limitations. Synthetic tests, live-provider tests, installed-client tests, and private-user acceptance are distinct evidence.

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

### RCL-INT-001 organized-note body corrections

Recall now edits the readable body of generated notes while preserving the exact native YAML identity, source references and owner properties in the unchanged native revision-checked writer payload. Board/evidence/current-quote/history views show body text; full documents remain in Obsidian and native history. Legacy raw notes remain unchanged, foreign identity headers are not treated as native properties, and malformed native headers require review rather than silent stripping.

Verification: 79 combined desktop tests, lint, typecheck and production build passed after rebasing onto merged project boards. Independent review reproduced 77 editor-slice tests/typecheck including the final deferred-organization-to-save regression; it found a missed completion-path conversion, now fixed. The regression ensures no duplicated inner YAML and exact native correction payload. Final combined independent review and exact-head CI required before merge. Production TypeScript body conversion was also consumed by the real native correction writer: revision3 persisted, a new process reopened and replayed its receipt without another revision, original SHA unchanged and three history records. The initial vault uses synthetic provider fixtures; this proves correction/storage only. Native source/hash, optimistic revision, journal and receipt protections are unchanged; no provider or installed-device acceptance is implied.

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

## Web companion PWA and device enrollment evidence (2026-10-10, PR #16)

This section records PR #16. It is the optional web companion, not the product-center launch. See the [2026-10-10 amendment](PILOT-CONTRACT.md).

Candidate: branch `cursor/pwa-device-enrollment-d77c` (exact SHA in the PR description). Environment: Linux sandbox, Node 22.14.0, Python 3.12, PostgreSQL 16 without pgvector. Synthetic fixtures only. This is not iPhone, Windows, deployment, or live-provider acceptance.

### Automated results

| Suite | Result |
| --- | --- |
| `cd services/backend && uv run ruff check . && uv run ruff format --check . && uv run mypy src` | clean |
| `cd services/backend && uv run pytest -q` | 206 passed, 8 skipped (pgvector is not installed in this local PostgreSQL; Linux CI installs `postgresql-16-pgvector`) |
| `npx eslint .` | clean |
| `npm run typecheck` | clean |
| `npm test` | api-client 26, design-tokens 4, sync 64, desktop 36, mobile 9, web 55 |
| `npm run build -w @recall/web` | Vite production build; fixture isolation passed. Manifest, icons, and `sw.js` are in the build output |
| `RECALL_CHROMIUM=/usr/local/bin/google-chrome npm run test:ui` | 42 passed (desktop, mobile, reduced-motion). This uses the development fixture route, not an enrolled device |

Enrollment tests cover an unprovisioned caller, a wrong or unset operator secret, single-use replay, expiry, revocation, a non-member workspace, issuance and redemption rate limits, a missing enrollment header, cross-site `Sec-Fetch-Site`, a foreign `Origin`, a revoked session losing `/v1/me` and original bytes, cross-workspace read/write, the operator kill switch, and the API role being unable to read enrollment tables. Web tests cover fragment redemption without `localStorage`, a legacy email callback that is not posted, overlapping session checks posting once, a dropped enrollment request that can be retried, the unprovisioned screen, and a service worker that does not cache `/api/` or `/auth/`.

### Open gates

The steps to run on the host and on devices are the unchecked list in [Real-device deploy checklist](audits/2026-10-10-real-device-deploy-checklist.md). This section does not mark those gates passed.

- iPhone Safari Add to Home Screen, standalone launch, and safe-area behavior on a real phone.
- The same URL in a Windows desktop browser, including install or pin if the browser offers it.
- A deployed API and Worker with `RECALL_OPERATOR_TOKEN`, `RECALL_SITE_ORIGINS`, and `SESSION_KEY` set, then one real enrollment, revocation, and cross-workspace denial.
- Live handwriting interpretation. Hooks stay stubs or the existing unconfigured path; no paid provider was called.
- Native Expo, Tauri, and NSIS builds. They are not the pilot acceptance path and were not changed as a stack.

## Desktop Obsidian Memory Surface (2026-10-10)

This section records the October 10 desktop-vault candidate snapshot, not the latest integrated behavior. The PR #16 sentence above still describes that packet: native installers were not its acceptance path. This slice became the product center. Its evidence is synthetic and automated; it is not installed Windows, real iPhone, or a live Claude reading. Later opt-in reader and phone changes are tracked separately below.

Candidate: branch `cursor/desktop-vault-memory-surface-bab1` (exact SHA in the PR). Environment: Linux sandbox, Node 22.14.0, rustc 1.99.0. Synthetic Brooks Campus fixture and generated photo bytes only. No private notes. No paid model call.

### What the code does

The Tauri app opens the Memory Surface with no email, password, or sign-in link. `?mode=legacy-cloud` still reaches the older cloud desktop, including its email sign-in. That is not the happy path. `apps/web` enrollment is unchanged.

A chosen folder, or `Documents/Recall` from **Use default vault**, holds `Recall/Sources`, `Recall/Memories`, `Recall/History`, and `Recall/_meta`. The webview cannot pass a path. `RECALL_VAULT_DIR` is a native-process override and must be absolute. Import writes the original bytes before the Markdown note. A correction appends history and publishes only when the expected revision still matches. A note edited outside Recall is kept. Ask is keyword search over those notes, or over the labeled synthetic fixture when no vault memory exists, and can open the original. The result is labeled keyword search. At this dated candidate commit, Claude reading was unwired. A test could inject a synthetic reader; it did not make a network call, and its text was saved only after an explicit checkbox and a save. Later opt-in transport is described in subsequent evidence and does not retroactively change this candidate's test results.

When no vault is open, or the vault has no memories, the board is the synthetic Brooks Campus fixture and says so. People, places, topics, and related counts on that board are the illustration. They are not inferred from a real vault.

### Automated results

| Suite | Result |
| --- | --- |
| `npm test --workspace @recall/desktop` | 57 passed (9 files) |
| `npx tsc -p apps/desktop/tsconfig.json` and `npx eslint` on the new desktop files | clean |
| `cd apps/desktop && npx vite build` with no `VITE_*` values | succeeded |
| `cd apps/desktop/src-tauri && cargo test --lib` | 121 passed, 0 failed (includes 7 librarian tests: default-off, missing budget, consent, hash mismatch, identical retry, spent budget, uncertain outcome not retried, and the note staying human until correction) |
| Browser preview of `npm run dev` in `apps/desktop` | home shows Brooks Campus and the synthetic banner, with no email field; Ask, a sample note, and the capture form were exercised in headless Chromium |

Rust coverage includes original-before-note writes, identical retries, rejected changed retries, versioned corrections, preserved external edits, journal recovery, symlink rejection, a second writer lock, and the librarian gates above. Desktop tests cover the empty demo board, keyword abstention, vault photo import, retry identity, correction history, hash verification, the synthetic reader consent gate, and a Claude refusal that does not replace the note.

### Open gates

- **Installed Windows.** The `windows-native` job builds an unsigned NSIS installer and uploads `recall-windows-desktop` for seven days. This environment did not install it, and did not open a native Tauri window. `npm run dev` cannot write a vault.
- **Live Claude quality.** The desktop can call Claude only when `RECALL_CLAUDE_API_KEY`, a model, per-million-token prices, and daily and monthly budgets are set on the native process. Default is off. One consented photo is sent; the proposal is stored unreviewed; the note changes only when a person saves a correction; keyword ask searches that note. Automated tests use a fake provider. No key, budget, or private photo was used, and no live reading quality is claimed.
- **Phone companion.** The local Tailscale page is covered in the next section. A real iPhone is still open.
- **Visual fidelity.** The surface keeps the owner reference layout: left rail, ask bar, project board, and context cards. The owner removed the bottom timeline strip, the recent-memory thumbnails, the site image on the project board, and the notebook/desk photograph behind the glass. The stage background is a flat charcoal field. That board is text, stats, and tabs. Demo stats are fixture counts. The opened sample note still shows its text; that note is not a backdrop.
- **Real Obsidian on a person's machine.** Not run. The folder layout is what Obsidian can open; Obsidian itself was not launched.

## Phone companion over Tailscale (2026-10-11)

This section is the local phone page. It is synthetic and automated, plus a loopback browser check on Linux. It is not an iPhone, not a Tailscale login, and not a Claude reading.

### What the code does

`recall-phone` serves one mobile page from the desktop machine. With Tailscale's IPv4 available it binds that address. Without it, or when tests ask for loopback, it binds `127.0.0.1`. `0.0.0.0` is refused unless `RECALL_PHONE_ALLOW_ALL_INTERFACES=1`. The page has no login, email, or password field, and it does not show the Brooks Campus fixture.

A photo upload calls the desktop vault writer. The original bytes land in `Recall/Sources` and the Markdown note in `Recall/Memories`. A note with no photo is saved under `Recall/Memories` and does not create a file in `Recall/Sources`. The same capture id and the same bytes, or the same text, are idempotent. A changed note on that id is rejected and the first note stays. A filename with a Windows path is not used as a destination. A cross-site `Origin` does not write. Ask is keyword search over the current notes, including a text-only note and an Obsidian edit, and the result says it is not a Claude answer. A photo original is served from the vault id, not from a client path. A text-only note has no original to open. The process does not read a Claude key.

### Automated results

Candidate environment: Linux sandbox, rustc 1.99.0. The default `cargo` on that sandbox was 1.83 and cannot compile the lockfile; the command used the stable toolchain. Synthetic PNG and JPEG bytes only. No private notes. No Tailscale account. No paid model call.

| Suite | Result |
| --- | --- |
| `cd apps/desktop/src-tauri && cargo +stable test --lib phone::` | 10 passed |
| `cd apps/desktop/src-tauri && cargo +stable test --lib` | 132 passed, 0 failed |
| `cd apps/desktop/src-tauri && cargo +stable check --bins --tests` | succeeded, including `recall-phone` |

The phone tests cover loopback-by-default, Tailscale address selection, refusal of `0.0.0.0`, an absolute vault path, a matching desktop selection file, a mismatched vault id, capture into `Recall/Sources` and `Recall/Memories`, a text-only note with no source file, an ask hit on that note, identical retry, a rejected changed retry, a preserved Obsidian edit, keyword hits and abstention, no fixture memories, HTML escaping, cross-site refusal, path traversal refusal, a per-minute capture limit, and an HTTP loopback save that returns the original bytes. The default `cargo` on this sandbox is 1.83; the commands above used the stable toolchain, rustc 1.99.0.

Headless Chrome on this Linux sandbox opened `http://127.0.0.1:8787/`, uploaded a synthetic PNG with the note `pump house, uncertain?`, and showed **Saved in the desktop vault** and **Claude was not called**. Asking `what about the pump house` returned that note, the `Recall/Memories` and `Recall/Sources` paths, and the original image. The page had no email, password, or sign-in field. That check is not an iPhone and not a Tailscale session.

### Open gates

- **Real iPhone on Tailscale.** Not run. Safari, Add to Home Screen, the camera sheet, and a tailnet ACL were not exercised on hardware.
- **HTTPS.** Not implemented. The page is HTTP.
- **Offline phone queue.** Not implemented. A page that does not load did not save a photo or a note.
- **Desktop evidence for a text-only note.** Not redesigned. Opening that note on the desktop reports that there is no original photo. The Markdown note stays in the vault, and phone keyword search finds it.
- **Claude from the phone.** Not implemented. The desktop consent path is unchanged.
- **Windows firewall and an installed companion service.** Not run. The process is a console binary, not a Windows service.

### RCL-INT-001 — durable text parser operations (implemented; live acceptance open)

Native parser operations now preserve the immutable initial text capture as a SHA-256-linked `.txt` source before a provider attempt. Strict source/revision-bound input, reservation and result records survive reopening the vault. Missing native configuration or consent leaves capture pending. An attempted request without a validated result remains uncertain and is never automatically resent, including under a new operation ID for the same source. Successful requests retain their conservative budget reservation. Human corrections and external edits stop automatic reprocessing; photos explicitly await visual transcription.

Validation: 153 source-identical native-core tests passed locally, including consent/budget gates, result tampering, uncertain delivery and replay after reopening, source mismatch, stale revisions, original preservation, and existing writer failure regressions. Synthetic transport fixtures prove orchestration only. Live Jev inference remains blocked by absent `TYPESAFE_API_KEY`; model/version and price/budget configuration must also be supplied. The native HTTPS metadata probe uses approved environment proxy and system trust with redirects disabled; it sends no key or capture. Full desktop exact-head Windows/Linux CI and independent review remain required before merging this slice. This operation does not yet invoke Claude organization or publish generated Markdown.

### RCL-INT-001C — closed Claude organization (implemented; live acceptance open)

The existing ClaudeTransport now supports a forced `organize_memory` tool with a strict layout schema. Claude receives validated source spans and at most four relevant active, nonconflicting memory excerpts (600 characters each). Its response can select source-span sections/title/category and authorized memory IDs; it cannot supply arbitrary paths, Markdown, YAML, entity identities, dates or new claims. Native rendering quotes source statements, preserves every span, routes uncertain/retracted statements into dedicated sections, leaves entity candidates unresolved, and supplies YAML properties and native source/memory wikilinks. Only explicit source imperatives become follow-up checkboxes.

Organization proposals persist and replay after restart. Photo reading and organization share one native Claude budget ledger; organization conservatively retains a 64,000-input/2,048-output-token reservation. Missing configuration, explicit consent, invalid proposals or uncertain delivery prevent unsafe retries. Local validation: 164 native-core tests passed, including the mandatory synthetic meeting note, omission/duplication/unauthorized links, Markdown escaping, forced-tool response rejection, shared budgets and restart replay. Synthetic provider responses are tests only. Live inference remains blocked by absent keys/model/pricing/budgets. Markdown publication, complete desktop bindings and the full live demonstration remain OPEN.

Independent organization review found renamed-note link resolution and a pre-lock source/context race. Native context now carries an authorized current basename; source/context are rechecked under the writer lock before and after the provider call. External edits during processing withhold the proposal. Corrupted audit metadata fails replay. Three regressions raise the local native-core total to164. Publication must still recheck revisions.

Durable parser operations accepted: PR32 exact candidate f95c0f2b50f3e6cfa77fc46388a0b6ad74b50565 passed all five jobs in CI run38249613484, including Windows native checks and unsigned installer. Independent review reproduced153 native-core tests. Squash merged as b6073fb0dd19df598b0d7b99e547210cff622544. Authenticated Jev inference remains blocked and is not implied by adapter acceptance.

### RCL-INT-001D — native YAML publication and source-backed retrieval (implemented; live acceptance open)

Closed persisted parser/librarian proposals now publish through the existing native journal, receipt, preserved-backup and revision machinery. A v3 manifest fence prevents older writers from opening YAML-bearing vaults; legacy v1/v2 serialized history remains unchanged. Native YAML begins at byte zero. Organization revisions retain model/operation provenance, original text SHA-256 and native source/memory links. Whole-document user corrections, external edits, note renames, explicit restore and removal remain portable and revisioned. Duplicate publication returns the current memory without overwriting later human edits.

Publication validates immutable parser input/attempt/result and original bytes, organization identity/layout, and related memory revisions/targets. These checks also run inside recovery for pending organization journals. Independent review identified the recovery bypass; regressions now interrupt publication, tamper with the original or related context, reopen/list, and verify no organized revision is committed. Six additional interruption points recover without duplicate revisions. Local native-core total:173 passing tests.

Local source-backed retrieval recognizes the vague utility-delay wording and returns the persisted meeting and original evidence after reopen. It returns clearly labeled retrieved quotes, not an unverified generated answer. The mandatory source retains the uncertain5–10MW estimate, December question, ambiguous identities and crossed-out8MW statement in their source/evidence sections. End-to-end tests use explicitly synthetic provider fixtures; actual authenticated Jev/Claude inference, installed Windows runtime and full desktop workflow remain OPEN.

Publication recovery also compares archived TXT bytes against the first immutable native capture history. A self-consistent tamper of parser input/attempt/result hashes and TXT is rejected by the native original; regression passes.

Closed Claude organization accepted: PR33 exact candidate54ebf30abf35457921d90d0d67e2939a2c2b7192 passed all five jobs in CI run38252323122 after rebasing onto merged parser operations. Independent review reproduced164 native-core tests and approved the bounded nonpublishing capability. Squash merged as53d3267d5dfbb35506c4c89041a85fef25fa5c5c. Provider inference and visual accuracy remain unverified.

### RCL-INT-001 persisted context surface

Existing warm-glass panels/cards now show source-specific unresolved people/location/project/organization mentions and related notes from persisted native Markdown. A source follow-up agenda lives in the existing Timeline panel and explicitly remains unscheduled; capture-month dates are actual native timestamps. No entity merges or December deadlines are inferred. React text rendering and exact section parsing exclude retracted mentions, deleted/conflicted notes, arbitrary raw captures and missing related targets. User edits can change these display hints; they are not independent provider or identity verification.

Local verification: 72 desktop tests, TypeScript checks and production build passed. Independent review reproduced all 72 tests/typecheck/build after fixing the floating-card layout. Exact-head CI required before merge. Full semantic project grouping, confirmed calendar commitments, live provider and device acceptance remain open. PR27's proposed canonical PNG is still absent; no image fidelity acceptance is claimed.

Independent floating-card review identified a related-only grid placement bug; both existing side slots are now retained whenever context is present, with a three-slot regression. Exact-head CI remains required.

### RCL-INT-001E — desktop text workflow binding (implemented; live acceptance open)

The existing warm-glass surface now saves messy text through selected-vault native authority and preserves original text evidence before returning capture. Explicit consent runs durable Jev parsing, closed Claude organization and validated Obsidian publication sequentially, with actual pending/processing/review/error messages. Stage operation IDs persist by stable vault/memory identity; renderer interruptions replay exact native receipts and never invent a new provider retry. Native secrets and filesystem destinations stay outside the webview.

Original text inspection verifies the returned SHA-256 against bytes and displays text as escaped content. Native source-backed Ask exposes current notes, original excerpts/hashes and evidence inspection. Generated YAML titles are shown without treating synthetic fixtures as actual vault memories. Missing configuration retains the original and pending state. Existing photo import/reading/correction behavior remains available; photo-to-parser transcription binding follows separately. The absent canonical PNG remains a visual-fidelity gate; no image asset or visual redesign is claimed.

Local verification: desktop typecheck and68 tests passed, including no-consent saves, durable stage ID reuse, pending-provider gate, receipt recovery, malformed/cross-memory responses, typed capture with original inspection and vague Ask, deferred organization after navigating to another memory, and out-of-order Ask responses. Independent review found the async editor race; guarded editor state and request ordering fix it. Production desktop build passed. Native prerequisite173 tests and PR34 exact-head CI run38251794926 passed. Installed Windows/provider runtime remains unverified without hardware/credentials.

Desktop organization completion preserves newer unsaved human drafts using an editor version guard. Deferred same-memory typing regression passes; older Ask completion cannot clear the newest request busy state.

Validated native YAML publication accepted: PR34 candidate49a0074c7a86601172ec6e86dd5e31e5dc395953 passed all five jobs in CI run38255483857 after rebasing onto the merged librarian. Independent review reproduced173 native-core tests, including recovery and capture-history provenance. Squash merged as2f078251cd1a37a7259ee754bae95322241a15d8. This is native storage acceptance; installed Windows/live provider acceptance remains OPEN.
### RCL-INT-001B/C/D/E — narrow photo bridge (implemented; live acceptance open)

The native processing command now reuses the existing consented Claude photo reader as a narrowly scoped visual adapter before text-only Jev parsing. Original photo bytes/hash remain authoritative; the machine transcript receives a separate SHA-256, immutable attachment and strict native-reading linkage. Both hashes and native capture history are checked by parser status, organization, publication and interrupted-journal recovery. Claude organization receives the bounded visual uncertainties, reader/model provenance and an explicit unreviewed flag. Generated notes link both evidence forms and state that visual accuracy is unverified. Crossed-out content remains retracted; native explicit source imperatives become possible follow-ups even if a model misfiles them.

Native parser configuration/pinned-model/budget and explicit consent gate visual calls. Automatic visual reads recheck source/revision/correction under the writer lock; uncertain reader or parser delivery blocks new provider attempts. Existing photo imports invoke the pipeline after source-specific consent. Manual photo reading retains its existing review behavior.

Local verification:183 native-core tests passed. New fixtures cover separate photo/transcript hashes and full native publication/reopen, no-consent/config/model gates, uncertain visual/parser requests, transcription tampering, bounded visual metadata in librarian input, explicit source follow-ups, and five photo publication interruption boundaries. Recovery after transcript tampering withholds revision2. Fixtures contain synthetic image signatures and synthetic provider responses; they do not evaluate handwriting or prove live inference. Desktop prerequisites68 tests/typecheck/build passed; final review and exact-head CI remain required. Actual Jev/Claude execution and handwriting performance remain blocked by missing credentials/configuration and an approved real sample; Windows/iPhone/Tailscale device verification and the missing canonical PNG remain OPEN.

Photo review identified a typed-renderer compatibility issue. Layout version1 retains exact previous rendering; new constrained tool proposals use version2. Committed receipt and pending-journal fixtures exported by compiling pre-photo native commit887e1c4 replay/recover byte-identical Markdown under the new engine. Schema version and actual previous artifacts are regression-tested. The exported source/provider responses are explicitly synthetic; this proves storage compatibility only.

## Sonnet 5.5 automatic-tool compatibility — 2026-10-12

Owner-run live diagnostic received HTTP400 `invalid_request_error`: forced `tool`/`any` selection is unsupported for `claude-sonnet-5-5`. The same synthetic diagnostic using `auto` returned one `recall_diagnostic` tool with `ok:true`, `stop_reason:tool_use`,400 input/53 output tokens. This proves provider authentication and automatic-tool compatibility only; it is not an organize_memory or meeting publication result.

Native request construction now uses automatic selection while requiring exactly one closed organization result. Text/thinking blocks never become Markdown. A regression first failed on the original single-content-block parser. 196 native-core tests passed, independently reproduced; safe numeric HTTP status reporting retains reservations and prevents same/new-operation resend after restart. Duplicate/wrong tools, unknown blocks, malformed fields, invalid stop reasons, truncated/oversized output and lost tools fail closed. Existing journals, source validation, revisions and all publication guards are unchanged. Exact-head CI required before merge; the original uncertain attempt is not released or removed.

## Explicit reviewed organization recovery — 2026-10-12

The original uncertain attempt is preserved. Recovery adds native source/parser/revision/context-bound review, a separate unchecked cost acknowledgement and current source consent. All <=16 blocked prior organization entries are copied into an immutable audit before one new reservation; old entries and their costs remain exact. Ordinary resume never creates an audit from browser metadata. A read-only preflight preserves receipt IDs on refusal and safely reuses an unattempted proposal after configuration/budget repair. Archived success replays without inference; durable unknown reservations remain blocked.

Regression coverage includes forged browser review metadata, false flags, wrong/same/nonorganization prior IDs, cross-memory same-hash records, changed context/parser/human correction, budget exhaustion, audit tampering, interruption before and after reservation, source-specific replay, history bounds and separate UI acknowledgement. Independent review found and fixed cache-derived acknowledgement and pre-audit failure stranding. Full installed reviewed retry/publication/restart remains OPEN; native/UI synthetic tests never stand in for inference. Exact-head CI is required before merge.

## Owner-observed live Windows text acceptance — 2026-10-12

The installed PR42 build completed the mandatory synthetic meeting source using real Jev 1.13.0 and Claude Sonnet 5.5 after explicit reviewed retry. This updates earlier OPEN text-runtime entries; it does not accept photo or phone behavior. Owner screenshots and pasted persisted Markdown show native YAML/model/operation provenance, matching original hash, uncertainty, unchecked follow-ups and the retracted 8 MW statement. The note and vague utility-delay retrieval survived application restart. The owner opened the note in Obsidian and followed its original-evidence link, returning the exact capture. See [bounded live evidence](audits/2026-10-12-live-windows-meeting.md).

PR42 head d84014613b479ba2b87e4e7aea39acfd21c2579b passed all five jobs in run38282476137 before squash merge f7c7129cd189df0c241c0579a46c757a334b797d. Independent review reproduced205 native and85 desktop tests. Incorrect unresolved entity classifications, raw Markdown presentation, real handwriting evaluation, physical phone/Tailscale checks and PR27's absent canonical PNG remain open. Owner evidence is distinguished from direct engineering-workspace provider execution and automated fixture tests.

## Canonical image handoff — 2026-10-12

Owner upload renamed without modifying bytes to `docs/assets/recall-desktop-canonical-2026-10-11.png`: PNG1182×789 RGBA, SHA-256 `66a0b09c499604ef5fc5811c55a9868ccd5d7dcc3966e594f74782b66dec275a`. Visually inspected against the owner-selected three-column business mockup. Missing-asset gate is closed; visual implementation fidelity remains OPEN. Main was merged into PR27 while preserving all native code and the current acceptance ledger. No PR26 content was incorporated.

## Canonical desktop UI implementation — 2026-10-12

The current Memory Surface follows the committed owner's three-column business reference: narrow branded rail, Ask and prompt chips, people/location context, compact central source board with recent notes, monthly capture calendar with open follow-ups, and four bottom actions. A generated decorative workspace background is separate from original vault evidence. Supplied brand/portrait pixels are used only where authorized: portraits, business metadata and scheduled illustration events appear only in the explicitly labeled browser design preview (`?design=canonical`, native vault unavailable). Native empty vaults remain empty. Actual people remain unresolved source mentions; actual calendar dots are UTC capture dates and follow-ups remain unscheduled. Topics displays saved frontmatter tags, not inferred taxonomy.

Markdown uses a bounded presentation boundary: no raw HTML, remote images or external navigation; source inspection and edits retain the existing native commands and body/frontmatter correction boundary. Source-only summaries exclude retracted statements. The UI does not add provider retries, API-key handling, folder writes, or a new store. Native processing/writing is unchanged.

Local verification:93 desktop tests, TypeScript checks, lint and production build; browser screenshots/interaction tests at1182×789,1536×1024,900×700 and390×844. Browser interaction fixtures emulate native IPC and are explicitly not native persistence or real-provider proof. Independent review found and repaired UTC calendar labeling, compact button names and async navigation invalidation. See root `design-qa.md` and `docs/audits/ui` for comparison evidence and reproduction. Exact-head CI, final independent approval and updated installed Windows visual acceptance are required before release claims. Live text/provider acceptance from PR43 remains the prior bounded evidence, not a new inference run.

## Corrected pending processing regression — 2026-10-12

Owner screenshot from the newly installed canonical UI shows a saved correction followed by `Validated parser result missing` while the renderer says it is checking a previous publication. Reproduction: an incomplete parser operation persists renderer IDs, then a human correction advances the memory revision; the old orchestration treats every revision change as an interrupted publication. That is not evidence of native publication.

Before replaying an unconfirmed publication after a revision change, the renderer now reads native revision history and requires the immediate successor to be a model organization event. Otherwise it retains the saved IDs and correction, reports that corrected notes need review, and calls neither parsing, organization nor publication. Native exact-receipt validation remains authoritative; renderer history never authorizes a new write or provider request. History-read failure stops recovery. Existing interrupted-publication recovery remains tested.

The first regression failed before the change. 95 desktop tests, typecheck, root lint and the production build passed; independent review reproduced the 95 tests and typecheck and approved subject to exact-head CI. This fixes a misleading recovery path, not the original unavailable parser result and not authorization to reprocess human corrections. No owner text, provider secrets or vault data are committed. Installed Windows acceptance of this patch remains pending.

## Installed UI status and preview polish — 2026-10-12

Owner-observed installed Home layout follows the canonical board, but retained correction/progress banners displace it and a source summary ends mid-word. Navigation now dismisses completed action notices; organization errors replace progress with the error. A dedicated vault-scoped in-flight organization counter preserves real progress across source inspection/navigation independently of the general loading flag. Text and photo originals are described as sources for correction/removal, and bounded source previews end at a word boundary with an ellipsis. No source bytes, provider calls or native publication rules changed.

Three initial regressions failed before the changes. Independent review identified the source-inspection/loading-flag edge case; a deferred A → B → Home → B regression failed before its repair and retains B's correction editor when A finishes. Local97 desktop tests, typecheck, root lint, production build passed. Reproducible browser checks at four sizes show zero console errors or accessibility violations using explicit synthetic native IPC, never real provider/storage proof. Browser test copy updated with the source wording. Final review and exact-head CI are required before merging this separate UI patch; owner installation remains pending.
