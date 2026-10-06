# Recall desktop

Planned Tauri 2 / React / TypeScript application, Windows first. No runnable app exists yet.

The desktop is Recall's richer workspace and local bridge. RCL-001 needs only sign-in, recent captures, and original viewing. Later packets add Ask, SQLite cache/outbox, local full-text search, source downloads, and safe Markdown export.

Match mobile terminology and design tokens; desktop DOM views need not be the same components as React Native views. No separate bridge daemon, marketing website, or competing local Postgres database.

Native adapters own protected tokens, local files, cache, and export permissions. The WebView must not receive arbitrary shell/filesystem access.
