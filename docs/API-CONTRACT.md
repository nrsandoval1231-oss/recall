# Memory API — V1 contract

## V1 implemented routes (supersede older packet limitations)

All routes remain `/v1` and derive the workspace from verified membership. Entity list/detail/create and `GET /entities/{source}/identity-preview/{target}` / `POST /entities/{source}/identity/{target}` support explicit merge or selected-mention split, expected source/target versions and idempotency keys.

`POST /memories/{id}/corrections` requires `If-Match` current memory revision and an idempotency key. Targets: summary, transcription, claim, mention_identity and relationship. Claim validity/status may be corrected without replacing text. Memory views include canonical claims, current mentions, entities, relationships and revision history. `POST /ask` accepts bounded entity IDs and explicit RFC 3339 `as_of`; historical evidence uses the selected historical revision.

`POST /sync/snapshots`, `GET /sync/changes?cursor=&limit=` and `POST /sync/push` implement bounded recovery and workspace-bound opaque cursors. Push supports only `memory.correction` and `action.update`, with UUID operation keys and expected versions; results distinguish applied, already_applied, conflict, rejected and retryable_failure.

`POST /exports` returns an authenticated deterministic ZIP containing canonical history, Markdown and verified originals. Snapshot metadata records the sync clock/state change instant; unavailable originals are explicit. `DELETE /captures/{id}`, `/memories/{id}` and `/sources/{id}` require expected versions/idempotency. Source deletion uses its capture version. Partial page deletion from an interpreted capture is refused to preserve corrections; delete the full capture instead. `GET /workspace/deletion-preview` then `DELETE /workspace/data` supports owner-confirmed erasure with the preview sync version. Byte purge is asynchronous and retryable; database visibility is removed atomically first.


Version: 1.0 | The V1 implementation above supersedes historical packet limitations below; unsupported routes remain explicitly marked.

## Common contract

Base path: `/v1`. JSON uses UTF-8, UUID identifiers, RFC 3339 timestamps, and explicit schema versions for durable envelopes. The server derives the actor and allowed workspace from validated authentication and membership; client-supplied workspace IDs never establish access by themselves.

Errors use `{ "error": { "code": "...", "message": "...", "retryable": false, "request_id": "..." } }`. Do not include raw private notes or secrets in errors. Pagination returns opaque, workspace-bound cursors.

Mutating creation/finalization/command requests require `Idempotency-Key`. The key is scoped by workspace, actor, and operation family. Retrying the same key and request digest returns the original result. Reusing it for a different payload returns `409 IDEMPOTENCY_CONFLICT`. Persist creation identifiers long enough for delayed offline retries; a capture UUID remains unique even after an idempotency response expires.

Versioned record updates require `If-Match` with the current revision/version. A stale update returns `409 VERSION_CONFLICT` plus the authorized current version and reconciliation information. Do not perform silent last-writer-wins updates.

## Route inventory

| Method / path | Purpose | Packet |
| --- | --- | --- |
| `GET /me` | Current actor, workspaces, capabilities, consent/config status | 001 |
| `POST /devices` | Register this authenticated device | 001 |
| `POST /captures` | Create/reuse capture and ordered upload manifest | 001 |
| `POST /captures/{id}/upload-authorizations` | Issue/renew narrowly scoped upload capability for pending pages | 001 |
| `POST /captures/{id}/finalize` | Verify received originals and finalize storage; later enqueue processing | 001 |
| `GET /captures` | Cursor-paginated recent captures and honest states | 001 |
| `GET /captures/{id}` | Status, page manifest, failures, and resulting memory ID | 001 |
| `GET /sources/{id}/content` | Authorized source response or short-lived signed redirect | 001 |
| `POST /captures/{id}/retry-processing` | Explicit bounded retry after recoverable processing failure | 002 |
| `GET /settings/ai`, `PUT /settings/ai` | Workspace AI-reading consent (settings-only capability) | 002 |
| `GET /memories` | Filtered/searchable current memories | 002 |
| `GET /memories/{id}` | Current revision, evidence, and relevant history | 002 |
| `GET /search` | Source-first keyword/entity retrieval; hybrid enabled later | 002/003 |
| `POST /ask` | Grounded online answer with citations or abstention | 002 |
| `POST /memories/{id}/corrections` | Versioned user correction; preserve original | 003 |
| `GET /entities` / `GET /entities/{id}` | Authorized entity search and detail | 003 |
| `POST /entities` | Explicit user-authored entity | 003 |
| `GET /review-items` | Bounded clarification queue | 003 |
| `POST /review-items/{id}/resolve` | Resolve or defer ambiguity with version precondition | 003 |
| `GET /actions` | Suggested/accepted actions, kept distinct | 003 |
| `PATCH /actions/{id}` | Confirm, edit, complete, or cancel an action | 003 |
| `POST /sync/push` | Apply supported idempotent offline operations independently | 004 |
| `GET /sync/changes` | Ordered, resumable workspace change feed | 004 |
| `POST /sync/snapshots` | Consistent snapshot after cursor expiry/device initialization | 004 |
| `POST /exports` / `GET /exports/{id}` | Portable snapshot and artifact status | 005 |
| `DELETE /captures/{id}` | Explicit owner deletion; invalidate derived content and emit tombstones | 005 |

