# Canonical data model

Version: 0.1 | Logical schema, not executed migrations

## Conventions

Use UUID primary IDs. Every user-data row includes `workspace_id`; references use composite workspace/id foreign keys or equivalent constraints so a valid ID from another workspace cannot be attached accidentally. Use UTC `timestamptz` for recorded times plus explicit IANA timezone where user interpretation matters. Dates and uncertain date ranges are not forced into timestamps.

Mutable canonical records carry `version`, `created_at`, `updated_at`, and `deleted_at`. A successful mutation increments the version in the same transaction as its audit/change event. Derived rows identify the capture, extraction run, input fingerprint, and source revision that produced them.

Use typed columns for ownership, state, identity, time, and searchable dimensions. JSON is appropriate for versioned provider payloads and narrow typed attributes; it is not a substitute for referential integrity or authorization.

## Tables by responsibility

| Table | Essential fields / constraints | Introduced |
| --- | --- | --- |
| `workspaces` | id, display_name, timezone, AI consent/config, quota policy, sync_clock | RCL-001 |
| `workspace_members` | workspace_id, user_id, role; unique membership | RCL-001 |
| `devices` | workspace_id, user_id, id, platform, last_seen, revoked_at | RCL-001 |
| `captures` | id, client_capture_id, device_id, source_kind, captured_at, event_date/range, timezone, context_hint, status; unique workspace/client_capture_id | RCL-001 |
| `source_objects` | capture_id, client_page_id, ordinal, private_object_key, media_type, bytes, sha256, derivative_of, deleted_at; unique capture/page and capture/original ordinal | RCL-001 |
| `idempotency_records` | workspace_id, actor_id, route, operation_id, request_digest, result_reference, expires_at; same key plus different payload is a conflict | RCL-001 |
| `processing_jobs` | capture_id, input_revision/fingerprint, processor_version, state, lease_token, lease_expires_at, attempts, next_attempt_at, safe_error_code | RCL-002 |
| `extraction_runs` | capture_id, model/provider/version, prompt/schema version, input fingerprint, raw validated output, validation result, usage/cost, supersedes_run_id | RCL-002 |
| `memories` | id, capture_id, kind, current_revision_id, display_title, status; one source memory per capture in V1 | RCL-002 |
| `memory_revisions` | memory_id, revision, summary, transcription, origin(model/user), source_run_id, created_by, reason; immutable versions | RCL-002 |
| `evidence_links` | memory_revision_id, source_object_id, page ordinal, transcription excerpt/locator, optional region; must resolve to same-workspace source | RCL-002 |
| `entities` | kind, display_name, normalized_name, typed attributes, provisional flag, version; names are not globally unique | RCL-003 |
| `entity_aliases` | entity_id, alias, normalized_alias, context; aliases can be ambiguous and must not enforce false identity uniqueness | RCL-003 |
| `mentions` | memory_revision_id, raw_text, kind, matched_entity_id nullable, resolution_state, evidence_id | RCL-003 |
| `entity_links` | source_entity_id, relationship_type, target_entity_id, evidence_id or user_origin; both ends same workspace | RCL-003 |
| `claims` | subject_entity_id nullable, predicate, raw_value/text, normalized value/unit nullable, epistemic_state, evidence_id, origin, supersedes_claim_id, current flag | RCL-003 |
| `actions` | text, assignee_entity_id nullable, status, raw_due_text, due_date/range nullable, due_basis, evidence_id, confirmation metadata, version | RCL-003 |
| `review_items` | target record/revision, reason, candidates, state, resolution, resolved_by; candidates must be authorized | RCL-003 |
| `search_chunks` | memory_revision_id, source locator, text, tsvector, embedding/model/dimensions/version nullable, current eligibility | RCL-002/003 |
| `change_events` | workspace_id, sequence, operation, record_type/id/version, transaction batch, tombstone; unique workspace/sequence | RCL-004 |
| `export_jobs` | workspace_id, requested snapshot, state, private artifact reference, expiry, hash manifest | RCL-005 |

`workspaces.sync_clock` is used for the commit-ordered change feed; do not replace it with an unconstrained sequence and assume commit order. See [SYNC-AND-EXPORT](SYNC-AND-EXPORT.md).

