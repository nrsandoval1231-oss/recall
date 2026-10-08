# Recall V1 implementation and acceptance

## Local desktop foundation — implemented candidate, October 8

The owner requires no account/password/email-link sign-in, including first use. Local-only use must need no remote account; private cross-device use still needs secure owner-approved association. QR pairing is only proposed. Subsequent owner direction authorized the [local-only plan](superpowers/plans/2026-10-07-local-vault-foundation.md). Desktop now defaults to no-sign-in vault capture/search/evidence/correction/history, without cloud configuration. Deployed authentication and legacy cloud authority are unchanged. Existing email-flow attempts and deployment evidence below are historical/current evidence and are deliberately retained. Recovering email quota or remembering a session would not satisfy the new requirement.

This is the implementation ledger for the V1 build from accepted baseline `92b4c33aafda412f89d745f38b87858f2d4b2837`. A PASS below means deterministic implementation evidence, not live product quality. Physical devices, live infrastructure and model quality have separate gates.

## Required architecture gap — Obsidian spine

The October 7 product direction requires Obsidian as the user-owned durable memory spine. The bounded new local desktop adapter implements vault commitment, human revision history and supported direct-body-edit reconciliation. Existing cloud memory remains PostgreSQL-authoritative, with a one-way native Markdown exporter. Local lifecycle now adds flat renames, missing-note restore, logical tombstones and annotation-search rebuild. Full semantic reconstruction, nested moves, secure purge/undelete, phone transport and migration remain open in RCL-005B. Existing tests and canonical-browser acceptance do not establish vault-spine acceptance. Preserve legacy data and privacy contracts until migration is specified and verified.

## What works

### Selected-photo Claude reading, October 8 — bounded implementation candidate

The owner chose Claude full-page vision as the primary photo-reading path and authorized the [selected-photo reading plan](superpowers/plans/2026-10-08-claude-vault-reading.md). It adds a default-denied protected service, selected-source/revision/session-bound native transport and durable v3 machine/human reading history, plus explicit one-photo cloud consent, visibly unreviewed original comparison, uncertainty/provenance, separate human reading correction, effective local keyword search and same-operation cancellation/recovery. Corrections survive later processing; annotations and exact originals remain separate. Default production capability is disconnected; no accounts, provisioning, secrets UI or background vault upload were introduced.

