# Recall architecture

> **CURRENT PILOT DIRECTIVE — 2026-10-09.** [Pilot Product Contract](PILOT-CONTRACT.md) governs this document wherever older text conflicts. The pilot is a **single iPhone Home Screen installable web app (PWA) and Windows browser app**, **no login or email-auth UI**, with **secure operator provisioned revocable private device access**. Keep the canonical Memory Surface, original evidence and provenance. Native Expo/Tauri flows are **not pilot prerequisites**; earlier email login / deployment / test narratives are **historical**, not current instructions. The separately mentioned visual reference image was not attached; **do not claim exact image match**.


## V1 implementation update

The active pilot client is a responsive React web app served by a Cloudflare Worker. The Worker must hold secure HttpOnly revocable provisioned-device sessions and proxy only the fixed Recall API origin. The existing Supabase email callback is legacy behavior and must be removed from the active pilot flow after replacement and negative security tests. Browser tokens are removed from callback URLs before network redemption. Canonical PostgreSQL, private originals, and the Python API/worker remain unchanged. Browser IndexedDB is a workspace-scoped original-draft outbox, not the native SQLite cache or an offline generative service. Pending drafts survive logout and have explicit confirmed removal controls. Deployment and live browser acceptance are tracked separately in V1-STATUS.

Migrations 0003–0006 extend the accepted capture/worker architecture. Canonical entities, mentions, relationships, claims and append-only claim revisions remain relational PostgreSQL records. User overrides take precedence when rebuilding interpretations and search projections. Retrieval combines authorized keyword, alias/entity and optional pgvector lanes; configuration/revision/hash checks exclude incompatible or stale vectors.

Desktop Rust owns scoped SQLite, FTS, downloaded-original inventory, outbox and cursor persistence. Provider calls remain outside database transactions. Pilot transactions use a per-workspace advisory lock for coherent mutations/snapshots. Backup takes an exclusive global maintenance gate; API, worker and purge operations take its shared form before accessing mutable state. This intentionally favors consistency over maximum pilot throughput.

See [V1-STATUS](V1-STATUS.md) for verification boundaries; proposed future capabilities below are not all implemented.


Version: 0.1 | 2026-10-06 | Proposed implementation baseline

## 1. Ownership and topology

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

Postgres records the current accepted interpretation and its history, not objective truth. Object storage holds original evidence. AI and indexes are replaceable derived machinery. SQLite is a synchronized working copy plus local pending operations. Markdown is a portable projection, not a peer database.

## 2. Stack decisions

| Component | Decision | Reason and boundary |
| --- | --- | --- |
| Mobile | Expo / React Native / TypeScript, iOS first | Purpose-built camera and import flow; actual device and signed-build acceptance required |
| Desktop | Tauri 2 / React / TypeScript, Windows first | Native file access, local SQLite, installed app, and managed vault export |
| Shared clients | Contracts, generated API types, design tokens, sync protocol | Share behavior and language, not an assumption of identical React Native/DOM components |
| API | FastAPI | Authentication, validation, domain commands, retrieval, and source authorization |
| Worker | Separate process from the same Python package | Durable jobs survive request completion; no in-process-only background processing |
| Cloud state | Managed PostgreSQL with pgvector | Relational records, full-text, and measured vector retrieval without another database |
| Identity/storage | Supabase Auth and private Storage, proposed default | Reduce infrastructure assembly; not a claim that defaults are secure or free |
| Local state | SQLite | Cache, local full-text search, pending operations, and export manifests |
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

The API and worker reuse these modules. Do not split them into separately deployed microservices. The worker has no reason to run on an end user's computer.

## 4. Capture write path

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

Use an established Auth provider with a native-compatible sign-in flow; validate issuer, audience, expiry, and signature server-side. Store refresh credentials in OS-protected storage, not ordinary SQLite rows, logs, or frontend bundles. API clients receive neither direct database write credentials nor provider/service-role keys.

Use workspace membership checks in the API plus database RLS/least-privilege roles as defense in depth. A pooled database connection must establish request context transaction-locally and clear it at transaction end. Do not accidentally deploy the API as a database owner that bypasses the intended policy.

The worker's elevated access is narrowly scoped by code and tests to its claimed workspace/capture. Storage buckets remain private. Read URLs, when used, are short-lived bearer capabilities with explicit TTL limits.

## 8. Synchronization and local files

A versioned change feed updates desktop SQLite. Client commands carry operation IDs and expected entity/record versions. Source downloads are separately tracked and hash-verified. Offline originals are not implied by a cached record.

The desktop is the local bridge; there is no separate always-on service in V1. It exports only into a selected managed vault root while running. See [SYNC-AND-EXPORT](SYNC-AND-EXPORT.md) for conflict, cursor, and deletion rules.

## 9. Alternatives intentionally rejected

**Canonical local Postgres:** makes phone capture and cloud integrations depend on a specific desktop or a second synchronization system. Local Postgres remains appropriate for developer tests, not canonical user memory.

**Markdown as the application database:** makes concurrency, correction precedence, tenant authorization, and offline reconciliation depend on file parsing and filesystem races. Markdown remains the escape hatch.

**Separate graph/vector/queue services:** create operating overhead before workload evidence warrants it. Relational entity links, pgvector, and a jobs table are sufficient starting boundaries.

## 10. Universal product boundary

Core services operate only on universal captures, sources, memories, entities, relationships, statements, actions, and temporal/provenance records. Domain-specific experiences are projections/adapters. Do not fork storage or retrieval into separate schemas for maintenance, sales, education, travel, or other verticals.

Obsidian is an optional export adapter. No core capture, Ask, correction, sync, or retrieval path may depend on Obsidian being installed or configured.

The architecture must allow later source adapters (voice, screenshots, files, links, connected apps) to enter through the same trusted source-memory boundary and later assistant surfaces to access memory through the same authenticated API/tool contract.

## 11. Rollout boundary

Start with an authenticated capture through both client shells. Then add one useful source-backed answer. Finish correction, offline, export, isolation, restore, and real-device evidence before calling the full pilot ready. Paid provisioning and a public launch are separate owner-authorized actions.
