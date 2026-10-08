# Memory API — V1 contract

## Required Obsidian architecture boundary

This document describes current implemented API behavior, not completed Obsidian-spine integration. The required vault-backed memory target needs versioned vault commit/reconciliation acknowledgments and conflict/provenance handling; exact extensions remain unspecified. Do not invent working vault endpoints or silently redefine existing `stored`/sync responses. Maintain authorization, integrity, idempotency and expected-version contracts while the migration is designed. See [ARCHITECTURE](ARCHITECTURE.md) and [SYNC-AND-EXPORT](SYNC-AND-EXPORT.md).

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

Current auth sign-in/token refresh use the selected provider, not custom password endpoints. This pre-migration contract does not satisfy the new no-sign-in target. Proposed paired-device authentication needs separately reviewed versioned contracts; no pairing endpoint or anonymous private-data access is introduced here. Administrative quota/consent controls are settings-only capabilities, not a public arbitrary configuration-write endpoint.

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

## Selected local photo reading — contract 1.0

This optional route reads one explicitly selected vault original with Claude. It creates **no** cloud capture,
source object, memory or search projection. The local vault remains authoritative. The production authorizer
is default-deny: ordinary cloud login tokens do not enable this route. No enrollment, credential creation,
account UX or production configuration is supplied by this packet.

The native adapter uses a fixed HTTPS service origin and an opaque, inference-only device credential held in
OS-protected storage. The server's injected `DeviceAuthorizer.verify` must verify current revocation and exact
vault scope, and map to an **existing** operational user/workspace/device. The server independently checks
current workspace membership without provisioning. It verifies the device before reading any request body,
again before dispatch, and again before returning a POST or GET receipt. The renderer never receives the
credential, chooses an origin, or supplies a filesystem path.

### Request

`POST /v1/local-readings` uses a raw image body (not JSON/base64 or multipart):

- `Authorization: Bearer <opaque-device-credential>`
- `Content-Type`: exactly `image/jpeg`, `image/png`, `image/webp`, `image/heic` or `image/heif`.
- `X-Recall-Reading`: one JSON object, at most 4,096 UTF-8 bytes, with exactly the following fields.

```json
{
  "schema_version": "1.0",
  "operation_id": "11111111-1111-4111-8111-111111111111",
  "vault_id": "22222222-2222-4222-8222-222222222222",
  "memory_id": "33333333-3333-4333-8333-333333333333",
  "source_id": "33333333-3333-4333-8333-333333333333",
  "source_sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "expected_revision": 1,
  "captured_at": "2026-10-08T12:00:00Z"
}
```

This is a synthetic shape example; its hash is not a real attachment hash. All four IDs are canonical lowercase
hyphenated UUID strings. `vault_id` is the vault manifest's stable identity, **not** a transient native session
ID. `memory_id` and `source_id` are both bound explicitly; they may be equal for the current one-original
memory subset. `source_sha256` is the lowercase 64-hex SHA-256 of the exact preserved original.
`expected_revision` is an integer from 1 through 9,007,199,254,740,991 (JSON booleans are rejected).
`captured_at` is an RFC3339 date/time string of at most 40 characters with uppercase `T`, explicit `Z` or `±HH:MM` offset, and optional 1–9 fractional second digits.
No workspace ID, context hint, annotation, other memory, vault listing or image path is accepted.

The original must already be durably saved locally. Body size is bounded while streaming, including chunked
requests, by the configured page limit (maximum 25 MiB). The received hash, decoded image format and pixel
limit must pass before dispatch. The existing image derivative code produces one metadata-free, oriented JPEG
with maximum edge 2,000 pixels (or the lower configured limit) and at most 3,500,000 bytes. The provider receives
that full-page derivative only. No original or derivative is stored by this server.

### Response and input binding

POST and `GET /v1/local-readings/{operation_id}` return the same receipt shape with `Cache-Control: no-store`.
GET requires the same device/vault scope and can recover a response without re-uploading the image. Every HTTP
receipt is below 1 MiB; the normalized `result` JSON is capped at 900,000 bytes. Native clients enforce their
own response/body/field limits and validate this contract plus the referenced extraction schema before promotion.