Auth sign-in/token refresh use the selected provider, not custom password endpoints. Administrative quota/consent controls are settings-only capabilities, not a public arbitrary configuration-write endpoint.

## Capture manifest

Authoritative draft shape: [capture.schema.json](../packages/contracts/capture.schema.json).

The request includes a client capture UUID, registered device UUID, capture timestamp, timezone, optional context hint, and ordered pages. Each page has a client page UUID, ordinal, declared media type, byte size, client hash, and optional display filename. The server supplies canonical capture/source IDs and private storage keys.

Initial proposed limits: 1–10 pages, 25 MiB per image, 100 MiB per batch. Supported intake media are JPEG, PNG, HEIC, and HEIF. The implemented decoder must validate magic bytes and actual content, not only MIME headers. Unsupported/corrupt files must be rejected clearly. Create orientation/format derivatives for provider compatibility without overwriting the accepted original.

Response: `201` for a new capture or `200` for a replay, with `capture_id`, canonical page/source IDs, `status='awaiting_upload'`, and permitted upload instructions. Never return public object URLs.

## Finalization and state machine

Server states:

```text
awaiting_upload -> stored -> processing -> ready
                                      -> needs_review
                                      -> failed
failed -> processing (authorized bounded retry)
any live state -> deleted (explicit owner action)
```

Local-only and uploading are client states; do not store a misleading cloud-ready status for them. In RCL-001, finalization stops at `stored`; no AI job is implied. RCL-002 enables processing only after consent and configuration gates.

Finalization verifies every expected page, media/size limits, order, ownership, and server hash. A missing/corrupt page returns a recoverable error without acknowledging durable completion. Do not hold a database transaction open during a large network download or a provider call; stage checks, then commit metadata and job atomically with a final precondition check.

Processing completion can commit an incomplete but useful interpretation with review items. Unreadable pages keep their original, a clearly limited transcription, and a review state. A failed model call does not become an empty successful memory.

## Ask response

Request: `{ "question": "...", "conversation_id": null, "entity_ids": [], "as_of": null }`. Entity filters and history are optional and must be authorized. Prior conversation text is context, not new source evidence.

Response fields:

```json
{
  "status": "answered",
  "answer": "The note reports overheating and only suspects a coolant leak.",
  "citations": [
    {
      "citation_id": "c1",
      "memory_id": "server UUID",
      "memory_revision": 2,
      "source_id": "server UUID",
      "page": 1,
      "quote": "coolant leak?"
    }
  ],
  "limitations": ["No confirming diagnosis was found in the available sources."],
  "index_as_of": "server timestamp",
  "mode": "online_grounded"
}
```

This abbreviated example illustrates response semantics, not a schema-valid live response. Actual IDs are server-resolved and must reference retrieved eligible evidence. Valid statuses are `answered`, `insufficient_evidence`, `ambiguous`, and `unavailable`. The client must not render these as interchangeable success states.

Each material sentence must map to supporting evidence, including date and verification qualifiers. Contradictory evidence is presented as a conflict, not silently blended. If citation validation fails, return a safe limited response and sources instead of an unsupported answer. Source authorization is checked again on click.

