# Canonical data model

## Imported text — v8

TEXT-FILE-01 adds optional versioned imported-text provenance while preserving exact v1-v7 records and rendering. The immutable original uses `Recall/Sources/<memory-id>.txt` even for an imported `.md`; filename and extension are metadata, never path authority. Initial semantic text omits one leading UTF-8 BOM, with a separate hash and lengths, while the original-byte hash continues to identify the complete file.

A create-only import intent binds the operation, vault, filename and source/semantic hashes before source publication. It enables same-operation recovery without inventing a new memory after an uncertain reply. The journal remains memory authority; the intent is operational state. Imported Markdown is rendered as inert content, and only supported edits to Recall's human annotation region become human revisions. The v8 writer fence must also preserve typed notes, photos, reading corrections and retained history on upgraded vaults. The exact 2aa36435 candidate has bounded independent acceptance. Import intents retain the original organization consent snapshot; recovery prepares it before commit and receipt replay finishes it without enrolling later consent. The Recall-owned annotation boundary also governs first direct-edit publication.

## Retained historical Ask — accepted reader contract

HISTORY-01 reads existing immutable journal events; it introduces no vault format or canonical memory table. A historical evidence item binds memory/revision, immutable source hash, exact event-byte hash, recorded time, exact excerpt and current revision. The as-of selector uses the highest eligible revision recorded before the exclusive cutoff, with revision order resolving equal timestamps. Malformed or decreasing timestamps cause an explicit omission, never an inferred timeline.

Only currently active, source-verified and conflict-free memories qualify. Later human corrections require current counter-evidence alongside older wording. Removed or missing sources do not reappear through historical Ask. Its receipt uses existing operation/digest/consent-version storage, and a changed current revision invalidates display even when historical bytes are unchanged. See [HISTORY-01](../.agent/HISTORY-01.md); bounded local acceptance is recorded in its completion and independent review.

## Related-memory projection v7 — bounded acceptance

V7 preserves the original, human text and source-local organization proposal. Its v2 organization binding additionally contains bounded current context and coverage; its result may contain up to three targets with exact two-sided quotes. An event-only `context_link_projection` snapshots each target ID, native-resolved safe basename and suppression state. It is required for v7 (possibly empty), absent from v1-v6, and part of v7 hashing/rendering. Historical replay uses that snapshot, never today's filesystem layout.

Current `related_context` and optional `context_repair_pending` are derived read projections. They do not grant path authority. A `context_suppress` journal revision removes stale links without replacing human text or rewriting history. Target edits, removal and external rename invalidate links immediately; unsuccessful safe publication leaves an explicit pending-repair state. The [replay contract](../.agent/CONTEXT-01-REPLAY-ADDENDUM.md) and [shared wire fixture](../packages/contracts/fixtures/local-context-synthetic.json) define the accepted bounded contract; v1-v6 byte compatibility remains required.

## Organization proposal v6 — accepted source-local contract

The proposed v6 event carries an optional, source-bound `organization` proposal: input/source hashes, input revision, source kind, operation and consent epoch, normalized extraction and unreviewed provenance. It does not replace the immutable source or human text. New writes require the v6 writer fence; v1–v5 bytes/history remain unchanged on read. Without a proposal, v6 preserves the existing text/photo projection.

Local organization intents and consent markers under `Recall/_meta` are operational state. The local consent fence orders future capture eligibility under the vault lock without comparing server/client clocks. A prepared intent is dispatchable only once source/history commitment is verified. Service consent/receipts remain operational and have no authority to rewrite memory. Human edits and reading corrections suppress the prior proposal in current projections; its historical event remains intact. See [the accepted source-local contract](../.agent/ORGANIZE-01.md) for the exact wire and acceptance invariants.

## Ask operational state — separate from memory

INTELLIGENCE-01 does not introduce a new vault memory version. Native retry intents under `Recall/_meta/ask/<operation-id>.json` bind a validated question/evidence packet to its selected vault and protected connection fingerprint. They contain no secret or provider response and are not history events. Current human text/corrections determine evidence; an intentionally empty correction never revives the immutable source.

Migration `0010_local_intelligence.sql` adds separately scoped invitations/grants, versioned Ask consent and workspace/device/vault/operation-bound receipts. These tables own authorization, recovery and accounting only. Nonempty receipts bind the admitted consent policy and decision version. A changed decision invalidates their private results without resetting accounting or operation identity. Results have a 24-hour expiry; digest/status/budget tombstones prevent replay. The Obsidian vault remains the owner of memory. [The wire fixture](../packages/contracts/fixtures/local-intelligence-synthetic.json) binds Python and Rust canonical JSON/digests, including Unicode.

## Required vault ownership

The accepted TEXT-01 slice adds the v5 text-source contract: exact submitted UTF-8 bytes are immutable at `Recall/Sources/<id>.txt`; the initial human note contains that text and remains separately editable. The source name is `note.txt`, while its path is derived from the native memory ID. Text is nonblank, contains no NUL, and is bounded to 256 KiB. A deterministic original-text link and trailing editable human body use the existing journal/history and conflict model. V5 photo notes reuse v4 rendering; v1-v4 history is not rewritten. Text has no photo-reading object or fabricated image derivative. Validation and review are recorded in `.agent/FINISH-02/TEXT-COMPLETION.json`; this source contract alone does not supply AI text organization.

