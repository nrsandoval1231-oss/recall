# Native library and editor implementation evidence

Authority: PR #53 and `docs/NATIVE-MEMORY-PRODUCT-CONTRACT.md`. The approved four-panel PNG is unchanged. Obsidian is optional compatibility, not a prerequisite for this workflow.

## Slice 1 — native library ownership and editor

Implemented: native library creation/opening/default library; non-destructive Markdown/text import; standalone in-app editor; 1-second idle autosave through the existing revision-safe writer; library-scoped durable writing/editing drafts; serialized native writes and identical-operation recovery; explicit review of incoming machine proposals and external revisions; formatting and native saved-memory links; readable original text without AI; historical revisions usable as reviewed drafts; explicit recovery of removed memories with original IDs, sources and history. Refresh scans the existing native journals/history and never rewrites external edits merely to display them.

Verification: 245 real Rust tests passed in a local Rust/WebKit Docker environment (`cargo test --lib`), and `cargo check` and a real Linux Tauri debug binary build passed. Frontend: 111 desktop tests; 269 tests across the workspace; lint/typechecks and production desktop build passed. The four-size browser walkthrough passed with zero measured accessibility violations and no JavaScript errors. Browser provider responses and its native bridge are synthetic; those checks are not installed Windows/iPhone or live-provider acceptance.

Preserved: portable Markdown/source layout, immutable original/history bytes, opaque native session authorization, external-file reconciliation, Jev → Claude → deterministic publication and per-source consent/budget controls. Native library/editor operations make no model calls. Optional Obsidian launch is retained behind a compatibility disclosure.

New regression evidence includes pre-capture draft recovery, interrupted-save retry identity, typing during an in-flight save, newer external revisions, machine proposals remaining unreviewed after restart, original preservation during import/edit/restart, non-destructive library creation, and recovery refusing an externally edited removed note. Historical tests expecting a text original to be unavailable were updated because native source inspection now materializes and verifies immutable capture text without invoking AI.

## Acceptance boundaries

Actual installed Windows, physical iPhone, handwriting/live Jev/Claude quality and real Obsidian protocol launch are not established by these local checks. Phone offline recovery, broader semantic retrieval, remain the subsequent implementation work; this initial commit does not claim the entire native-memory mission complete. Native library and editor are the owner's current priority.

## Actual native runtime walkthrough

[Native runtime results](runtime/native-runtime.json) and [native editor screenshot](runtime/native-autosaved-editor.png) come from the actual Linux Tauri debug executable running under WebKit/Xvfb with the production frontend, real native IPC and real filesystem writes. Only the content is synthetic; no IPC responses or model results are mocked. Obsidian is not installed. The native app created its library, saved immutable original text, autosaved a human correction, retrieved source-backed quotes, restarted, and retrieved the same memory with an unchanged original hash. This is Linux development-runtime evidence, not installed Windows/iPhone or live-provider acceptance.

The walkthrough uncovered an inherited `unknown path` failure when no Documents directory is configured. Default-library creation now honors an explicit native override without consulting Documents, and falls back to the native home Documents location when needed. A Rust regression covers both branches.

## Slice 2 — native attachments and recovery repairs

Native Attach file preserves selected PNG/JPEG/WebP/PDF/Markdown/text bytes under an application-assigned immutable path before linking them through a human revision. Inspection verifies native library/memory ownership and the exact returned SHA-256. Save attachment copy uses a native destination picker and refuses overwriting existing files. Neither control invokes a provider. Durable library-scoped import and attachment intents retain exact operation identities across restart; imports resume native receipts before reopening a picker. Attachment recovery offers explicit retry or clearing only the pending intent while preserving stored originals/receipts. Corrupt editor drafts are archived before replacement; keyboard saves respect busy controls.

Verification: 249 native Rust tests, 113 desktop tests / 271 workspace tests, lint/typechecks, production frontend and Linux native builds passed. Four-size browser visual/accessibility checks passed with zero measured violations. Independent review identified recovery identity and attachment read-integrity issues; these were repaired before publication.

[Actual attachment evidence](runtime/native-attachment-runtime.json) and [native inspection screenshot](runtime/native-attachment-inspection.png) show a real Linux Tauri native picker attaching text, inspecting it inside Recall, and saving a byte-identical copy with the original capture hash unchanged. Modal native pickers blocked WebDriver and required X11 input; that limitation is recorded, rather than representing browser mock tests as native acceptance. Installed Windows/iPhone and live providers remain unverified. Full-library export/restore follows in Slice 3 below.

## Slice 3 — portable full-library backup and restore

Native Export library backup includes the owned `Recall/` tree: Markdown, originals, attachments, history, journals, validated interpretations and indexes. It excludes the transient writer lock and does not include OS credentials or unrelated files outside `Recall/`. Import external Markdown before exporting it as Recall memory. Unsaved editor drafts remain device-local; the management screen explicitly asks users to save them first.

Export stages a standard ZIP, verifies the exact archived snapshot through the restore validator, compares live files for concurrent external changes, and publishes with atomic no-replace rename. Restore checks paths, duplicate/case aliases, links, entry counts, total/per-file/manifest sizes, every SHA-256, native history/source integrity and attachment receipts. It creates a new library folder, preserving library and memory IDs; existing libraries and backup files are never merged/overwritten. Failed restore staging remains available for inspection. Current bounded limits are 2 GiB total, 64 MiB per file, 100,000 archive entries and 16 MiB manifest.

255 Rust tests passed; lint, typechecks, 271 workspace tests, production frontend and Linux native builds passed. Independent review found an export snapshot race and mismatched limits; both were repaired. A deterministic regression changes original bytes after preflight and confirms no invalid archive is published. Additional tests cover edited and deleted memory roundtrips, attachments/history, tampered ZIP rejection, original-integrity refusal and overwrite protection.

[Real native export/restore results](runtime/native-backup-runtime.json), [export screenshot](runtime/native-library-export.png) and [restored attachment screenshot](runtime/native-library-restored-attachment.png) verify the final Linux Tauri implementation using actual native pickers and filesystem writes. All 17 archived file hashes matched; the original library remained present; retrieval, editor and attachment inspection worked from the restored library. Native walkthrough source: `tests/native/library_backup_runtime.py`. Installed Windows runtime acceptance remains unverified.
