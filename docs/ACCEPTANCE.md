# Recall acceptance and evaluation

Version: 0.2 | Test specification; no application tests have run yet

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

## RCL-001 evidence (Trusted Capture)

Candidate: branch `rcl-001-trusted-capture` (exact SHA in the PR description). Environment: Linux x86_64 sandbox, Python 3.13, Node 22, PostgreSQL 16 (throwaway local cluster per test run), Rust stable. **Everything below marked PASS is synthetic/automated evidence on that environment; none of it is installed-client, signed-build, live-provider, or private-user acceptance.**

### Automated results

| Suite | Result |
| --- | --- |
| Backend `pytest` (real PostgreSQL 16, real RLS, local object store) | 85 passed, 0 failed, 0 skipped |
| Backend `ruff check`, `ruff format --check`, `mypy --strict` | clean |
| `packages/sync` vitest (durable save, crash sweep, recovery, upload engine) | 28 passed |
| `packages/api-client` vitest | 11 passed |
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

Local originals are kept after upload (no cleanup yet). Draft pages exist only in memory until Save. Upload goes through the API (25 MiB/page) rather than directly to storage. No quotas/rate limits, deletion, backup/restore, or telemetry. Mobile/desktop icons are tool-generated placeholders, not an approved brand. Server list ordering is by server receipt time. HEIC/HEIF are signature-checked but not decoded server-side. `expo-doctor` could not complete two network-dependent checks in the sandbox (19/21 passed).
