# Security, privacy, and operations

Version: 0.1 | Requirements to implement and verify, not security certification

## Public repository / private product data

This repository is public. Real notebook pages, contacts, customer records, credentials, transcripts, logs containing content, vault exports, and database dumps must stay outside Git. Synthetic fixtures are labeled. `.gitignore` is only a convenience, not a security boundary or a substitute for reviewing staged files.

Do not upload an existing private corpus into a public issue, PR, Actions artifact, or model context while implementing the app. Use approved private storage and explicit pilot consent.

## Identity and isolation

Validate authentication before workspace selection. Check membership for every record, search, source request, AI context, job, export, and mutation. Enforce database constraints/RLS with a non-owner request role where applicable. Service-role keys bypass normal RLS protections and must never enter a mobile app, desktop bundle, public environment variable, log, or repository.

Test both direct record access and indirect leakage through search candidates, counts, citations, aliases, error messages, and source download URLs using two isolated test workspaces. A demo that uses one account is not isolation evidence.

## Original storage and URLs

Use private buckets and service-assigned non-overwritable original keys. Restrict uploads by owner, path, type, size, and expected manifest. Verify accepted bytes and SHA-256; treat user filenames as untrusted metadata.

Authorize source access again on every request. Prefer authenticated serving; short-lived signed redirects may be used with a proposed maximum TTL of 60 seconds. A signed URL is a bearer capability: it may remain usable until expiry even after a session is revoked. Never claim immediate revocation of already issued URLs or already downloaded files.

Keep derivatives separate. Do not strip or edit the accepted original to satisfy a model's input requirements. Strip unnecessary EXIF/location metadata from model derivatives and normal previews where feasible.

## AI privacy and instruction boundary

Before processing private content, explain which provider receives it, why, what is retained, and how deletion works. Record consent/configuration. Do not assume zero retention, no training, or regional guarantees without checking the chosen provider's actual applicable terms and settings.

Cloud AI processing is not end-to-end encrypted from the provider. Transport encryption and storage encryption do not make that claim true. Use least-context retrieval, bounded input sizes, rate limits, and provider credentials only on the server.

Treat all uploaded content as untrusted. No prompt embedded in a source may grant tool access, change a system instruction, select an arbitrary URL, or mutate permissions. Render model/Markdown content safely; block unsafe HTML and links from becoming executable application content.

## Device and export security

Use platform-protected token storage. Protect local caches with OS account permissions and available device/disk protections; do not claim the SQLite file is encrypted unless an implementation and key lifecycle have been selected and tested.

Scope Tauri native operations to app-private directories and one approved export root. Defend against traversal, symlink/reparse-point escape, case collisions, reserved filenames, and malicious relative paths. Never expose shell execution or unrestricted filesystem commands to the UI or model.

Sign-out/revocation should clear protected sessions and controlled local caches according to explicit settings. Explain that remote revocation cannot instantly erase an offline device or manually copied export.

## Deletion policy baseline

Proposed pilot policy: immediately tombstone a deleted capture and exclude it/derived memories from live retrieval; allow a clearly labeled 7-day trash recovery window; purge active object and derived data within 24 hours after that window. Keep only minimal non-content audit metadata needed for security/reconciliation.

Before deployment, document actual backup retention and a maximum deletion horizon consistent with the selected providers; target no more than 35 days after purge. Do not enable a conflicting retention setting or claim completion until the real restore/delete behavior is verified. User-managed external copies cannot be remotely recalled.

Deletion must invalidate chunks, cached answers, export jobs, signed-source issuance, and future retries. Offline tombstones apply on reconnect and cannot resurrect content through pending writes.

## Backups and restore

A Postgres backup does not contain private Storage file bytes. Back up structured records and original objects separately with a consistent manifest, object hashes, schema version, and snapshot/change cursor. A Markdown export alone is not a complete backup.

Before real pilot reliance, demonstrate an isolated restore that rebuilds records, retrieves the original page, verifies source hashes, answers a known query, and does not expose deleted content improperly. Never restore over production to test a backup.

Proposed operating targets: daily recoverable backup, RPO no worse than 24 hours, and a documented RTO target of 4 hours. These are product targets pending an actual provider plan and measured drill, not current guarantees. Test at least one restore before pilot launch and periodically thereafter.

## Durable jobs and monitoring

Track capture state, upload failures, job queue age, lease expiry, retry counts, model latency/usage, validation failures, correction rate, Ask source/abstention results, sync conflicts, export conflicts, and backup age. Use IDs and safe error classes, not raw notes, transcripts, queries, or source URLs in general logs.

Set job deadlines and bounded attempts. Lost acknowledgements may repeat a provider call; measure and cap cost rather than promising exactly-once billing. An AI outage must leave originals accessible and retryable.

## Spend and deployment gates

No infrastructure or paid service has been provisioned by this foundation. Before production AI, the owner must set daily/monthly limits, receive cost visibility, and authorize the deployment. Stop new paid processing when limits are reached; preserve pending captures and explain the state.

Verify current hosting/auth/storage/AI pricing and iOS/Windows distribution requirements at provisioning. A consumer chat subscription and the absence of Obsidian Sync fees do not imply the backend is free.

Secrets use deployment secret storage. Pin dependencies and create tested migrations once implementation starts. Native signing/updating, HTTPS, provider retention, alert delivery, and backup configuration remain explicit release dependencies.
