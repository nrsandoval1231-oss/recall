# Native desktop boundary

The native boundary owns OS-protected secrets, app-private SQLite/source persistence, and user-approved export writes. `managed_export.rs` keeps the selected Markdown root as an in-memory capability, accepts no renderer-supplied destination paths, and writes only fixed UUID filenames under `Recall/Memories` with a conflict-protecting manifest and journal. The archive command uses a native save picker and refuses existing destinations.

Capabilities (`capabilities/default.json`) still grant only `core:default`: dialogs and filesystem access occur inside narrow Rust commands. Never add an unrestricted shell or filesystem command.