Independently reviewed backend `6e81987` recorded 267 passing backend tests; native `7249249` recorded 152 passing Rust tests and 118 desktop tests before this UI work. These are separately run synthetic backend/native evidence, not live/installed acceptance. Renderer/browser delivery checks and screenshots are recorded in [reading evidence](implementation/claude-vault-reading/README.md). Independent UI and whole-branch reviews now pass through the scoped repair at `4437021`. Fresh repair suites passed 279 backend, 154 native and 260 client tests, plus 18 reading browser checks. [Draft PR #13](https://github.com/nrsandoval1231-oss/recall/pull/13) records exact-head CI and installer delivery; those are separate from installed/live acceptance. No paid/live call, private photo upload, real OS service credential, TLS deployment, installed Windows/iPhone, legacy-data migration, full semantic Ask/spine completion, merge or deployment is claimed. QR remains proposed.

### Local vault lifecycle, October 8 — implementation candidate

The [lifecycle plan](superpowers/plans/2026-10-08-local-vault-lifecycle.md) extends the local foundation with unique flat Markdown renames, explicit missing-note restore, logical removal retaining files/history, removed-items/history, current-state retry receipts and annotation-search rebuild. Native and UI tasks passed independent reviews after repairs through `f4332324d10d81ea06a202c815c02ad8d6cc0fd8`. Separately recorded native Linux suite: 113 passed; root client suite at that head: 229 passed. Delivery screenshot review additionally fixed a superseded capture success notice after removal, with component/browser regressions: fresh root suite 230 passed, local browser 16 passed, existing web browser 42 passed, lint/typecheck/desktop build passed. See [lifecycle delivery evidence](implementation/local-vault-lifecycle/README.md) for verification boundaries and limitations. Final review additionally repaired revision-zero decision-reload diagnostics and strengthened post-reload removed-history assertions; the linked lifecycle evidence records its fresh checks. [Draft PR12](https://github.com/nrsandoval1231-oss/recall/pull/12) carries scoped rereview and final exact-head CI/new installer delivery evidence as the coordinator verifies those gates; the prior PR11 artifact below is preserved separately. Authorized Windows desktop is offline, so installed acceptance remains blocked. No alternate desktop access or real-data operations occurred.

### Local desktop foundation, October 8 — historical accepted PR11 baseline

Native and renderer tasks were independently reviewed and repaired through `2210d1f`. Native Linux suite after final filename-search review repair: 76 passed, including synthetic filesystem checks. Root client suite at `2210d1f`: 186 passed (not rerun for that native-search/fixture repair). Separate browser-injected Tauri boundary journeys and current delivery checks are recorded in [local foundation evidence](implementation/local-vault/README.md). PR11 exact head `650e9eae6878b46673d81411789d02e9388077a0` passed [CI run 37708945255](https://github.com/nrsandoval1231-oss/recall/actions/runs/37708945255) and produced unsigned [artifact 11521925107](https://github.com/nrsandoval1231-oss/recall/actions/runs/37708945255/artifacts/11521925107) without cloud variables. Its retained ZIP file reference is `file_0000000099f081f599ed9c8fa1be3aa9`; producing/delivering it does not prove installed Windows acceptance or this newer lifecycle slice. No installed native UI, iPhone, live AI, real-data migration, release or deployment is claimed.

### Canonical browser Memory Surface, October 7

The first canonical browser slice implements sparse Home, Ask reconstruction, reversible memory/person focus, verified physical evidence, evidence-backed historical focus, scoped human correction and durable Capture in a warm glass/physical material system. It builds on PR #7 and the accepted browser contracts; PR #6 remains unmerged. Native adapters keep their existing offline/export/delete behavior. Development-only synthetic originals and screenshot evidence are isolated from production builds. See [implementation evidence and open gaps](implementation/memory-surface/README.md); this is not completion of the full canonical vision.

### Existing deployed browser pilot, October 6

The user selected a Cloudflare web app after native email sign-in failures. `apps/web` implements browser email-link callbacks, encrypted server session cookies, durable scoped photo drafts, retry-safe uploads, recent captures, Ask, and hash-verified cited originals. Root verification: 125 client tests passed, including 20 web tests; root lint/typecheck and web production build passed. Actual Wrangler runtime returned 200 for the app/callback with CSP and same-origin resource policy; private unauthenticated routes returned 401/no-store; foreign-origin login POST returned 403; arbitrary proxy routes returned 404. No email was sent by these probes.

Cloudflare `recall-web` is deployed at https://recall-web.nicksandoval201121.workers.dev with its server session secret; Supabase Site URL and scoped callback allowlist are saved. Hosted runtime probes confirmed app/callback 200 and private unauthenticated routes 401/no-store. Real signed-in browser upload/source access remains pending. AI processing remains disabled in production. Existing Supabase email quota was exhausted during earlier sign-in attempts; web deployment does not remove that provider limit. Native implementation below remains preserved. This records the older browser pilot, not deployment of the newer canonical Memory Surface; the local-only foundation now proceeds under owner authorization; pairing remains unanswered.

Live owner sign-in attempted at 23:35 CDT failed: Supabase auth logs record HTTP 429 `over_email_send_rate_limit` for the hosted callback. This confirms provider delivery rejection, not signed-in acceptance. No further email probes were sent during diagnosis. Custom SMTP or quota recovery would address the existing email flow only; it is not the proposed next step and cannot satisfy the new no-sign-in requirement.

- Capture: accepted durable Expo capture, ordered originals, hash verification, idempotent uploads and workspace isolation are preserved.
- Understand: durable bounded interpretation jobs and conservative validation remain intact. User overrides are applied before later machine revisions.
- Connect: universal entities/aliases, candidate mentions, explicit accepted/rejected identity, merge/split history and bounded relationships.
- Remember: append-only claim revisions, validity intervals, supersession and immutable original evidence.
- Recall: authorized keyword/entity/optional pgvector rank fusion; explicit historical `as_of`; cited Ask on desktop and mobile. Desktop exposes a historical date control. No fresh cloud synthesis is claimed offline.
- Correct: summary, transcription, claim text/status/validity, identity and relationships; expected versions and user attribution. Corrections enter the desktop outbox before network acknowledgment.
- Offline: scoped native SQLite/FTS, persistent cursor/outbox, downloaded-original inventory, snapshot recovery, conflicts, and source tombstones. Known authorization denial never falls back to private cache.
- Export: deterministic ZIP of canonical history/JSON, fenced Markdown and verified originals; optional native selected-root managed Markdown with local-edit conflict protection.
- Delete/restore: canonical removal and sync tombstones, durable byte purge, memory suppression against retries, owner workspace erase, tested PostgreSQL/object backup restore.

## Verification ledger

- Final client run: 94 passed (API 16, tokens 4, sync 30, desktop 35, mobile 9), with lint and typechecking clean. Rendered desktop tests cover correction durability/conflicts, identity/date/status payloads, deletion confirmation, managed export conflict, historical Ask and authorization denial. Desktop production build passes; iOS JavaScript bundle passes without signing or hardware proof.
- Native foundation CI run `37559687200`: Windows 31 passed plus cargo check; Linux 32 passed plus cargo check (includes Unix symlink case). The integrated PR additionally emits the measured FTS benchmark output.
- Backend CI run `37562821713` at code commit `63b89e5451f1363abcc0d69f3bc918450d543177`: 200 passed including pgvector, two client E2E tests and ten migration tests. Local full run: 192 passed, eight pgvector skips. Ruff, format and source mypy are clean. Includes four real-PostgreSQL Ask privacy race tests, three claim identity tests, three mention identity tests, relationship reprocessing/source-deletion coverage and timed cleanup/workspace rotation.
- Dependency audit remains a release gate: `npm audit --omit=dev` reports 22 advisories (15 high, seven moderate, zero critical), primarily Expo/Metro/configuration dependency paths. Current compatible transitive versions lack safe patches; automated suggestions downgrade the accepted Expo/RN stack. No forced downgrade or blind incompatible UUID override was applied. See SECURITY-AND-OPERATIONS.
- Clean and baseline-upgrade migrations are tested on real throwaway PostgreSQL. Accepted migrations 0001/0002 are unchanged.
- Synthetic SQL corpus: 13 items and 12 held-out questions. Actual local keyword SQL recall@1=0.25, recall@3=0.5833, MRR=0.4167. Fixed-vector pgvector fusion runs in CI. These synthetic vectors do not measure live embedding quality.
- Native FTS at CI run `37561900902`: 1,000 synthetic records loaded in 41 ms on Windows / 55 ms on Linux; searches took 451 Âµs / 650 Âµs respectively. This is a CI-runner microbenchmark, not a device or end-to-end latency guarantee.

## Requirement matrix

| Request | Status | Evidence or boundary |
| --- | --- | --- |
| 1 Audit accepted baseline | PASS | Canonical contracts inspected; baseline migration checksums preserved |
| 2 Architecture | PASS | Expo/Tauri/FastAPI/PostgreSQL/pgvector/SQLite retained |
| 3 Preserve RCL-001/002 | PASS | Existing capture, validation, lease, isolation and client E2E suites |
| 4 Universal entities | PASS | 0003; entity API and evidence-backed detail |
| 5 Conservative resolution | PASS | Candidate-only alias proposals; explicit acceptance; same-name regression |
| 6 Versioned claims | PASS | Canonical claim revisions, attribution, evidence, temporal intervals |
| 7 Corrections | PASS | Expected versions, actor audit, immutable revision history, reprocessing tests |
| 8 Relationships | PARTIAL | Extensible entity relations and correction; richer related-memory expansion remains limited |
| 9 Hybrid retrieval | PASS | Production SQL fusion/config/hash gates; provider quality remains OPEN |
| 10 Vague recall evaluation | PARTIAL | Synthetic held-out SQL/fixed-vector measurement; real semantic quality OPEN |
| 11 Temporal recall | PARTIAL | Relevant original/history/changed and strict ISO before/after, explicit as_of, validity/supersession labels; ambiguous relative dates abstain; live language quality OPEN |
| 12 Ask | PASS | Cited answer/uncertainty/abstention and source access; contextual conversation pronouns deferred |
| 13 Memory/review | PASS | Evidence/history/claims/corrections/identity review controls |
| 14 Library | PARTIAL | Kind/name views, source memories, accepted mention selection, relationship names and bounded claim timeline; richer conflict comparison deferred |
| 15 Resilient desktop | PASS | Native persistence/outbox/sync/version conflicts/snapshot/revocation tests |
| 16 Offline search | PASS | SQLite FTS/entities/recent/originals with honest local mode |
| 17 Portable export | PASS | Canonical histories, provenance, JSON/Markdown/original hashes |
| 18 Managed Markdown | PASS | Selected root, manifest/journal, path safety and local-edit conflicts |
| 19 Delete/purge | PARTIAL | Full capture/memory/workspace tested; interpreted multi-page partial page erase is safely refused |
| 20 Backup/restore | PASS | Real PostgreSQL restoration, graphs/history/hashes/sync and concurrent-delete maintenance gate |
| 21 Product UX | PASS | Today/Ask/Capture/Library/Memory flows; hardware usability OPEN |
| 22 Design system | PASS | Existing shared tokens preserved, evidence presentation extended |
| 23 Honest processing | PASS | Local/upload/worker/attention/error states remain real |
| 24 Security | PARTIAL | RLS/isolation, least privilege and adversarial tests pass; 22 dependency advisories remain; live configuration OPEN |
| 25 Deployment path | PARTIAL | Pilot API/worker, Supabase setup and Cloudflare browser deployment recorded below; authenticated end-to-end and full release acceptance remain OPEN |
| 26 Live AI | OPEN | No authorized live evaluation budget/private corpus used |
| 27 Physical devices | OPEN | No physical iPhone or installed Windows proof |
| 28 Performance | PARTIAL | Bounded media/results/caches/outbox/spend; synthetic SQL/FTS timings; device latency/memory OPEN |
| 29 Tests | PASS | Automated capture/interpretation/entity/temporal/retrieval/sync/export/delete suites |
| 30 Life journey | PASS | Daniel/Sarah/number correction/Aprilâ†’June current and historical server citations |
| 31 Documentation | PASS | Canonical implementation updates and explicit boundaries |
| 32 Hygiene | PASS | Synthetic fixtures, ignored private env files, deterministic lockfiles, bounded diffs |
| 33 Future scope | PASS | No voice/email/calendar/CRM/agent framework/team/billing expansion |
| 34 Execution | PASS | Coherent dependent build, ongoing tests and material review fixes |
| 35 Git/PR | PASS | Native foundation PR plus dependent integrated V1 PR |
| 36 Independent review | PASS | Adversarial deletion/correction/identity/export review; material findings fixed or safely restricted |
| 37 Definition of done | PARTIAL | Deterministic implementation exists; live trust/device/model quality still unproven |
| 38 Handoff | PASS | This ledger, exact PR checks and live gate procedures |

## Remaining gates and limitations

### Supabase pilot setup â€” 2026-10-06

Existing project `jjlkcligwhoxcbthkmov` was inspected empty, then repository migrations 0001â€“0006 were applied through authenticated MCP. All six rows in `public.schema_migrations` match the local file SHA-256 checksums. One MCP timestamp collision rolled back migration 0004; its subsequent retry succeeded. Platform hardening revoked public/anon/authenticated/service-role access to public tables, sequences and functions while preserving the application roles' intended helper access. Five mutable function search paths were pinned to `pg_catalog,public`.

Verified: all 28 public tables have enabled and forced RLS; zero direct client table grants; zero anon/authenticated callable Recall functions; private `recall-originals-private` bucket with a 25 MiB limit and JPEG/PNG/HEIC/HEIF types; no client Storage object policies. API/worker roles are separate, non-superuser and cannot bypass RLS. Runtime logins were subsequently enabled using independently generated credentials kept in ignored environment files; only SCRAM verifiers were submitted to SQL. Both roles connected successfully from disposable containers on the pilot host, and neither owns application tables. An API transaction inserted a synthetic workspace, verified owner visibility and exclusion of another user, then rolled back without persisting fixture rows. Worker cross-workspace behavior still relies on automated acceptance tests, not this live connection smoke test.

Owner subsequently authorized the proposed $25/month hosting and $5 total first AI trial limits. Dedicated DigitalOcean host `recall-pilot` was created at the verified $24/month list price, with Ubuntu 24.04, 2 vCPU / 4 GiB, Docker 29.1.3 and Compose 2.40.3. Firewall permits SSH and HTTPS/HTTP ingress; host/container IPv6 database connectivity is verified. Initial image built from `f23b0d4233a129c96350fbb8e4f433326eceb745`, then rebuilt with the CORS environment parsing fix (nine affected tests, Ruff/format/mypy passed). Current image digest is `sha256:25dd27ca910c6590a6e577e8529b9532366091fd5084715a8c330da9962270b5`. Compose validation passed; API is healthy, worker running, and Caddy serves valid HTTPS with external `/readyz` returning 200.

Ignored API/worker files now hold generated runtime database/signing credentials and the owner-supplied storage key; client files hold only public configuration. Auth JWKS returned one signing key; settings now confirm public signups disabled. Storage bucket readiness returned 200 and private=true. The designated pilot Auth account and private workspace are pre-provisioned; A supported Auth invitation was subsequently sent successfully after the installed desktop reported "Signups not allowed for this instance" for the unconfirmed pilot account. Ownership confirmation was subsequently verified through Auth; it was not bypassed. The shared client now explicitly disables automatic user creation (affected client tests/typecheck passed). Real authenticated client sign-in, source upload/download hash equality, live AI consent/budget configuration and physical-device acceptance remain OPEN. One authorized synthetic, empty-evidence provider call returned a correct abstention; no private source was sent. Its adapter omitted cache token costs, so the recorded base cost is not a complete billing figure. Explicit caching is being removed and durable budget reservations are being validated; production AI remains disabled. Hosting bills until deleted; $5 total AI authorization must not be treated as a recurring allowance.

At this historical cloud-pilot step, Windows CI conditionally built an unsigned NSIS installer with three public pilot configuration repository variables and retained its artifact seven days. No app release or signing claim is made. CI run 37567247613 passed all five jobs at a4619c2111041647aafd3efe10c613a745ea8c01. Its unsigned NSIS installer downloaded and installed with exit 0; the installed Windows app opened and rendered sign-in. Installer SHA-256: C4626890FAECCA9F36CB57D59D53A0F5CF39E46E242FB4F7AB77B7FDE803EDE6. Authenticated desktop use remains pending. Live dashboard inspection showed the free built-in email service locks template editing and sends a magic link, while the first binary expected an OTP. Commit 41f4758883f457bc193e26fc742692c20d17e864 adds pasted-link verification through the Supabase SDK with exact HTTPS provider-origin/path and action-type validation; it never follows the pasted URL. API-client tests (26), desktop tests (35), affected typechecks and ESLint passed. The updated installer passed all five CI jobs in run 37568967714, installed with exit 0, and reopened as a responding Recall process. SHA-256: 5789DDA94F5DB265E44018D311C7C883C2C0599C973273D8236D3145B284CD33. User verification of authenticated installed-runtime sign-in remains OPEN. Browser rendering cannot substitute for Tauri Credential Manager or native SQLite. The iPhone still requires compatible Expo Go for a preliminary smoke test or Apple-signed development build for device acceptance. Secret preflight handles LF/CRLF empty values and placeholders; API startup initially exposed the comma-list CORS parsing bug, which is covered for both comma and JSON environment values and wildcard rejection.

The post-setup Supabase security advisor retains an intentional deny-all migration-ledger informational notice and a pgvector public-schema warning. Extension relocation requires compatible schema/search-path validation before release; see [Supabase extension remediation](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public). This setup does not close the dependency security release gate or full deployment requirement.

Supply restricted-signup Supabase/Auth/private storage credentials, production API/worker hosting, explicit provider configuration and approved evaluation budget. Execute signed iPhone capture/retry/reconnect and installed Windows offline/correction/reconnect/export; compare original hashes across devices. Record real handwriting, material-number, entailment, conservative identity, vague retrieval, latency/cost and abstention results outside public Git.

Historical retrieval uses canonical claim history or the historical keyword projection. Current entity/vector projections are deliberately excluded, and combining historical questions with current identity filters is refused so later corrections cannot leak backward in time. Temporal intervals and supersession are explicit accepted data; a model date phrase is not silently turned into canonical chronology. Generic multi-turn conversation and automatic ambiguous pronoun resolution remain limited. Structurally ambiguous claims sharing the same source span are sent to review instead of silently merged.

Deleting interpreted memory retains its original capture and suppresses automatic re-reading. Partial source deletion before interpretation is supported and retry uses the new surviving-page fingerprint. A processed multi-page source can be removed only by deleting its full capture, preserving the invariant that unrelated human corrections are never silently discarded. Failed byte purge is bounded at ten attempts and needs operator inspection/retry; database memory is already inaccessible.

Portable server ZIP limits: 10,000 canonical rows, 16 MiB canonical metadata, 100 MiB per original, 512 MiB total. Native archive IPC accepts 32 MiB; larger archives remain portable ZIP downloads. Native cache has per-scope record/payload/source/outbox limits and refuses growth transactionally instead of discarding pending work. Managed export deletion occurs on the next export; arbitrary exported copies and provider retention cannot be remotely erased.

Backups freeze normal mutable transactions and byte purge during snapshot/copy. This is a deliberate pilot maintenance window. Restore only trusted operator backups to empty destinations. System plaintext export spools expire after 24 hours with a periodic 60-second cleanup loop and are deleted after a normal response; filesystem failures retry and need operator attention. The example API tmpfs accommodates two bounded exports and requires sufficient host RAM. Encrypted OS disks and appropriate account permissions remain deployment responsibilities.

### Provider budget follow-up — 2026-10-06

Migration 0007 extends the existing private reservation ledger to interpretation, repair and answer purposes. Calls reserve conservative input/output maxima under deployment-wide locking before provider dispatch, then settle observed usage. Unknown outcomes retain an infinite reservation for operator settlement; deletion never recreates private usage. Explicit Anthropic prompt caching was removed because cache-token costs were previously omitted. These changes are validated locally but not yet deployed, and AI remains disabled. Application estimates are not a provider billing-console or lifetime hard cap.

Validation: full backend run reached 196 passed / 8 pgvector skips / one stale migration-version assertion in the backup test. After updating that assertion, all three backup tests passed; Ruff check/format and mypy (44 source files) passed. Updated client full suite: 104 passed; full workspace typecheck and ESLint passed. CI run 37568967714 at 41f4758883f457bc193e26fc742692c20d17e864 passed all five jobs and supplied the installed corrected sign-in binary. Budget follow-up commit 331ba93 is pushed, with its CI and deployment pending; no paid processing was enabled.
