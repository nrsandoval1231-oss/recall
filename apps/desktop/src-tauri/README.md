# Native desktop boundary

`secrets.rs` is the only app-specific native code: three commands over the OS credential store. Capabilities (`capabilities/default.json`) grant only `core:default`. When later packets need local files (downloads, export), scope them to app-private directories and one approved export root and validate paths in native code (traversal, symlinks/reparse points). Never add an unrestricted shell or filesystem command.
