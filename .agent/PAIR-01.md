# PAIR-01 build packet

Objective: secure selected-photo inference connection without sign-in. Base PR13 a17c2402ee5778a4015c50934bb91c7a59359dfe, branch implement/owner-device-pairing, repository nrsandoval1231-oss/recall.

Sol direction approved: no public enrollment. Native generates a 32-byte secret and device ID, persists pending material in its separate OS keyring, shows only fingerprint/device/vault. Trusted server-local owner CLI creates an explicitly approved short-lived single-use invitation bound to those exact values, existing owner/workspace and inference-only scope. Claim atomically consumes invitation, stores only secret hash in revocable grant. Authenticated status resolves lost responses; disconnect revokes before local removal. Missing secret requires new approval. No real CLI operation authorized.

Ownership: backend pairing module/new migration/API wiring/settings/tests; native pairing module/reading transport/commands/lib and tests; desktop minimal connection controls/platform adapters/tests; pairing ops/product documentation and pilot preflight/tests. Exclude evaluation harness/fixtures, .agent controller records, existing screenshots, legacy auth contracts and unrelated UI. One builder, serialized changes.

Invariants: existing owner membership only, no auto provisioning; first-workspace operational binding validated; exact device/vault/scope, revocation checked on every reading request; HTTPS origin/no redirects/proxy, secrets never renderer/vault/logs; local-only features unaffected; preserve receipt/idempotency/revision/correction/tombstone/recovery fences. Keyring failure/offline/ambiguous effects UNKNOWN, never connected from presence alone. Synthetic credentials only.

Acceptance: runnable owner invitation CLI, native prepare/claim/status/disconnect/recovery and focused UI with no credential export. Default disabled without reviewed server activation. Expiration/replay/concurrency/wrong scope/keyring/lost response/revocation/connection-change regressions. Explicit pilot activation requires reviewed settings, consent/budget and pairing configuration; default preflight still rejects AI. Document exact real activation approval details.

Validation: focused backend pytest, Ruff/mypy; native cargo fmt/test/check; npm desktop unit/typecheck/lint and browser connection checks; controller full applicable gates at frozen candidate and independent Sol review. Local missing tooling is limitation, CI gates still required.

Retry budget: two materially different safe repairs; report unresolved gates. Completion: changed files, commands/exit counts, synthetic-only evidence, unresolved UNKNOWNs and .agent/PAIR-01-COMPLETION.json; do not grade, commit, push, merge, deploy, enroll, install or spend. UTC timings/tokens UNKNOWN unless measured.
