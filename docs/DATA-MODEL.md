# Canonical data model

Version: 0.2 | Logical schema, not executed migrations

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