Create tables only when their packet requires them. This is not an instruction to implement the whole schema in RCL-001.

## Entity model

Supported entity kinds: `person`, `organization`, `project`, `asset`, `site`, `area`.

A company that is also a client remains one organization. Client, vendor, partner, and operating-business relationships are roles/links, not duplicate entity types. The Library may present a Clients filter without a separate clients table.

Useful relationships include person works_at organization, project for organization, asset located_at site, project involves asset, and entity categorized_in area. A source-backed mention connects a memory to an entity. Avoid a universal unconstrained knowledge-graph schema in the first build.

An asset name such as "Unit 4" is not globally identifying. Resolve with a confirmed client/site or serial number. Repeated first names are ambiguous unless other evidence disambiguates them. The model may propose candidates, but deterministic rules and explicit user corrections control final identity.

## Claims are not facts by default

Separate:

- **Legibility:** can the text be read reliably?
- **Meaning:** is it a report, hypothesis, question, idea, or recorded decision?
- **Attribution:** who reportedly said it, when known?
- **Verification:** has the user or an eligible source explicitly confirmed it?

Suggested canonical claim states: `reported`, `uncertain`, `question`, `confirmed_by_user`, `superseded`, `retracted`. An idea or recorded decision is stored as a memory kind/statement rather than converted into a technical measurement.

Example: a clear reading of "800 psi?" yields `raw_value='800 psi?'`, `normalized_value=800`, `unit='psi'` only if parsing is unambiguous, and `epistemic_state='uncertain'`. Normalization does not remove the question mark or assert verification. Unit conversion, when later supported, is a separate derived calculation with its assumptions.

Conflicting pressure claims from different dates remain separate. The current presentation may prefer a later confirmed statement while exposing the history. Never destructively replace the earlier source.

## Action semantics

Statuses: `suggested`, `open`, `done`, `cancelled`.

AI extraction creates `suggested` actions. A user accepts or edits one to make it `open`. This avoids turning a scribbled possibility into a firm obligation. There is no automatic email, calendar write, reminder scheduling, parts order, or service instruction.

Store `raw_due_text`, the relevant document/event date, timezone, normalization basis, and confirmation. A page photographed on Tuesday with "Sat?" does not automatically create a Saturday deadline. Missing or conflicting event context leaves the normalized deadline null.

## Corrections and provenance

Human correction creates a new revision with actor, reason, and expected version. The original source and prior revision remain inspectable unless explicitly deleted. Reprocessing creates a candidate run and respects field-level user overrides; unresolved collisions become review items.

All displayed claims and action suggestions must link to an evidence record or explicit user-authored entry. Summaries must preserve the uncertainty of their support. A quote matching a transcription verifies a reference, not the correctness of the handwriting interpretation; evaluation still checks the original image.

## Source-object rules

Object keys are generated by the service, for example `workspaces/<id>/captures/<id>/originals/<page-id>`. Filenames from uploads are display metadata only. Do not derive filesystem paths from them.

Compute SHA-256 server-side from accepted bytes. Store derivatives under separate keys with parent hash, transform version, and dimensions. Exact duplicates can reuse a private blob within a workspace, but capture occurrence metadata must remain distinct. Never deduplicate across tenants or equate a different photograph of the same page with a duplicate without review.

## Indexes and invariants

Index workspace and state/date columns, source capture/order, entity kind/name/aliases, current memory revision, and accepted action due dates. Full-text uses supported PostgreSQL text-search facilities. Vector indexes are introduced only after measured need; record embedding dimensions and model version explicitly.

Test: cross-workspace foreign references, stale revisions, duplicate capture IDs, incompatible idempotency payloads, invalid action state transitions, missing evidence, stale chunks after correction, and deletion propagation. Apply unique constraints for retry invariants, not just application-level prechecks.

## Desktop SQLite projection

Local tables mirror only needed fields: cached memories/revisions, entities/links, actions, source download inventory, local text-search index, pending operations, last sync cursor, and export manifest entries. Pending operations carry operation ID, entity version, payload, local files, retry/error state, and created time.

Tokens belong in platform-protected credential storage, not in this cache. Cache rebuilding must not discard unacknowledged drafts. Database and downloaded-source retention are explicit device settings, not an implied full mirror of all cloud data.
