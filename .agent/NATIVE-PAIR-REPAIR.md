# NATIVE-PAIR-REPAIR bounded packet

Dependency: PAIR-01 native handoff. Same repository/branch/base. Luna explicitly reported material uncertainty implementing lifecycle serialization and failure-test seams; Terra selected under the optional senior-specialist rule. This is a bounded repair, not a new architecture.

Exclusive ownership: apps/desktop/src-tauri/src/pairing.rs, reading_commands.rs, lib.rs, Cargo.toml/Cargo.lock if needed, and .agent/NATIVE-PAIR-REPAIR-COMPLETION.json. Luna retains backend/client/preflight/docs. No shared source edits.

Repair: serialize native pairing lifecycle so late status cannot restore credentials after disconnect. Keep network off UI thread and outside vault authority lock. Test real shared production core with synthetic injectable keyring/transport for lost responses, restart, bound identities/scopes, keyring failure, offline revocation retention and concurrent lifecycle changes. Native credentials never renderer/vault; service origin stays pinned. Existing reading fingerprint/receipt/revision/correction/tombstone fences remain.

Validation: portable rustfmt on affected native sources; CI cargo test/check mandatory. No real keyring writes, enrollment, network/provider dispatch, spending, installation, commit/push/merge/deploy. Two materially different safe repair attempts; report blockers with evidence. Return concise completion claim and actual checks; independent reviewer certifies neither builder's summary nor absent native compile proof.
