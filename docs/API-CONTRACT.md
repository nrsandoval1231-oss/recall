# Memory API — V1 contract

Version: 0.1 | Proposed routes and semantics; no endpoint is implemented yet

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