## Correction and review contract

A correction specifies target memory/revision, the field or claim being changed, replacement value, and optional reason. The service appends a user revision, marks stale derived material ineligible, and queues reindex/export. It must not modify the original source bytes.

Resolving an identity review must refer to a same-workspace candidate or an explicit newly created entity. Reject arbitrary cross-workspace UUIDs, stale review versions, and attempts to grant a model authority to merge identities.

A date correction must distinguish the event date from upload date and preserve raw wording. User acceptance of an action is a separate change from confirming the transcription.

## Sync contract

`POST /sync/push` carries a bounded list of operations with UUID, kind, target ID, expected version, and payload. Responses are per operation: `applied`, `already_applied`, `conflict`, `rejected`, or `retryable_failure`. The supported allowlist is capture metadata/finalization commands, memory corrections, action edits, and review resolutions as their packets become available. It is not arbitrary SQL or record replacement.

`GET /sync/changes?cursor=...&limit=...` returns ordered events and `next_cursor`. A cursor is advanced only after transactional local application. An expired cursor returns `410 SNAPSHOT_REQUIRED`; pending local operations survive snapshot recovery.

For exact ordering, snapshots, tombstones, and reconciliation, see [SYNC-AND-EXPORT](SYNC-AND-EXPORT.md).

## Operational errors

Specify and test at least: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `UNSUPPORTED_MEDIA`, `PAYLOAD_TOO_LARGE`, `HASH_MISMATCH`, `UPLOAD_INCOMPLETE`, `IDEMPOTENCY_CONFLICT`, `VERSION_CONFLICT`, `QUOTA_EXCEEDED`, `PROCESSING_FAILED`, `SOURCE_UNAVAILABLE`, `SNAPSHOT_REQUIRED`, and `AI_NOT_CONFIGURED`.

Return stable machine codes and useful user messages. Do not encourage blind retries for authorization, unsupported input, or conflicting edits.

## RCL-001 implementation details

These are the exact, tested semantics of the packet-001 routes. Where they refine the proposal above, they win.

**Auth.** `Authorization: Bearer <provider JWT>`. The server validates signature (JWKS asymmetric keys, or legacy HS256 secret), issuer, audience, expiry, and a UUID `sub`. Algorithms are allow-listed (no `none`, no HS/RS confusion). The workspace is derived from verified membership; no request field or header selects or grants a workspace. Each user gets one personal workspace on first authenticated request unless `RECALL_AUTO_PROVISION_WORKSPACES=false`.

**Devices.** `POST /v1/devices` `{device_id, platform, name?, app_version?}` is naturally idempotent on the client-chosen `device_id` (201 first time, 200 on the same registration, 409 if the id is registered differently) and is the one creation route that does not take `Idempotency-Key`. A capture requires a device registered by the same user.

**Create.** `POST /v1/captures` validates the body against `capture.schema.json` plus: contiguous unique ordinals starting at 1, unique `client_page_id`, per-page and per-batch byte limits. Schema failures map to `UNSUPPORTED_MEDIA` (415, bad `media_type`), `PAYLOAD_TOO_LARGE` (413) or `VALIDATION_ERROR` (422). `Idempotency-Key` is required (8–200 chars). The mobile client uses the capture UUID. Identical key and payload digest → replay (200, the same capture in its *current* state, not a stale snapshot); same key, different payload → 409 `IDEMPOTENCY_CONFLICT`; a different key for an already-created `client_capture_id` is a replay if the payload is identical and a conflict otherwise. The digest ignores page-array order. The 201/200 body contains the server `capture_id`, per-page `source_id` and `upload_state` (`pending|received|verified`), `declared_sha256`, `server_sha256` (null until received) and an `upload` hint. `memory_id` is always null in RCL-001.

