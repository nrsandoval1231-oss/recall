# Canonical data model

Version: 0.4 | Logical schema. RCL-001 and RCL-002 tables are implemented in `services/backend/migrations/` (0001, 0002); everything else is still logical

## Design goal

The core model is universal external memory, not a CRM, CMMS, mining database, or Obsidian schema. Domain-specific concepts are represented with universal entities, memories, typed attributes, and relationships.

Use UUIDs. Every user-data row includes `workspace_id`. Mutable canonical records carry versions and timestamps. Derived rows record source capture, processor version, and provenance.

## Universal entity kinds

V1 canonical kinds:
- `person`
- `organization`
- `place`
- `thing`
- `event`
- `project`
- `topic`

Examples are projections, not new core kinds: generator -> thing; restaurant -> place/organization; client -> organization role; school field trip -> event; vacation -> project/event.

Do not add a new core entity kind merely to optimize one pilot domain.

## Memory semantics

A capture preserves source memory. Semantic records may represent:
- observation
- claim
- idea
- decision
- preference
- action
- commitment
- question
- relationship

A memory may contain multiple statements. Every material statement preserves evidence, attribution when known, temporal context, and epistemic state.

Suggested epistemic states: `reported`, `uncertain`, `question`, `confirmed_by_user`, `superseded`, `retracted`.

## Core tables

| Table | Purpose |
| --- | --- |
| workspaces / workspace_members / devices | ownership, identity, isolation |
| captures | one capture event; source kind, captured time, optional event time/context |
| source_objects | accepted originals/derivatives with hashes and ordered locators |
| idempotency_records | safe retry semantics |
| processing_jobs / extraction_runs | durable, versioned AI processing |
| memories / memory_revisions | source-backed interpretation and revision history |
| evidence_links | connect derived records to source objects/locators |
| entities / entity_aliases / mentions | universal identity and unresolved mentions |
| entity_links | typed relationships between universal entities |
| claims | evidence-backed observations/claims with temporal and epistemic state |
| actions | suggested/open/done/cancelled action or commitment records |
| review_items | targeted ambiguity/correction workflow |
| search_chunks | authorized full-text/vector retrieval over eligible revisions |
| change_events | commit-ordered sync feed/tombstones |
| export_jobs | portable snapshot/export manifests |

Create tables only when the active build packet needs them.

## Temporal memory

Capture time, event/document time, validity interval, processing time, and correction time are distinct.

Claims can carry `valid_from`, `valid_to`, `observed_at`, raw temporal wording, and a normalization basis. A later accepted claim may supersede an earlier claim without deleting it.

Queries such as “what did we originally expect?” and “what is the latest?” must be answerable from the same history.

Never infer an exact date solely from upload time when the source says “Thursday”, “next month”, or similar relative language without sufficient event context.

## Entity resolution

Names are not globally unique. Aliases may be ambiguous. Automatic linking requires a unique authorized candidate with compatible context and no conflicting identifiers.

“Mike”, “Unit 4”, “Mom”, “the hotel”, or “Sarah’s restaurant” may be resolvable only through accumulated context. Store unresolved mentions rather than inventing canonical identities.

Corrections to identity create durable resolution history and must improve future matching without silently rewriting unrelated past mentions.

## Claims are not facts by default

Separate:
- legibility: what appears readable;
- meaning: report, hypothesis, question, idea, decision, preference;
- attribution: who said or authored it, when known;
- verification: whether an eligible source/user actually confirmed it.

A clear reading of “800 psi?” can normalize the numeric token for search while remaining an uncertain claim. Normalization never removes the question mark's meaning.

Conflicting claims from different dates remain separate. Current presentation may prefer a later accepted statement while exposing the history.

## Actions and commitments

Statuses: `suggested`, `open`, `done`, `cancelled`.

AI extraction creates suggestions. A user accepts/edits one before it becomes an open obligation. V1 does not automatically send messages, create calendar events, order items, or schedule reminders.

