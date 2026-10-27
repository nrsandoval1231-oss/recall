# Monolith architecture

## Text-file import — bounded local acceptance

[TEXT-FILE-01](../.agent/TEXT-FILE-01.md) adds one native UTF-8 `.txt`/`.md` adapter. Native owns file selection and bounded reading, saves exact original bytes with a durable operation intent, then commits a v8 memory through the existing journal. Versioned provenance retains the selected filename and source-derived semantic hash; original Markdown stays inert. Retry reuses the original operation and never silently substitutes a different file.

Organization, current/historical Ask and source opening reuse the accepted text paths. The organization HTTP contract, consent and backend storage remain unchanged. A file may fit the local capture limit but exceed the smaller AI input limit; it must still be saved and shown as locally available. V8 must preserve old vault bytes and continue supporting photos, typed notes, corrections and source verification after upgrade. Candidate 2aa36435 has independent bounded local acceptance; see the [exact evidence](../.agent/TEXT-FILE-01/COMPLETION.json). Voice is in native implementation after isolated offline feasibility; no recording capability in Monolith is accepted yet.

## Retained historical Ask — bounded local acceptance

The accepted [packet](../.agent/HISTORY-01.md) extends the existing protected Ask route with a versioned historical request. Native selects retained revisions and verifies originals under one vault lock; current eligibility still excludes removed, missing or conflicted memories. A later correction accompanies older wording as a cited counterpoint, or the incomplete pair is omitted. Current Ask keeps its v1 contract. Historical queries need no new vault format, index service or additional routine provider call.

History sharing requires an explicit workspace Ask-purpose policy upgrade; each device/vault still needs its separate exact grant. No existing consent silently expands. The UI resolves a clear calendar date locally or asks a short clarification before dispatch. Persist the resolved UTC cutoff with the operation and revalidate retained event hashes, current revisions and consent before dispatch, result display and source opening. The implementation is not yet independently accepted; live quality and event-based vague recall remain open.

## Current related memory — CONTEXT-01 bounded acceptance

The existing organizer can receive at most three current, source-verified vault excerpts with a new capture in one provider call. A newly versioned purpose consent is required; earlier source-only permission is not widened. Native freezes the selected evidence into the durable operation before dispatch and rechecks every selected target before publication. The backend validates supplied IDs and exact source/target quotations; it cannot choose paths or assert identity links.

V7 events snapshot native-resolved link basenames for deterministic historical replay. Current links are derived separately by verifying target revision, source, excerpt and current path. External Obsidian renames and corrections invalidate stale links and trigger journaled suppression; conflicting edits are preserved and incomplete repair is explicit. Monolith does not introduce an in-app rename workflow. Related-memory opening validates the bound source link, current target and original together under the selected-vault lock. See the [packet](../.agent/CONTEXT-01.md) and [replay decision](../.agent/CONTEXT-01-REPLAY-ADDENDUM.md). Exact candidate 4ec20fdb passed independent review; live quality and installed-device proof remain open.

## Automatic organization — ORGANIZE-01 bounded acceptance

The native runner carries a revocable selected-session guard through background batches and recovery. A cloned vault path alone is not authority to upload or publish after selection changes. Final journal promotion occurs under a short selected-session boundary, with no network wait while holding that lock. Native readiness is separate from server permission: interrupted local marker setup is explicit and recoverable with a fresh future-only fence; existing captures are never silently enrolled.

The accepted Ask connection supplies a separately named organize purpose with its own policy/decision epoch. A native opt-in fence distinguishes future captures from the existing vault. Capture saves the original and human note through the existing journal, while a recoverable intent allows a small runner to process eligible work after capture and on startup/refresh. No background service or second job system is introduced.

The service authenticates before reading bytes, checks the exact organization policy/epoch, validates source binding and reserves the shared provider budget. Text uses a semantic-only model response with a deterministic exact transcription; photo interpretation reuses verified vision input. Native revalidates source, revision, human text, selected vault and protected connection before journaling a v6 proposal. Unknown provider effects retain their budget reservation and require same-operation recovery. Corrections suppress stale current semantics. The [accepted review](../.agent/ORGANIZE-01/REVIEW.json) covers this bounded source-local implementation, not live provider or installed-device acceptance.