The Obsidian vault is the required canonical memory spine. The universal model below must have a durable, versioned vault representation: stable IDs, linked memories/entities, immutable source attachments and hashes, evidence references, uncertainty, temporal revisions, corrections and tombstones. PostgreSQL/search/SQLite semantic projections must be recoverable from this representation; service authorization and secrets are separate protected operational state.

The native local vault has a versioned manifest, append-only operation journal/history and transactional publication. The new v4 Markdown renderer is an implementation candidate; exact validation/review is recorded in `.agent/REALIGN-01/COMPLETION.json` when frozen; it supplements the established v1-v3 note formats without rewriting existing notes. This is not a completed legacy-data migration or full semantic-projection rebuild. Direct user edits require validated reconciliation; paths/titles are not identity or authorization.

## Native Markdown renderer v4 — candidate contract

Successful selected-photo readings render deterministically into a readable note containing an original-source link, summary, source transcription, source-local mentions, source-linked statements, action suggestions, uncertainty, provenance and flat YAML properties: `id`, `status: "saved"`, `captured`, `source`, and `review`. `review` is `"not_read"`, `"unreviewed"` or `"corrected"`. The quoted `source` property uses the vault-root Obsidian link `[[Recall/Sources/<uuid>.<ext>]]`; the Markdown body uses a relative link such as `../Sources/<uuid>.<ext>`. Model output cannot select paths, property names, permissions or arbitrary links. Source links resolve deterministically and never infer identity or relationships across notes. Use relative URL-encoded Markdown links or vault-root wikilinks; never use `../` in a vault-root wikilink.

The v4 writer preserves v1-v3 renderer behavior byte-for-byte when reopening or reconciling those historical records. Existing external human edits keep the renderer/version of the record they extend. A qualifying reading/write uses v4 and its writer-version fence refuses older binaries, retaining exact prior manifest bytes; existing vaults are not bulk-converted. In v4, only edits to the trailing human-annotation region reconcile as human revisions when the generated prefix/link is unchanged. Edits to generated properties, reading, statements, provenance or source links conflict and remain on disk. A human transcription correction makes the rendered review state `corrected`, suppresses stale machine semantics from the active note/search projection, and leaves historical readings/source evidence in append-only history.

These rules define the candidate's compatibility and trust contract. They do not establish acceptance until deterministic renderer, fence, restart/recovery, direct-edit/conflict and keyword-projection checks pass on the exact candidate and independent review is recorded.

Obsidian's format constraints follow its official guidance: [Properties](https://obsidian.md/help/properties) and [Internal links](https://obsidian.md/help/links). Flat properties remain standard YAML at the note start; property values that represent links are quoted strings. Recall does not require a community plugin.

## V1 implemented schema — database-authoritative baseline

0003 adds `entities`, `entity_aliases`, evidence-keyed `mentions`, `entity_links`, `claims`, append-only `claim_revisions`, `actions`, `memory_overrides`, and `identity_operations`. Kinds are person, organization, place, thing, event, project and topic. Name matching creates candidates, never accepted identity. Explicit merge/split records actor and moved mention IDs.

Canonical claim identity hashes the source evidence, normalized kind/predicate and subject/object mention evidence keys. Model-local IDs and generated prose are not identity. Two distinct predicates can share a quote without sharing a correction. Duplicate structural identities are ambiguous: processing requires review and excludes their canonical claim/search/relationship projection rather than silently collapsing them. This conservative rule lacks finer handwritten span coordinates and can withhold otherwise useful same-line claims.

Mention identity combines evidence, normalized kind and verbatim mention text, so Alex and Jordan can share a quoted line without sharing an identity decision. Accepted or rejected legacy evidence-only decisions are carried forward only when text and kind also match. Candidate relationship evidence unions across supporting captures; deleting one source preserves remaining support. Automatic projection cannot modify evidence, status or validity for an accepted/rejected human relationship.

0004 adds workspace sync clocks/floors and identifier-only `change_events`; deleted resource identifiers hydrate as tombstones. 0005 adds explicit workspace retrieval configuration, durable embedding budget reservations and optional pgvector rows bound to text hashes, memory revisions, dimensions and model/config versions. 0006 adds durable object purge jobs and memory suppression markers. Deleting interpreted memory preserves originals while suppressing future automatic interpretation; full capture deletion removes both semantic state and source mappings and queues byte purge.

Source bytes and historical user/model revisions are not overwritten by corrections. See [V1-STATUS](V1-STATUS.md) for remaining limits.


Version: 0.4 | Legacy relational schema reference. RCL-001/RCL-002 tables and later listed migrations are implemented in `services/backend/migrations/`; this database schema remains a support/pre-migration authority and does not describe the new native vault renderer contract by itself.

## Design goal

The core model is universal external memory, not a CRM, CMMS or mining database. Its required durable representation is an Obsidian-compatible vault; that storage choice must not impose a domain-specific taxonomy on users. Domain-specific concepts are represented with universal entities, memories, typed attributes, and relationships.

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
# Product target and current renderer boundary

The target source contract covers photos, typed text, voice and files; adapters are staged as photo organization, text, grounded Ask, then voice and broader file inputs. The existing extraction model remains universal. Source-local mentions and evidence can be organized in the Obsidian note without merging same-name mentions across memories. The v4 renderer is an implementation candidate; exact validation/review is recorded in `.agent/REALIGN-01/COMPLETION.json` when frozen; its properties and links are deterministic projections, while source evidence and versioned history remain authoritative. See [PRD](PRD.md) and [ARCHITECTURE](ARCHITECTURE.md).
