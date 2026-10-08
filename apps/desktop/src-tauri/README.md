# Native desktop boundary

The default local desktop uses `local_vault.rs`: native folder/photo selection, immutable originals, append-only human revisions, journaled commits, hash validation and conflict-safe direct-body-edit reconciliation. Selected-vault commands require `expectedVaultId`; `vault_identity` is stable display/intent scope only and cannot authorize operations. No renderer-provided paths are accepted. Rust 1.89+ is required for filesystem locks. See [local foundation evidence and limitations](../../../docs/implementation/local-vault/README.md). The legacy cache/export boundary described below remains preserved.

The native boundary owns OS-protected secrets, app-private SQLite/source persistence, and user-approved export writes. `managed_export.rs` keeps the selected Markdown root as an in-memory capability, accepts no renderer-supplied destination paths, and writes only fixed UUID filenames under `Recall/Memories` with a conflict-protecting manifest and journal. The archive command uses a native save picker and refuses existing destinations.

Pilot cache limits are enforced transactionally per user/workspace: 10,000 records and 32 MiB of record payloads, 5,000 downloaded originals totaling 512 MiB, and 1,000 outbox commands totaling 32 MiB. A limit failure preserves the prior cursor, cache, and outbox and never evicts pending commands.

Capabilities (`capabilities/default.json`) still grant only `core:default`: dialogs and filesystem access occur inside narrow Rust commands. Never add an unrestricted shell or filesystem command.
