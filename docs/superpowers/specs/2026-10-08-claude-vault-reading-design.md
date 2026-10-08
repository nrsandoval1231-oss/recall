# Selected-photo Claude reading

The owner selected Claude full-page vision as the primary photo-reading path and authorized implementation, synthetic tests and a stacked draft PR. This bounded design extends the no-sign-in local vault; it does not enable a service, enroll devices or authorize paid calls.

## Experience and authority

Import preserves the exact original first. On an active selected memory, **Read this photo with Claude** explicitly sends only that photo to the configured private service. Explain the cloud processing boundary before dispatch. Never upload a vault in the background. A returned reading is visibly **Unreviewed machine reading**, with provider/model/source-hash attribution and uncertainty. Show it beside the original, make its text searchable, and let the user save a human correction without rewriting the machine proposal or original. Human reading corrections take precedence over later machine readings. Annotation is distinct from transcription. No semantic Ask, OCR engine, line segmentation, entity graph or provider router is added.

## Contract

One selected image per request. A versioned envelope binds operation ID, memory/source ID, source SHA256, expected local revision and captured time. The native boundary obtains bytes from the selected vault, not a renderer file path. Server authorization derives the operational workspace from a verified device principal, never vault text or submitted workspace ID. Authenticate before accepting photo bytes. Reuse image derivatives, Provider.interpret, extraction schema/reference validation and the durable deployment-wide consent/budget reservations. Do not create cloud canonical captures/memories for this flow. Store only bounded operational receipts required for deduplication, recoverable retries and budget accounting, with documented content retention. Same operation/payload cannot invoke the provider twice; changed payload with same ID fails. Unknown in-flight outcomes stay explicit rather than automatically repeating a paid call.

The result carries normalized validated extraction, source/input binding, provider/model and derivative provenance. The native adapter treats it as untrusted, bounds fields, verifies all bindings and commits machine attribution separately from human prose using its existing journal/history machinery. New schema versions fence old writers and preserve original v1/v2 history bytes. Vault switch, revision change, removal, conflict, cancellation or source hash mismatch rejects a stale completion. Cancellation prevents local promotion; it cannot promise to reverse an already sent provider request or charge. Local commit retries reuse a durable receipt. Recoverable errors preserve the original and usable local search.

## No-sign-in service boundary

Default production configuration denies this feature. No provider secret enters clients. A future owner-approved device connection supplies a scoped revocable credential in OS-protected storage and a fixed HTTPS service origin; the renderer cannot choose arbitrary origins or read the credential. Server authorization is a narrow injected interface which defaults to deny, checks current membership/scope on dispatch and response, and maps to existing operational budget context without provisioning users. Tests install synthetic implementations only.

Proposed operational follow-up: a trusted owner provisioning channel approves a device public identity and vault scope, then installs a revocable service connection; the service maps it to an existing budget/consent workspace. First-device bootstrap, invitation UX, rotation/revocation/recovery and concrete credential protocol require separate review/authorization. QR remains proposed. No public self-enrollment, embedded shared key, anonymous endpoint or email-login fallback. This code can exercise the actual HTTP contract with synthetic credentials; it is not a configured production service.

## Evidence and limits

Test bad authorization before body/provider work, hash/type/size violations, malformed model output, budget exhaustion/unknown charges, duplicate/in-flight requests, correction precedence, restart/rebuild, old history preservation, stale completions and actual synthetic HTTP traffic. Exercise the visible UI using browser fixtures and native filesystem tests; distinguish those from installed Windows acceptance and live Claude quality. No paid/live call or private photo upload is part of acceptance here. Preserve previous PRs, no merge/deploy.
