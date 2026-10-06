# Recall desktop (Tauri 2 + React, Windows first)

RCL-001 scope only: email-code sign-in, recent captures with the shared status words, multi-page original viewer that hash-verifies every downloaded page, source metadata, "Save exact copy". An empty account is shown as empty. No dashboards, AI, search, or Obsidian.

Native boundary (`src-tauri`): three credential-store commands (`secret_get/set/remove`, fixed service name, validated keys, bounded values) backed by the OS credential store. No fs/shell/http plugins; the WebView has no filesystem access. The auth session is chunked to fit Windows Credential Manager limits.

Only a Linux `cargo check/test` and a Vite build were run; the Windows build/installer is **not verified** (ACCEPTANCE gate G4). Setup/run: [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md).
