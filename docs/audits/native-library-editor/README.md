# Native library and editor implementation evidence

Authority: PR #53 and `docs/NATIVE-MEMORY-PRODUCT-CONTRACT.md`. The approved four-panel PNG is unchanged. Obsidian is optional compatibility, not a prerequisite for this workflow.

## Slice 1 — native library ownership and editor

Implemented: native library creation/opening/default library; non-destructive Markdown/text import; standalone in-app editor; 1-second idle autosave through the existing revision-safe writer; library-scoped durable writing/editing drafts; serialized native writes and identical-operation recovery; explicit review of incoming machine proposals and external revisions; formatting and native saved-memory links; readable original text without AI; historical revisions usable as reviewed drafts; explicit recovery of removed memories with original IDs, sources and history. Refresh scans the existing native journals/history and never rewrites external edits merely to display them.

Verification: 245 real Rust tests passed in a local Rust/WebKit Docker environment (`cargo test --lib`), and `cargo check` and a real Linux Tauri debug binary build passed. Frontend: 111 desktop tests; 269 tests across the workspace; lint/typechecks and production desktop build passed. The four-size browser walkthrough passed with zero measured accessibility violations and no JavaScript errors. Browser provider responses and its native bridge are synthetic; those checks are not installed Windows/iPhone or live-provider acceptance.

Preserved: portable Markdown/source layout, immutable original/history bytes, opaque native session authorization, external-file reconciliation, Jev → Claude → deterministic publication and per-source consent/budget controls. Native library/editor operations make no model calls. Optional Obsidian launch is retained behind a compatibility disclosure.

New regression evidence includes pre-capture draft recovery, interrupted-save retry identity, typing during an in-flight save, newer external revisions, machine proposals remaining unreviewed after restart, original preservation during import/edit/restart, non-destructive library creation, and recovery refusing an externally edited removed note. Historical tests expecting a text original to be unavailable were updated because native source inspection now materializes and verifies immutable capture text without invoking AI.

## Acceptance boundaries

Actual installed Windows, physical iPhone, handwriting/live Jev/Claude quality and real Obsidian protocol launch are not established by these local checks. Phone offline recovery, broader semantic retrieval, full-library export/restore, and attachments remain the subsequent implementation work; this initial commit does not claim the entire native-memory mission complete. Native library and editor are the owner's current priority.

## Actual native runtime walkthrough

[Native runtime results](runtime/native-runtime.json) and [native editor screenshot](runtime/native-autosaved-editor.png) come from the actual Linux Tauri debug executable running under WebKit/Xvfb with the production frontend, real native IPC and real filesystem writes. Only the content is synthetic; no IPC responses or model results are mocked. Obsidian is not installed. The native app created its library, saved immutable original text, autosaved a human correction, retrieved source-backed quotes, restarted, and retrieved the same memory with an unchanged original hash. This is Linux development-runtime evidence, not installed Windows/iPhone or live-provider acceptance.

The walkthrough uncovered an inherited `unknown path` failure when no Documents directory is configured. Default-library creation now honors an explicit native override without consulting Documents, and falls back to the native home Documents location when needed. A Rust regression covers both branches.
