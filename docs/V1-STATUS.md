# Recall V1 implementation and acceptance

This is the implementation ledger for the V1 build from accepted baseline `92b4c33aafda412f89d745f38b87858f2d4b2837`. A PASS below means deterministic implementation evidence, not live product quality. Physical devices, live infrastructure and model quality have separate gates.

## What works

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
- Final local full backend run: 192 passed, eight pgvector skips; includes four real-PostgreSQL Ask privacy race tests. Ruff, format and source mypy are clean. Final integrated CI must supersede these counts and execute all pgvector cases. Focused structural claim identity tests pass (3); temporal tests pass (4); relationship reprocessing passes (1); timed cleanup/workspace rotation passes (2).
- Clean and baseline-upgrade migrations are tested on real throwaway PostgreSQL. Accepted migrations 0001/0002 are unchanged.
- Synthetic SQL corpus: 13 items and 12 held-out questions. Actual local keyword SQL recall@1=0.25, recall@3=0.5833, MRR=0.4167. Fixed-vector pgvector fusion runs in CI. These synthetic vectors do not measure live embedding quality.
- Native FTS at CI run `37561900902`: 1,000 synthetic records loaded in 41 ms on Windows / 55 ms on Linux; searches took 451 µs / 650 µs respectively. This is a CI-runner microbenchmark, not a device or end-to-end latency guarantee.

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
| 24 Security | PASS | RLS/isolation, least privilege, deterministic correction and negative tests; live configuration OPEN |
| 25 Deployment path | OPEN | Templates prepared; Docker image/hosting/Supabase deployment not executed |
| 26 Live AI | OPEN | No authorized live evaluation budget/private corpus used |
| 27 Physical devices | OPEN | No physical iPhone or installed Windows proof |
| 28 Performance | PARTIAL | Bounded media/results/caches/outbox/spend; synthetic SQL/FTS timings; device latency/memory OPEN |
| 29 Tests | PASS | Automated capture/interpretation/entity/temporal/retrieval/sync/export/delete suites |
| 30 Life journey | PASS | Daniel/Sarah/number correction/April→June current and historical server citations |
| 31 Documentation | PASS | Canonical implementation updates and explicit boundaries |
| 32 Hygiene | PASS | Synthetic fixtures, ignored private env files, deterministic lockfiles, bounded diffs |
| 33 Future scope | PASS | No voice/email/calendar/CRM/agent framework/team/billing expansion |
| 34 Execution | PASS | Coherent dependent build, ongoing tests and material review fixes |
| 35 Git/PR | PASS | Native foundation PR plus dependent integrated V1 PR |
| 36 Independent review | PASS | Adversarial deletion/correction/identity/export review; material findings fixed or safely restricted |
| 37 Definition of done | PARTIAL | Deterministic implementation exists; live trust/device/model quality still unproven |
| 38 Handoff | PASS | This ledger, exact PR checks and live gate procedures |

## Remaining gates and limitations

Supply restricted-signup Supabase/Auth/private storage credentials, production API/worker hosting, explicit provider configuration and approved evaluation budget. Execute signed iPhone capture/retry/reconnect and installed Windows offline/correction/reconnect/export; compare original hashes across devices. Record real handwriting, material-number, entailment, conservative identity, vague retrieval, latency/cost and abstention results outside public Git.

Historical retrieval uses canonical claim history or the historical keyword projection. Current entity/vector projections are deliberately excluded, and combining historical questions with current identity filters is refused so later corrections cannot leak backward in time. Temporal intervals and supersession are explicit accepted data; a model date phrase is not silently turned into canonical chronology. Generic multi-turn conversation and automatic ambiguous pronoun resolution remain limited. Structurally ambiguous claims sharing the same source span are sent to review instead of silently merged.

Deleting interpreted memory retains its original capture and suppresses automatic re-reading. Partial source deletion before interpretation is supported and retry uses the new surviving-page fingerprint. A processed multi-page source can be removed only by deleting its full capture, preserving the invariant that unrelated human corrections are never silently discarded. Failed byte purge is bounded at ten attempts and needs operator inspection/retry; database memory is already inaccessible.

Portable server ZIP limits: 10,000 canonical rows, 16 MiB canonical metadata, 100 MiB per original, 512 MiB total. Native archive IPC accepts 32 MiB; larger archives remain portable ZIP downloads. Native cache has per-scope record/payload/source/outbox limits and refuses growth transactionally instead of discarding pending work. Managed export deletion occurs on the next export; arbitrary exported copies and provider retention cannot be remotely erased.

Backups freeze normal mutable transactions and byte purge during snapshot/copy. This is a deliberate pilot maintenance window. Restore only trusted operator backups to empty destinations. System plaintext export spools expire after 24 hours with a periodic 60-second cleanup loop and are deleted after a normal response; filesystem failures retry and need operator attention. The example API tmpfs accommodates two bounded exports and requires sufficient host RAM. Encrypted OS disks and appropriate account permissions remain deployment responsibilities.