**Upload (decision: server-mediated).** `POST /v1/captures/{id}/upload-authorizations` (optional `{source_ids}`) returns, for each page not yet *verified*, `{source_id, method:"PUT", url:"/v1/uploads/<token>", expires_at, required_headers, max_bytes}`. The token is an HMAC-signed capability bound to one workspace, user, capture and source with a short TTL (default 600 s); the client must also send its bearer token. `PUT /v1/uploads/{token}` streams the body to a spool file while computing SHA-256, then checks: size equals the declared size (`UPLOAD_INCOMPLETE` / `PAYLOAD_TOO_LARGE`), SHA-256 equals the declared hash (`HASH_MISMATCH`), and the bytes really are the declared type (JPEG/PNG fully decoded under a pixel limit; HEIC/HEIF container signature) (`UNSUPPORTED_MEDIA`). Only then is the object written, write-once, to the server-assigned key `workspaces/<ws>/captures/<capture>/sources/<source>/original` and the server-computed hash recorded. Re-sending identical bytes is a harmless 200; a verified original is never overwritten by different bytes (the incoming bytes must equal the declared hash, so a differing stored object is by definition damaged and is repaired). Direct-to-storage signed uploads are a later optimization; this keeps one authorization path, server-side hashing before storage, and no storage credentials or bearer URLs near clients. Extra codes: `UPLOAD_AUTHORIZATION_INVALID` (403), `UPLOAD_AUTHORIZATION_EXPIRED` (403, retryable: request a new authorization).

**Finalize.** `POST /v1/captures/{id}/finalize` with `Idempotency-Key` and body `{"expected_pages":[{"source_id","sha256"}...]}` listing exactly the capture's pages and the hashes the client believes were stored. The server verifies every page was received, re-reads each stored object from storage and recomputes its SHA-256 (outside any DB transaction), compares with the client's expectation, then in one transaction marks pages verified and the capture `stored`. Missing pages, lost objects, or stored bytes that no longer match their hash → 409 `UPLOAD_INCOMPLETE` (retryable, `details.missing_source_ids`); re-sending the verified bytes for such a page replaces the damaged object (the only case where an object is ever replaced). A mismatch between the client's `expected_pages` and the server hash → 422 `HASH_MISMATCH`. Replays (same key, or a new key after success) return the stored capture without re-effecting (`version` is bumped once). The database itself refuses `stored` unless every page is verified.

**Read.** `GET /v1/captures` (opaque, workspace-bound, signed cursors; newest first by server creation time (a capture whose transaction commits late can appear after a client has paged past its position; refresh from the top)) and `GET /v1/captures/{id}` return the capture view. `GET /v1/sources/{id}/content` streams the original through the authenticated API (no signed read URLs are issued) only for verified pages of a `stored` capture (else 409 `SOURCE_UNAVAILABLE`), with `Content-Type` = verified media type, `X-Recall-Source-SHA256`, `ETag`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. Another workspace's capture or source is indistinguishable from a nonexistent one (404 `NOT_FOUND`).

**Also**: `/healthz` (liveness) and `/readyz` (DB + storage) are unauthenticated and content-free. CORS is closed unless `RECALL_CORS_ORIGINS` lists explicit origins (never `*`).

## RCL-002 implementation details

**Gates.** A capture is interpreted only when the server is fully configured (`AI_PROVIDER`, `AI_MODEL_ID`, `AI_API_KEY`, per-MTok prices, daily and monthly budgets) **and** the workspace has turned AI reading on. `GET /v1/settings/ai` returns `{ai_configured, provider, policy_version, enabled, consent_outdated, version, explanation}`; `PUT` takes `{"enabled": bool, "expected_version"?: n}` (409 `VERSION_CONFLICT` on a stale version, 409 `AI_NOT_CONFIGURED` when enabling on an unconfigured server). Consent is bound to a policy version; if what is sent or to whom changes, consent becomes `consent_outdated` and processing stops until it is given again. Enabling resumes jobs that were cancelled because consent was off and queues every other `stored` capture; disabling cancels queued work and returns any capture that was waiting in retry backoff to `stored` (a call already in flight finishes, but its result is discarded at commit if consent is gone). `/v1/me` `config` reports `ai_configured`, `ai_enabled`, `consent_required`.

**Capture views** gain `processing: {state: queued|running|retrying|succeeded|failed|cancelled, attempts, max_attempts, blocked_reason: budget_exhausted|null, last_error_code, retry_available} | null` and `memory_id`. Finalize creates the job in the same transaction that stores the capture. A capture stays `stored` until a worker actually claims its job (then `processing`); it ends `ready`, `needs_review` (unreadable pages or items dropped by validation), or `failed`. Originals stay viewable in every state after `stored`.