Store raw due wording and normalization basis. Unresolved dates stay unresolved.

## Corrections and provenance

Human correction creates a new revision with actor, reason, and expected version. Original source and prior revisions remain inspectable unless explicitly deleted. Reprocessing respects user overrides; collisions become review items.

All displayed material claims and action suggestions link to evidence or explicit user-authored entries. Summaries and later synthesis inherit the uncertainty of their support.

## Source objects

Service-generated object keys; upload filenames are display metadata only. Compute SHA-256 server-side. Derivatives live under separate keys with parent hash and transform version.

Exact duplicate bytes may reuse a private blob within a workspace while capture occurrence metadata remains distinct. Never deduplicate across tenants.

## Search and retrieval

Index workspace/state/date, current revisions, universal entity kind/name/aliases, evidence, and accepted action dates. Full-text is baseline. Embeddings are versioned by model/dimensions and added only after a measured baseline.

Retrieval eligibility excludes deleted, superseded-as-current, unauthorized, or stale derived chunks while allowing historical queries to intentionally retrieve prior states.

## Desktop SQLite projection

Mirror only needed fields: cached memories/revisions, entities/links, claims/actions, source-download inventory, local text-search index, pending operations, sync cursor, and export manifests.

Tokens live in platform-protected credential storage. Cache rebuilding must not discard unacknowledged local drafts.

## Implemented in RCL-001

Only `workspaces`, `workspace_members`, `devices`, `captures`, `source_objects`, `idempotency_records` exist. Highlights (the migration is authoritative):

- Every workspace-scoped row has `workspace_id` and composite foreign keys (`(workspace_id, capture_id)`), so a page cannot reference another workspace's capture.
- **RLS is enabled and forced** on all six tables. Policies require both the request's selected workspace (`app.workspace_id`, set transaction-locally from verified membership) and live membership. The API role `recall_app` has no `DELETE`/`TRUNCATE` and column-limited `UPDATE`; the API refuses to start as a superuser, `BYPASSRLS` role, or table owner.
- `captures.status` is `awaiting_upload|stored` only; a trigger refuses `stored` unless every page is verified and refuses regression. `source_objects` rows are append-only and, once received, write-once (`server_sha256`, size, key); a check constraint forces `server_sha256 = declared_sha256`.
- `source_objects.storage_key` is server-generated and unique; client filenames are display metadata.
- `idempotency_records` is keyed by `(workspace_id, actor_id, operation_family, idempotency_key)` and stores the request digest and resource id. `captures` is additionally unique on `(workspace_id, client_capture_id)`, so a capture UUID stays unique after any idempotency record would expire. No purge exists yet.
- Cross-tenant blob deduplication is not implemented (and must never be added).

## Implemented in RCL-002

`ai_consents` (per workspace, policy-versioned), `processing_jobs` (lease token/expiry, attempts, backoff, `blocked_reason`; unique on capture + input fingerprint + processor version), `memories` (one per capture, `current_revision`), `memory_revisions` (append-only; origin `model` only for now; validated `extraction` JSON, validation notes, model and processor versions), `search_chunks` (generated `tsvector`, `eligible`, per-chunk `epistemic_state`, `source_id` + page ordinal), `ai_usage` (append-only token/cost accounting). The input fingerprint is the SHA-256 of the ordered verified page hashes plus timezone and context hint.

Capture status is now `awaiting_upload → stored → processing → ready | needs_review | failed`, `failed → processing`; a trigger enforces exactly these transitions. A second least-privilege role, `recall_worker`, is scoped by RLS to the workspace of the job it claimed (it is not a member of any workspace), cannot delete anything, and cannot read membership. The API role cannot write memories, revisions, or chunks. Deployment-wide spend is exposed only as two aggregate numbers via `recall_ai_spend()`.

Still logical (not created): entities, aliases, mentions as rows, claims, actions, review items, change events, export jobs, embeddings.
