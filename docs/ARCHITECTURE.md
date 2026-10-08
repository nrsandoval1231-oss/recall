# Recall architecture

## No-sign-in target and local foundation

No account/password/email-link sign-in is permitted in the target, including first use. Private local-only use needs no remote account. Recommend a local vault adapter and rebuildable local search first, with optional owner-paired private synchronization. Pairing is device authorization, not remembered account login; the one-time QR interaction is explicitly unresolved. Public private-data APIs must continue authenticating and authorizing requests.

The [RCL-005B design](superpowers/specs/2026-10-07-rcl-005b-no-signin-vault-design.md) now has an authorized bounded local-only implementation. Desktop defaults to a native selected-vault adapter; cloud entry is lazy-loaded only with `?mode=legacy-cloud`. Existing cloud database authority, deployed email authentication and API contracts remain intact; no real-data migration or deployment occurred.

## Required target: Obsidian as the memory spine

Product decision, October 7, 2026: **Obsidian is required as Recall's user-owned memory spine.** This supersedes the earlier database-as-canonical/optional-vault architecture. Recall is the capture, intelligence and Memory Surface layer over an Obsidian vault.

The vault owns durable memory: readable Markdown, links, original attachments and versioned structured metadata sufficient to preserve IDs, provenance, uncertainty, corrections, temporal history and deletion state. Markdown prose alone is insufficient. Users can read and edit their memory in Obsidian without Recall, and those edits must enter explicit, conflict-safe reconciliation rather than remain disconnected exports.

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

Vault association is required per workspace. Local capture may precede vault availability, but vault-pending state must remain explicit. Obsidian itself need not be running for an authorized adapter to access the vault; integration must not require a paid sync subscription or community plugin. Browser/mobile access needs a scoped vault bridge or replica transport, not unrestricted filesystem access. The [RCL-005B design proposal](superpowers/specs/2026-10-07-rcl-005b-no-signin-vault-design.md) specifies a reviewable transport and conflict approach; its local foundation is implemented, while phone transport/pairing remains proposed.

Migration must prove journaled crash-safe writes, versioned/idempotent operations, direct-edit ingestion, conflict preservation, immutable evidence, authorization, deletion/tombstone reconciliation and recovery of semantic/search projections from the vault. Preserve current contracts and data until migration and rollback are verified. A one-way export does not meet acceptance.

## Implemented local desktop subset

`local_vault.rs` owns native folder/photo pickers and exposes narrow status/select/capture/list/correct/source/history and rebuild/restore-note/remove commands. Every selected-vault command requires the ephemeral `expectedVaultId`; the stable `vault_identity` only namespaces pending import intents. Renderer paths cannot authorize access. New memory authority is `Recall/Sources/<uuid>.<type>`, `Recall/Memories/<uuid>.md` (or a validated same-folder renamed basename), append-only `Recall/History/<uuid>/<revision>.json`, and versioned manifest/journal/commit metadata under `Recall/_meta`. Retained publication backups support conflict diagnosis. No entity/AI or cloud domain model is replaced.

Native validation checks source hashes, full history and metadata before search/evidence eligibility. Cooperating writers lock the vault; staged create-only publication, flushes, receipts and retained prior versions support retry/restart. Direct body edits become `human:obsidian` revisions on refresh. Stale corrections require explicit reload/review. A unique stable-ID note renamed within direct `Recall/Memories/*.md` remains usable and corrections retain its basename. Missing notes require explicit restore or removal; restore creates a new revision only after fresh absence validation. Logical removal appends a terminal tombstone while retaining files/history and excludes active search/evidence. Removed history remains inspectable independently of source eligibility. Duplicate/header-modified notes, nested moves, damaged originals and conflicted pending publication remain diagnostics; some require manual recovery. An unrelated nested directory can conservatively block an apparent missing-note decision. Local search matches human notes, source filenames and validated Markdown basenames. Explicit rebuild uses the same locked recovery/reconciliation/projection boundary as list, with no index database. Failed rebuild retains previously rendered rows visibly marked unverified. This is annotation keyword reconstruction, not OCR or semantic reconstruction. See [lifecycle evidence and durability limits](implementation/local-vault-lifecycle/README.md).

Lifecycle mutations use versioned v2 records behind a durable manifest writer-version fence. Unchanged v1 reads preserve exact manifest/history bytes; the first v2 write retains `_meta/manifest-v1.json` and changes the manifest before publishing v2 operations. Parent hashes use stored predecessor bytes, not reserialized extended DTOs. Older foundation binaries must refuse a v2 vault; downgrade is unsupported. Synthetic compatibility testing must use separate copies, never real vaults.

Recovery orders pending events by memory/revision and validates parents; forks remain conflicts. Historical receipts return the current authoritative state, including terminal deletion, rather than replaying a stale mutation. `expectedState` binds active/missing removal decisions in addition to revision; restore/remove retries preserve the original operation payload until explicit current-state review. Decisions survive focus navigation and cancelled selection within a session, not full application restart. No physical erasure, undelete or automated conflicted-journal repair is included. See [lifecycle evidence and limits](implementation/local-vault-lifecycle/README.md).

## Legacy cloud V1 implementation — pre-migration

The active pilot client is a responsive React web app served by a Cloudflare Worker. The Worker holds encrypted HttpOnly session cookies, validates the Supabase email callback, and proxies only the fixed Recall API origin. Browser tokens are removed from callback URLs before network redemption. Canonical PostgreSQL, private originals, and the Python API/worker remain unchanged. Browser IndexedDB is a workspace-scoped original-draft outbox, not the native SQLite cache or an offline generative service. Pending drafts survive logout and have explicit confirmed removal controls. Deployment and live browser acceptance are tracked separately in V1-STATUS.

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
| AI | One multimodal provider/model plus one embedding model | Evaluate on handwriting first; no router, agent framework, or speculative model menu |

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

Current pre-migration clients use provider sign-in; continue validating issuer, audience, expiry, and signature server-side. This is existing behavior, not the target UX. Target local use relies on the device/OS boundary, while optional synchronization requires owner-authorized device identities without account/password/email-link sign-in. QR association awaits approval; see the RCL-005B proposal. Do not disable existing API authentication to approximate the target. Store refresh credentials in OS-protected storage, not ordinary SQLite rows, logs, or frontend bundles. API clients receive neither direct database write credentials nor provider/service-role keys.

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

Obsidian is the required memory spine. Capture, Ask, correction and synchronization must operate over vault-backed memory through authorized adapters. Recall must preserve its universal model and simple Memory Surface without exposing vault organization as mandatory user work.

The architecture must allow later source adapters (voice, screenshots, files, links, connected apps) to enter through the same trusted source-memory boundary and later assistant surfaces to access memory through the same authenticated API/tool contract.

## 11. Rollout boundary

The historical rollout started with authenticated capture through both client shells, then a source-backed answer. Subsequent owner direction authorized the bounded local-only RCL-005B plan and its implementation without routine stage approvals. That desktop foundation is implemented; exact-head delivery verification and installed-device acceptance remain separate gates. The lifecycle slice adds local retained tombstones, flat renames, missing-note restore and annotation rebuild. Full semantic reconstruction, phone synchronization, secure purge/undelete and legacy migration remain unfinished; QR pairing is unanswered and excluded. Finish the remaining full-spine, isolation, restore and real-device evidence before calling the full pilot ready. Paid provisioning, operational migration, deployment, merge and public launch require separate owner authorization.