**Worker** (`python -m recall.ingestion.worker`, role inheriting `recall_worker`): claims with `FOR UPDATE SKIP LOCKED` and a lease (default 900 s), re-verifies each original's SHA-256 before anything leaves, sends only server-made derivatives (EXIF orientation applied, metadata stripped, JPEG, size-bounded), validates the proposal, and commits only if it still holds the lease and consent is still active. Retryable failures back off (30 s × attempts²) up to `RECALL_MAX_PROCESSING_ATTEMPTS`; refusals, truncation, integrity and decoding failures are terminal. Every provider call (including failed and repair calls) is recorded in `ai_usage` with an estimated cost; when the deployment's daily or monthly spend reaches its budget, no new call is made and queued jobs show `blocked_reason: budget_exhausted`.

**Validation** (see AI-INGESTION): unparseable/schema-invalid/wrong capture/wrong pages/unknown ids → one repair call per attempt, then retry. Soft rules never add certainty. Every claim is judged against the **full source lines** its verbatim quotes come from: quotes must be verbatim in that page's transcription (else the item is dropped); numbers in a summary, statement, or action must appear in its quotes; capitalised names and time words (weekdays, months, "tomorrow", "next", …) must appear in its cited lines (else the summary/statement/action is dropped); mention text, `temporal_text`, `due_text`, and `attribution_text` must each sit inside a single quote (no stitching across quotes; else removed); `confirmed_by_user` is downgraded to `reported`, `superseded`/`retracted` to `uncertain`; a `reported` statement becomes `uncertain` when any cited line contains "?" or a recorded uncertainty overlaps its evidence. Notes are stored with the revision and returned as `validation_notes`.

**`POST /v1/captures/{id}/retry-processing`** (requires `Idempotency-Key`, recorded as operation family `capture.retry_processing`: a replay with the same key returns the capture's current processing view even after the retried job has finished; the same key for a different capture is 409 `IDEMPOTENCY_CONFLICT`): re-queues a `failed` job (at most 3 manual retries) or a cancelled one (`retry_available` is true for both); returns the current `processing` view; 409 `NOT_RETRYABLE` / `AI_NOT_CONFIGURED` otherwise.

**`GET /v1/memories`**, **`GET /v1/memories/{id}`**: current revision with `interpretation` (summary, pages[].transcription keyed by `page_id` = `source_id`, mentions, statements with `epistemic_state`, action *suggestions*, uncertainties), `validation_notes`, `model_id`, `processor_version`, and display `labels` ("Machine reading…", "Suggestions only…"). Versioned write routes are listed in the V1 section above.

**`GET /v1/search?q=`**: Postgres full-text (`english`) over eligible chunks of current revisions; the question's lexemes are OR-ed and ranked (`ts_rank_cd`), so vague recollections match on shared words. A summary or statement supported by several pages is indexed once per supporting page, so a citation always opens a page that actually supports it. Results carry `memory_id`, `capture_id`, `source_id`, `page`, `kind` (`transcription|statement|summary|context`), `epistemic_state`, `excerpt`. Optional versioned vectors are listed in the V1 section above.

**`POST /v1/ask`** `{"question"}` (`conversation_id`, `entity_ids`, `as_of` must be null/empty in RCL-002, else 422). The server retrieves; with no matches it returns `insufficient_evidence` (`reason: NO_EVIDENCE`) **without a model call**. Otherwise it sends at most 8 excerpts as a packet with server citation ids `c1…`; the model must return sentences each citing ≥1 packet id. Any unknown id, empty answer, or schema failure → `insufficient_evidence` (`reason: ANSWER_UNVERIFIED`) with no answer text. AI off / consent missing / budget reached / provider down → `unavailable` with `reason` (`AI_NOT_CONFIGURED`, `CONSENT_REQUIRED`, `BUDGET_EXHAUSTED`, provider code) and `mode: sources_only`. Every response includes `sources` (matching excerpts with `source_id`/`page`) so the original is always one step away; `citations` are server-resolved from the packet, never from model text. Entailment (does the cited text really support the sentence?) is not checked at runtime; it is an evaluation metric.
