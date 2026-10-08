# Native split-credential repair

Base candidate: 549688100d34fe795fac386bb889a7b11feea3fc. Independent Sol verdict FIX: status/disconnect falsely report disconnected when pending entry is absent while active connection survives.

Owner: native_pairing_repair (Terra), pairing.rs and completion artifact only. Preserve other changes. Acceptance: inspect both protected entries; no false disconnected/revoked result under absent or malformed pending with active connection; no credential loss before server revocation; origin/device/vault binding remains validated; fake-store regressions. Native formatting local; cargo test/check required CI. No real enrollment, network or credential writes. Retry budget two materially different repairs.

Controller interrupted full backend suite after stall; result UNKNOWN, rerun with per-test log and 60s faulthandler diagnostic. Existing client unit/browser/build and backend static checks pass for base candidate. Re-freeze and independently review repaired candidate before publication.
