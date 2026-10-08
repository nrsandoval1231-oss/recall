# Recall desktop (Tauri 2 + React, Windows first)

Desktop defaults to the local-only Memory Surface: choose a vault, import one PNG/JPEG/WebP, search human notes/filenames, inspect original bytes, correct a note and review retained history. The lifecycle slice adds flat Markdown renames, explicit missing-note restore, retained logical removal/removed-items history and annotation-search rebuild. No sign-in, cloud variables or remote service is required. The native adapter owns scoped disk operations; the renderer cannot select arbitrary paths. Browser preview truthfully cannot save a vault.

From the repository root, run `npm ci`, then `npm run tauri -w @recall/desktop -- dev` with Rust 1.89+ and Tauri prerequisites. See [developer instructions](../../docs/DEVELOPMENT.md#local-only-desktop-foundation) and [verification/limits](../../docs/implementation/local-vault/README.md).

Human annotation is not OCR or verified photo content. This foundation does not include phone synchronization, QR, AI interpretation, full RCL-005B or legacy-data migration. Installed Windows acceptance is open. PR11 produced unsigned artifact `11521925107` in run `37708945255` without cloud configuration; lifecycle exact-head CI/artifact verification is separate and pending. See [lifecycle compatibility and limitations](../../docs/implementation/local-vault-lifecycle/README.md). Logical removal is not physical deletion, secure purge or undelete.

The previous cloud application remains available only via explicit `?mode=legacy-cloud`, with its existing configuration and authentication requirements. Its API, source verification, SQLite/offline sync, outbox, export and privacy contracts remain preserved. The default local entry does not construct cloud authentication.
