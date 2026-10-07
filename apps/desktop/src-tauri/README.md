# Native desktop boundary

The native boundary owns OS-protected secrets, app-private SQLite/source persistence, and user-approved export writes. `managed_export.rs` keeps the selected Markdown root as an in-memory capability, accepts no renderer-supplied destination paths, and writes only fixed UUID filenames under `Recall/Memories` with a conflict-protecting manifest and journal. The archive command uses a native save picker and refuses existing destinations.

Pilot cache limits are enforced transactionally per user/workspace: 10,000 records and 32 MiB of record payloads, 5,000 downloaded originals totaling 512 MiB, and 1,000 outbox commands totaling 32 MiB. A limit failure preserves the prior cursor, cache, and outbox and never evicts pending commands.

Capabilities (`capabilities/default.json`) still grant only `core:default`: dialogs and filesystem access occur inside narrow Rust commands. Never add an unrestricted shell or filesystem command.