```json
{
  "schema_version": "1.0",
  "binding": {
    "schema_version": "1.0",
    "operation_id": "11111111-1111-4111-8111-111111111111",
    "vault_id": "22222222-2222-4222-8222-222222222222",
    "memory_id": "33333333-3333-4333-8333-333333333333",
    "source_id": "33333333-3333-4333-8333-333333333333",
    "source_sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "expected_revision": 1,
    "captured_at": "2026-10-08T12:00:00Z"
  },
  "state": "in_flight",
  "result": null,
  "error_code": null
}
```

For `complete`, `result` has exactly these fields:

| Field | Contract |
| --- | --- |
| `provider` | `"anthropic"` |
| `model_id` | The exact configured model ID reported by the provider; mismatches fail closed with an unknown hold |
| `input_manifest_sha256` | Digest defined below |
| `derivative` | Object with `sha256` (lowercase hex64), `transform_version: "jpeg-rgb-exif-orient-v1"`, `media_type: "image/jpeg"` |
| `extraction` | Normalized output validated by `validate_extraction` against [`extraction.schema.json`](../packages/contracts/extraction.schema.json), schema version `1.1`, plus the selected-photo rules below |
| `validation_notes` | Array of objects containing string `code` and string `detail`; deterministic normalization/review notes, never executable instructions |
| `review_state` | Always `"unreviewed"`, even when schema validation succeeds |

The input digest is `SHA256(UTF8(canonical_json({"binding": binding, "media_type": content_type})))`.
Canonical JSON recursively sorts object keys, uses `,` and `:` separators with no whitespace, and ASCII-escapes
non-ASCII characters (Python `json.dumps(..., sort_keys=True, separators=(",", ":"), ensure_ascii=True)`).
All accepted binding values supplied by the native client are ASCII. The extraction's `capture_id` equals
`binding.memory_id`; `input_manifest_sha256` equals this digest; its only page has `page_id` equal to
`binding.source_id` and `ordinal: 1`. All extraction evidence references must resolve to that page. The native
adapter rechecks every binding, current revision/source bytes, vault session, active state and cancellation
before journaling the machine proposal. Normalized results containing NUL or unpaired Unicode surrogates are rejected as `INVALID_EXTRACTION` before storage; text is never silently rewritten to fit. Schema/reference validation is not proof of pixel-level reading truth.

Selected-photo normalization and native consumption share these additional rules; the legacy-cloud extraction
validator and schema retain their existing behavior:

- Mention, statement and action `local_id` values, and all mention references, are at most **128 characters**,
  including the `m`, `s` or `a` prefix. The service checks this before normalization, including items that would
  otherwise be dropped. Oversized IDs return terminal `failed` / `INVALID_EXTRACTION`, with known usage settled.
- Evidence for summaries, mentions, statements and actions must match the transcription under the existing
  Unicode NFKC/casefold/whitespace normalization. Unsupported proposals are dropped by the service; native
  still rejects unmatched supporting quotes. If `summary` is null, the service clears unused `summary_evidence`
  and records `UNUSED_SUMMARY_EVIDENCE` when there was evidence to clear.
- Uncertainty records remain as proposed, including their source references and wording. Their evidence may
  describe an illegible region absent from the transcription (for example, `illegible margin`). This is
  **proposed uncertainty, never a verified supporting quotation for a fact or summary**. Native accepts this
  narrow exception only for `uncertainties`; source binding, evidence shape/length, reference and digest checks
  still apply. A quote that is empty after NFKC and whitespace normalization is rejected as
  `INVALID_EXTRACTION` before completion, and native rejects it too. Transcription and uncertainty are not
  silently removed to make a receipt consumable; every complete result remains `unreviewed`.

The shared [selected-photo fixtures](../packages/contracts/fixtures/local-reading-selected-contract.json)
contain actual protected-route/JSONB receipts from synthetic images and provider output. Backend tests
reproduce each receipt, identical POST replay and GET recovery, one provider call and one settled usage row;
native tests consume those exact complete or intentionally failed receipts and check negative defenses.

