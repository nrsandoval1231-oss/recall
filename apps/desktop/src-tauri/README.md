# Native desktop boundary

Reserved for the actual Tauri configuration, capabilities, Rust adapters, and platform-specific integration. No native implementation or permission grants exist yet.

During implementation, explicitly scope access to app-private storage and the user-selected Recall export root. Validate paths in native code, including traversal and Windows reparse-point cases. Store credentials using platform-protected storage, not plaintext cache rows. Never add an unrestricted shell command.

Export must preserve locally edited files and recover from crashes. See `docs/SYNC-AND-EXPORT.md` at the repository root.