## Grounded local-vault Ask — bounded acceptance

Native selects and verifies current, active, conflict-free vault records under the vault lock. It constructs at most eight 1,500-byte exact excerpts, preferring current human text/corrections over machine reading, and binds source hashes, revisions, evidence kinds and coverage to a durable operation under `Monolith/_meta/ask`. The renderer supplies only the selected-vault token, operation ID and question. A fixed HTTPS transport uses a separate OS-protected `vault_intelligence` credential; the photo credential cannot authorize this operation. (Vaults created before the rename keep their `Recall/` folder and `[[Recall/Sources/...]]` links unchanged; see "Naming and legacy identifiers" in `docs/DEVELOPMENT.md`.)

The inference profile authenticates before reading content, validates the bounded request, reserves the existing shared budget and calls the existing answer provider. It does not query legacy cloud memory. Receipt identity binds workspace/device/vault/operation and canonical payload SHA-256. Recovery uses the same operation; unknown outcomes retain budget holds. Private results expire within 24 hours, while terminal metadata prevents duplicate dispatch. Native revalidates selected evidence and connection/session identity before displaying an answer. Ask never mutates canonical memory.

For photos, query relevance chooses between the human annotation and effective reading; ties favor the reading. Corrections suppress stale machine text in both ranking and excerpts. The bounded selector includes all eligible records up to eight; above eight it ranks any-term matches deterministically. Long sources use exact UTF-8 query-near windows. Record selection, shortened excerpts and current-only history coverage are disclosed separately. Citation membership/schema validation does not prove semantic entailment; held-out live quality remains required. See [wire contract](API-CONTRACT.md#local-vault-ask--intelligence-01) and [active packet](../.agent/INTELLIGENCE-01.md).

## No-sign-in target and local foundation

No account/password/email-link sign-in is permitted in the target, including first use. Private local-only use needs no remote account. The bounded PAIR-01 path adds optional manually approved, inference-only device association; it is device authorization, not remembered account login. One-time QR pairing remains proposed. Public private-data APIs continue authenticating and authorizing requests.

The [RCL-005B design](superpowers/specs/2026-10-07-rcl-005b-no-signin-vault-design.md) now has an authorized bounded local-only implementation. Desktop defaults to a native selected-vault adapter; cloud entry is lazy-loaded only with `?mode=legacy-cloud`. Existing cloud database authority, deployed email authentication and API contracts remain intact; no real-data migration or deployment occurred.

## Required target: Obsidian as the memory spine

Product decision, October 7, 2026: **Obsidian is required as Monolith's user-owned memory spine.** This supersedes the earlier database-as-canonical/optional-vault architecture. Monolith is the capture, intelligence and Memory Surface layer over an Obsidian vault.

The vault owns durable memory: readable Markdown, links, original attachments and versioned structured metadata sufficient to preserve IDs, provenance, uncertainty, corrections, temporal history and deletion state. Markdown prose alone is insufficient. Users can read and edit their memory in Obsidian without Monolith, and those edits must enter explicit, conflict-safe reconciliation rather than remain disconnected exports.

PostgreSQL/pgvector remain useful for authenticated operations, jobs, authorization, synchronization and rebuildable memory/search projections. SQLite remains a local cache/outbox. Private object storage can hold authorized replicas of vault originals. Operational permissions and credentials stay in protected services, not editable vault text; an edited note cannot grant access. The LLM proposes interpretations and answers, never owns memory or writes arbitrary files.

Required target path:

```text
Capture -> durable original/outbox -> authorized, recoverable vault commit
                                       |
                                Obsidian memory spine
                                notes + links + originals
                                versioned provenance/history
                                       |
                            validated service projections
                            PostgreSQL / search / SQLite
                                       |
                              grounded Memory Surface
```

Vault association is required per workspace. Local capture may precede vault availability, but vault-pending state must remain explicit. Obsidian itself need not be running for an authorized adapter to access the vault; integration must not require a paid sync subscription or community plugin. Browser/mobile access needs a scoped vault bridge or replica transport, not unrestricted filesystem access. The [RCL-005B design proposal](superpowers/specs/2026-10-07-rcl-005b-no-signin-vault-design.md) specifies transport/conflict requirements. The local foundation is implemented; PAIR-01 implements a manual owner-approved photo-inference association. Phone-to-vault transport remains unimplemented and QR pairing remains proposed.

Migration must prove journaled crash-safe writes, versioned/idempotent operations, direct-edit ingestion, conflict preservation, immutable evidence, authorization, deletion/tombstone reconciliation and recovery of semantic/search projections from the vault. Preserve current contracts and data until migration and rollback are verified. A one-way export does not meet acceptance.

## Implemented local desktop subset

The accepted TEXT-01 local implementation extends this boundary with `vault_capture_text(expectedVaultId, operationId, text)`. It preserves exact UTF-8 source bytes before journaled v5 publication, returns the existing memory DTO, and serves the original as `text/plain; charset=utf-8`. Native validation derives `.txt` paths and rejects text at the photo-inference boundary. The desktop renders original text inertly, keeps retry payloads stable, and supports the same correction, direct-edit reconciliation, history and lifecycle operations. V1-v4 renderer bytes remain unchanged. See `.agent/FINISH-02/TEXT-COMPLETION.json` for exact acceptance rather than inferring it from this contract.

`local_vault.rs` owns native folder/photo pickers and exposes narrow status/select/capture/list/correct/source/history and rebuild/restore-note/remove commands. Every selected-vault command requires the ephemeral `expectedVaultId`; the stable `vault_identity` only namespaces pending import intents. Renderer paths cannot authorize access. New memory authority is `Monolith/Sources/<uuid>.<type>`, `Monolith/Memories/<uuid>.md` (or a validated same-folder renamed basename), append-only `Monolith/History/<uuid>/<revision>.json`, and versioned manifest/journal/commit metadata under `Monolith/_meta`. Retained publication backups support conflict diagnosis. No entity/AI or cloud domain model is replaced.

Native validation checks source hashes, full history and metadata before search/evidence eligibility. Cooperating writers lock the vault; staged create-only publication, flushes, receipts and retained prior versions support retry/restart. Direct body edits become `human:obsidian` revisions on refresh. Stale corrections require explicit reload/review. A unique stable-ID note renamed within direct `Monolith/Memories/*.md` remains usable and corrections retain its basename. Missing notes require explicit restore or removal; restore creates a new revision only after fresh absence validation. Logical removal appends a terminal tombstone while retaining files/history and excludes active search/evidence. Removed history remains inspectable independently of source eligibility. Duplicate/header-modified notes, nested moves, damaged originals and conflicted pending publication remain diagnostics; some require manual recovery. An unrelated nested directory can conservatively block an apparent missing-note decision. Local search matches human annotations, effective saved photo readings, source filenames and validated Markdown basenames. Explicit rebuild uses the same locked recovery/reconciliation/projection boundary as list, with no index database. Failed rebuild retains previously rendered rows visibly marked unverified. This is vault keyword reconstruction, not semantic reconstruction or OCR. See [lifecycle evidence and durability limits](implementation/local-vault-lifecycle/README.md).

Lifecycle mutations use versioned v2 records behind a durable manifest writer-version fence; v3 added selected-photo reading history; the current candidate v4 renderer adds organized note properties and content. Unchanged older-version reads preserve their prior bytes. New versioned writes retain the prior manifest before publishing, and older binaries must refuse newer vault versions; downgrade is unsupported. Parent hashes use stored predecessor bytes, not reserialized extended DTOs. Synthetic compatibility checks use separate copies, never real vaults.

Recovery orders pending events by memory/revision and validates parents; forks remain conflicts. Historical receipts return the current authoritative state, including terminal deletion, rather than replaying a stale mutation. `expectedState` binds active/missing removal decisions in addition to revision; restore/remove retries preserve the original operation payload until explicit current-state review. Decisions survive focus navigation and cancelled selection within a session, not full application restart. No physical erasure, undelete or automated conflicted-journal repair is included. See [lifecycle evidence and limits](implementation/local-vault-lifecycle/README.md).

## Selected-photo Claude reading — bounded implementation

Claude full-page vision is the primary local-photo understanding path. The protected service implements [the selected-photo HTTP contract](API-CONTRACT.md), reusing the existing provider, derivative/schema validation and durable consent/budget ledger. Default device authorization denies access before photo-body/provider work. Synthetic tests inject device principals. Production use is limited to the explicitly owner-associated device and configured inference-only service; CI and synthetic evidence do not establish general enrollment or other-device access. Service receipts are operational deduplication/recovery state, never canonical captures/memories. Normalized result content expires after 24 hours; metadata/status/budget tombstones remain fenced. Original bytes, derivatives and raw model output are not durably stored by this service; backups/WAL have their separate retention limits.

Native commands read only the selected preserved image, bind its hash/revision/session and stable vault identity, and use an OS-protected scoped credential with a fixed HTTPS origin. Pairing preparation/claim/status/disconnect are explicit device-scoped commands; there is no renderer-controlled provider-key, origin or arbitrary connection setter. The renderer supplies memory/revision/operation IDs and correction text, never paths, origins or credentials. Network calls occur outside vault/selection locks; source/revision/removal/conflict/rename/session/cancellation checks run before promotion. A missing/invalid connection disables new Claude readings while local capture, annotation, evidence and search stay usable without an account.

Machine proposals and separate human reading corrections use journaled v3 history and Markdown. The v3 writer fence retains exact v1/v2 manifests/history; older writers must refuse the newer vault. Human corrections (including intentionally empty text) govern effective reading/search and survive reprocessing. Direct Obsidian editing supports the human annotation region; generated reading/correction/provenance edits remain conflicts and transcription correction uses the explicit command. Local keyword rebuild now includes effective saved readings; it is not semantic retrieval or fresh offline generation.

The UI confirms sending **one selected photo**, labels proposals **Unreviewed machine reading**, shows original comparison/uncertainty/provider/source attribution, and separates reading correction from annotation. Reading operations remain native-durable. Explicit retry/recovery may GET then resend the same operation/photo after a missing receipt, with fresh native checks and connection fingerprint; admitted in-flight/unknown provider work is never resubmitted. Complete local receipts can commit without a new upload. Cancellation prevents uncommitted local promotion, preserves possible processing/charge status, and restores validated interrupted generated publication; actual concurrent human edits remain conflicts. View/session guards reject late renderer responses. See [layered evidence and remaining gates](implementation/claude-vault-reading/README.md).

### Automatic photo organization renderer — bounded local acceptance

The current implementation packet adds a versioned v4 Markdown renderer for successful photo readings. It deterministically organizes the already validated extraction into readable summary, source-local mentions, source-linked statements, suggested actions, uncertainty and flat properties. Source-derived values are escaped and quoted; the model cannot select paths or create arbitrary links. Original bytes, reading provenance and append-only history remain authoritative. Existing v1-v3 renderer output remains byte-compatible, older writers refuse v4, and existing vaults are not bulk-migrated. A human transcription correction suppresses machine-derived organization from current search while preserving historical proposals. Name matches never create cross-note identity links. The exact REALIGN-01 candidate passed compatibility, recovery, reconciliation and projection tests plus independent review; see `.agent/REALIGN-01/COMPLETION.json`. This bounded result does not establish automatic processing of every new capture or the full product.

The format is selected from the event/version already being written, so replay of a v1-v3 record uses its original renderer. A new v4 publication occurs in the existing journal/receipt transaction and retains prior manifest bytes for downgrade diagnosis. Direct edits to the managed organization block conflict rather than being replaced; supported human annotation edits continue through the existing reconciliation path. Human transcription correction suppresses stale machine-derived semantic content from the active rendered projection/search, while all prior readings remain inspectable in history. No cross-note identity is created from names.

The primary experience keeps everyday capture/search/recent memories visible and moves maintenance actions into an accessible settings/disclosure area. This UI simplification is a separate implementation step and does not imply semantic Ask or other capture adapters are complete.

## Legacy cloud V1 implementation — pre-migration

The active pilot client is a responsive React web app served by a Cloudflare Worker. The Worker holds encrypted HttpOnly session cookies, validates the Supabase email callback, and proxies only the fixed Monolith API origin. Browser tokens are removed from callback URLs before network redemption. Canonical PostgreSQL, private originals, and the Python API/worker remain unchanged. Browser IndexedDB is a workspace-scoped original-draft outbox, not the native SQLite cache or an offline generative service. Pending drafts survive logout and have explicit confirmed removal controls. Deployment and live browser acceptance are tracked separately in V1-STATUS.

Migrations 0003–0006 extend the accepted capture/worker architecture. Canonical entities, mentions, relationships, claims and append-only claim revisions remain relational PostgreSQL records. User overrides take precedence when rebuilding interpretations and search projections. Retrieval combines authorized keyword, alias/entity and optional pgvector lanes; configuration/revision/hash checks exclude incompatible or stale vectors.

Desktop Rust owns scoped SQLite, FTS, downloaded-original inventory, outbox and cursor persistence. Provider calls remain outside database transactions. Pilot transactions use a per-workspace advisory lock for coherent mutations/snapshots. Backup takes an exclusive global maintenance gate; API, worker and purge operations take its shared form before accessing mutable state. This intentionally favors consistency over maximum pilot throughput.

See [V1-STATUS](V1-STATUS.md) for verification boundaries; proposed future capabilities below are not all implemented.


Version: 0.2 | 2026-10-07 | Obsidian target required; database baseline below describes current implementation

## 1. Legacy cloud implementation ownership and topology

```text
Expo mobile ------------------+
                              |
Tauri desktop ----------------+--> authenticated Memory API
  |                           |        |             |
  +-- SQLite cache/outbox     |        |             +--> durable worker
  +-- downloaded originals    |        |                        |
  +-- safe Markdown exporter  |        v                        v
                              |   Cloud Postgres         AI provider
Future adapters --------------+   + pgvector              (bounded calls)
                                  |
                                  +-- private source-object metadata
                                                |
                                         private object storage
```

Solid implementation scope is mobile, desktop, API, worker, database, storage, cache, and export. Assistant/connectors are future adapters and must not be dependencies of the first build.

In the legacy cloud code, Postgres records accepted interpretation/history and object storage holds originals; SQLite is a working copy/outbox and Markdown is a one-way projection. This is the pre-migration implementation, not the required target ownership. The target vault must preserve durable memory/history and support rebuilding semantic projections. AI and indexes remain replaceable derived machinery.

## 2. Stack decisions

| Component | Decision | Reason and boundary |
| --- | --- | --- |
| Mobile | Expo / React Native / TypeScript, iOS first | Purpose-built camera and import flow; actual device and signed-build acceptance required |
| Desktop | Tauri 2 / React / TypeScript, Windows first | Native scoped vault access by default; legacy cloud mode retains SQLite/cache and managed export |
| Shared clients | Contracts, generated API types, design tokens, sync protocol | Share behavior and language, not an assumption of identical React Native/DOM components |
| API | FastAPI | Authentication, validation, domain commands, retrieval, and source authorization |
| Worker | Separate process from the same Python package | Durable jobs survive request completion; no in-process-only background processing |
| Memory spine (required target) | Obsidian vault | Local desktop implements original images, human notes/history and supported direct-body-edit reconciliation; full semantic reconstruction, phone synchronization and legacy migration remain open |
| Supporting cloud state | Managed PostgreSQL with pgvector | Operational services and rebuildable retrieval projections; currently authoritative until vault migration |
| Legacy cloud identity/storage | Supabase Auth and private Storage | Existing email-auth baseline only; local desktop use has no remote account and proposed synchronization authenticates paired devices |
| Local state | Vault files by default; SQLite in legacy cloud mode | Local notes/originals/history and validated in-memory keyword view; legacy SQLite cache, full-text search, pending operations and export manifests |
| AI | Claude full-page vision is primary for photo reading; one configured multimodal model | Explicit selected-photo cloud boundary; evaluate on handwriting; no OCR engine, router, or speculative model menu. Legacy cloud retrieval retains its optional embedding model. |

Pin supported dependency versions and lockfiles in the first executable packet. Do not hardcode a recalled "latest" model or SDK version into a production manifest. Primary documentation is indexed in [REFERENCES](REFERENCES.md).

## 3. Backend boundaries

One Python package contains bounded modules:

- `api`: request/response validation, auth, status mapping, and transport only.
- `domain`: application commands, policy, versions, corrections, and ownership invariants.
- `ingestion`: durable job handling, image derivatives, provider adapter, schema/semantic validation, and deterministic commit.
- `retrieval`: authorized candidate search, rank fusion, evidence selection, answer constraints, and citation validation.
- `sync`: cursor feed, supported operations, version conflicts, deletion tombstones, and snapshot recovery.
- `exports`: server export snapshots and portable manifests; desktop owns actual local filesystem writes.
- `db`: persistence, transactions, migrations, and database security context.

The API and worker reuse these modules. Do not split them into separately deployed microservices. This describes the current hosted worker. The implemented bounded local vault adapter supports local commitment/reconciliation/annotation keyword search without requiring that worker; cloud AI stays optional and separately consented.

## 4. Legacy cloud capture write path — migration pending

1. Mobile copies each selected/camera image from its temporary URI into app-private durable storage before acknowledging local Save. Persist the ordered manifest and a client-generated UUID operation ID.
2. The authenticated API creates or reuses a capture using workspace-scoped idempotency. It returns narrowly scoped upload authorization.
3. Upload originals to non-overwritable keys assigned by the server. Clients do not choose arbitrary object paths. (RCL-001 decision: the upload is a server-mediated `PUT` using a short-lived signed capability, so the server hashes and validates bytes *before* storing them; see API-CONTRACT "RCL-001 implementation details".) Originals are defined as the bytes received from the selected camera/import asset; record any platform conversion before intake.
4. Server finalization checks ownership, count/order, media type, size, and server-computed SHA-256. Only then is the capture "Uploaded".
5. In the same database transaction, create a durable processing job. The source remains viewable if AI is disabled or fails.
6. A worker claims the job with a lease, creates separately hashed/oriented derivatives when needed, and sends only authorized necessary content to the selected provider.
7. Validate returned structure and semantics. Preserve unresolved fields. Commit accepted derived rows and a sync event atomically.
8. Search indexes and exports consume the committed revision. Partial indexing cannot make obsolete or unauthorized claims eligible for answers.

See [API-CONTRACT](API-CONTRACT.md) and [AI-INGESTION](AI-INGESTION.md) for contracts and failure behavior.

## 5. Durable processing without extra infrastructure

Start with a Postgres jobs table. Claim eligible work in a short transaction using row locks and `SKIP LOCKED`, then perform the model call outside the transaction. Store attempt, lease owner, lease expiry, model/config version, and input fingerprint. Heartbeat or reclaim expired leases.

Use bounded retries and backoff. A lease token must still match at commit; a worker whose lease was replaced cannot commit late results. Uniqueness on capture/input revision/processor version prevents duplicate committed interpretations. At-least-once execution does not justify duplicate memories.

On a crash after the provider call but before commit, a retry may repeat a billed request. Record that possibility and cap attempts; do not promise exactly-once external charging. Duplicate queued requests must not independently schedule new work.

No Redis/Celery/Kafka is required for the pilot. Revisit only if measured throughput or job semantics justify it.

## 6. Retrieval and answers

Filter workspace, authorization, deletion state, and current eligible revision before material enters ranking or an LLM context. Search entity aliases and full text first. Add pgvector only after keyword/evidence acceptance is measured.

For the pilot, exact vector search over the authorized candidate set is acceptable. Add approximate indexes only when needed and evaluate the effect of filters on recall. Model changes require versioned embeddings; dimensions and vector spaces cannot be silently mixed.

An answer package contains text, supporting memory revision and source-page identifiers, source excerpts, and limitations. Citation IDs are resolved by the server from retrieved evidence, never invented by the model. A valid citation ID alone does not establish entailment: evaluate whether the claim is actually supported and preserve the source's epistemic status.

If the provider is unavailable, return source search results with a clear explanation rather than manufacturing an answer. Offline desktop offers cached text search, not cloud semantic retrieval or fresh synthesis.

## 7. Auth and authorization

Current pre-migration clients use provider sign-in; continue validating issuer, audience, expiry, and signature server-side. This is existing behavior, not the target UX. Target local use relies on the device/OS boundary, while optional synchronization requires owner-authorized device identities without account/password/email-link sign-in. PAIR-01 authorizes a manual, inference-only device association; QR pairing remains proposed. Do not disable existing API authentication to approximate the target. Store refresh credentials in OS-protected storage, not ordinary SQLite rows, logs, or frontend bundles. API clients receive neither direct database write credentials nor provider/service-role keys.

Use workspace membership checks in the API plus database RLS/least-privilege roles as defense in depth. A pooled database connection must establish request context transaction-locally and clear it at transaction end. Do not accidentally deploy the API as a database owner that bypasses the intended policy.

The worker's elevated access is narrowly scoped by code and tests to its claimed workspace/capture. Storage buckets remain private. Read URLs, when used, are short-lived bearer capabilities with explicit TTL limits.

## 8. Legacy cloud synchronization and local files — migration pending

A versioned change feed updates desktop SQLite. Client commands carry operation IDs and expected entity/record versions. Source downloads are separately tracked and hash-verified. Offline originals are not implied by a cached record.

The desktop is the local bridge; there is no separate always-on service in V1. It exports only into a selected managed vault root while running. See [SYNC-AND-EXPORT](SYNC-AND-EXPORT.md) for conflict, cursor, and deletion rules.

## 9. Alternatives intentionally rejected

**Canonical local Postgres:** makes phone capture and cloud integrations depend on a specific desktop or a second synchronization system. Local Postgres remains appropriate for developer tests, not canonical user memory.

**Unversioned Markdown-only transactions:** are insufficient for concurrency, correction precedence, authorization and offline reconciliation. This rejects unsafe file mutation, not the required Obsidian spine. Vault notes need stable IDs, structured history, journaled writes and validated synchronization; service databases can supply operational guarantees without exclusively owning memory.

**Separate graph/vector/queue services:** create operating overhead before workload evidence warrants it. Relational entity links, pgvector, and a jobs table are sufficient starting boundaries.

## 10. Universal product boundary

Core services operate only on universal captures, sources, memories, entities, relationships, statements, actions, and temporal/provenance records. Domain-specific experiences are projections/adapters. Do not fork storage or retrieval into separate schemas for maintenance, sales, education, travel, or other verticals.

Obsidian is the required memory spine. Capture, Ask, correction and synchronization must operate over vault-backed memory through authorized adapters. Monolith must preserve its universal model and simple Memory Surface without exposing vault organization as mandatory user work.

The architecture must allow later source adapters (voice, screenshots, files, links, connected apps) to enter through the same trusted source-memory boundary and later assistant surfaces to access memory through the same authenticated API/tool contract.

## 11. Rollout boundary

The historical rollout started with authenticated capture through both client shells, then a source-backed answer. Subsequent owner direction authorized the bounded local-only RCL-005B plan and its implementation without routine stage approvals. PAIR-01 implements one owner-approved selected-photo inference association while local-only use remains available; live pairing and connection evidence is recorded separately from source-only code/CI claims. The lifecycle slice adds retained tombstones, flat renames, missing-note restore and annotation rebuild. The v4 organization renderer, v5 text capture and current-vault Ask have bounded local acceptance; automatic future-capture organization also has bounded acceptance; current related-memory links also have bounded acceptance, and anchored retained historical Ask has bounded acceptance. UTF-8 text-file import has bounded acceptance at 2aa36435; native voice implementation is active after offline feasibility. Full semantic reconstruction, phone-to-vault transport, secure purge/undelete and legacy migration remain unfinished; QR pairing remains proposed. Paid provisioning, operational migration, deployment, merge and public launch require separate owner authorization.

## 12. DigitalOcean inference operations boundary

The DO inference runtime is a private operational service for explicitly authorized selected-photo processing. Its PostgreSQL tables hold device grants, consent, budget reservations and receipts; original bytes and durable memory remain in the owner-controlled Obsidian vault. The profile has no legacy worker, Supabase storage, general capture API or vault migration path. API, migration-owner and superuser operator credentials are separate; only the API login enters the API container.

The isolated Compose and recovery contract is documented in [infra/do-inference](../infra/do-inference/README.md). Database preflight checks the exact migration ledger, role grants, table ownership, required security functions and forced RLS before API startup. Restore always activates an external hold. An operator must reconcile actual provider usage and pending vault operations, revoke old grants and require fresh pairing before clearing that hold. These controls define an implementation boundary; they do not establish live DigitalOcean readiness, backup availability, activation, or deployment.