| Receipt state | HTTP status | `result` / `error_code` | Meaning |
| --- | --- | --- | --- |
| `complete` | 200 | object / null | Validated unreviewed proposal available for local commit |
| `in_flight` | 202 | null / null | Admitted operation; GET later using the same operation ID |
| `unknown` | 202 | null / `PROVIDER_OUTCOME_UNKNOWN` | Provider outcome/accounting uncertain; never automatically re-dispatch |
| `failed` | 200 | null / stable code | Terminal operation; same ID returns the same failure without another call |
| `expired` | 200 | null / `RECEIPT_EXPIRED` | Content expired or workspace erased; operation remains fenced against replay |

Terminal failure codes are `INVALID_EXTRACTION`, `PROVIDER_REFUSED`, `OUTPUT_TRUNCATED`, `PROVIDER_FAILED`, and
`AUTHORIZATION_CHANGED`. Model text, exception messages, credentials and image content are not returned in
errors or application logs. Transport/admission failures use the existing `{ "error": { "code", "message",
"retryable", "request_id" } }` envelope: 403 `FORBIDDEN` (unconfigured/revoked/wrong scope/missing membership),
404 `NOT_FOUND` (GET unknown operation or another scope), 409 `IDEMPOTENCY_CONFLICT` (changed payload under an
existing operation ID), 409 `AI_NOT_CONFIGURED`, `CONSENT_REQUIRED` or `BUDGET_EXHAUSTED`, 413 `PAYLOAD_TOO_LARGE`,
415 `UNSUPPORTED_MEDIA`, and 422 `VALIDATION_ERROR` or `HASH_MISMATCH`. Membership removed during a paid call
can prevent settlement until authorized operator recovery; the durable reservation remains held.

### Retry, cost and retention

The receipt key is operational workspace + device + vault + operation UUID. Payload binding includes the
media type and original hash. Receipt insertion and the existing deployment-wide budget reservation commit
atomically before provider dispatch. The provider runs outside database locks. Concurrent identical requests
return the existing receipt; changed valid input with the same key fails. There is one `Provider.interpret`
invocation per admitted operation, no repair call, no SDK transport retry and no refusal fallback for this
flow. Existing cloud provider behavior is unchanged. The shared ledger reserves the existing conservative
24,784 input / 64,000 output token bounds with configured pricing; no model, price or budget is chosen here.
Usage is settled only when model/usage match that bound, including the provider-reported model on billed refusal/truncation errors; missing or mismatched error model metadata retains an unknown hold. An uncertain call retains its reservation for
operator reconciliation; no automatic refund or retry is promised.

After a lost response or native restart, recover by GET. A 404 allows repeating the **same** POST operation;
a committed receipt prevents duplicate dispatch. At 15 minutes, an abandoned `in_flight` becomes `unknown`;
late completions cannot promote an already unknown/expired receipt. A local cancellation must durably prevent
local promotion, including restart/recovery, but cannot promise to cancel an already dispatched provider call
or reverse its charge. The server may finish and retain its receipt after the client disconnects. Do not
silently create a new operation for unknown, failed, expired or cancelled work.

Only normalized reading content is retained, for a 24-hour recovery window from admission. Expiry is enforced
on receipt access, at API startup, and every 60 seconds while the API is running. Expiry and existing workspace
erasure clear the result and fence late completion; original bytes, derivatives and raw model responses are
never written to durable storage. While the API is stopped, scheduled SQL cleanup does not run; startup clears
expired content before serving. Database backups/WAL may retain previously stored content under their separate
operational retention policy; this is logical deletion, not a secure-erasure claim. Minimal binding metadata,
payload digest, terminal status and budget linkage remain as idempotency tombstones indefinitely; they do not
serve as canonical memories and are not indexed/exported as vault memory.

The shared [synthetic wire fixture](../packages/contracts/fixtures/local-reading-synthetic.json) includes the exact selected image bytes (base64 for fixture portability), request binding, and actual normalized HTTP result. Python contract tests replay it against real PostgreSQL and compare the full response; native tests can consume the same digest and extraction without live provider calls.
