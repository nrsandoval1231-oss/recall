# Native phone capture recovery — 2026-10-13

Built on PR #54 (`04d2990e5b3249558dbd859e2a1e9530c4655e10`), without merging or modifying that branch. The Native Memory Product Contract and exact four-panel PNG remain unchanged. The desktop design, portable library, Jev/Claude pipeline, corrections and backup remain the existing implementation.

## Usable behavior

The existing native `recall-phone` companion now saves submitted text/photos and their immutable retry identity, selected library ID and per-capture consent in browser IndexedDB before sending. A completed transaction means **Saved on this device**. Only a validated native receipt for the same library and memory means **Received by library**. That receipt does not claim organization. Inspect the native saved page for processing status.

A restored outbox retries on connection/reopening or by explicit retry, once per trigger with a 15-second request timeout. Lost acknowledgements reuse the original ID. A different library blocks transfer. Originals can be downloaded from the device queue; removing a device copy requires confirmation and does not delete the library memory. A failed local save retains the form and never sends its original. A response racing another tab cannot erase an already stored receipt or resurrect a removed device copy.

The service worker caches only `/`, `/companion.js`, `/manifest.webmanifest` and `/icon.png`. Library identity, Ask, originals and receipts are not cached. Ask remains clearly labeled live desktop keyword retrieval; offline questions stay in the form with an unavailable message. No new login, cloud dependency or network binding is introduced.

## Verification

- Red regression: `queued_capture_requires_matching_library_and_returns_durable_receipt` failed on the prior implementation (303 instead of the required 409), then passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: **257 passed**.
- `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin recall-phone`: passed, Linux.
- `npm run check`: lint, workspace/type checks, **273 tests** passed.
- `npm run build -w @recall/desktop`: passed.
- `npm run test:phone`: **6 passed**. Real Chromium IndexedDB/service worker and compiled Rust HTTP companion, real temporary library files, synthetic text and photo bytes. Covers browser/desktop restart, offline capture/replay, dropped acknowledgement, wrong library, photo byte equality, cache exclusion, forged receipt rejection and quota failure.
- Initial browser test teardown waited on an already stopped process; fixed the test harness. A rerun exposed offline setup overwriting the local-storage error message; repaired production status handling and reran all six checks.
- Screenshots: `offline-device-copy.png`, `received-by-library.png` from the actual browser/native-server workflow, not native desktop screenshots or physical phone evidence.

Run the browser suite after building the native companion. It uses port 18787 and deletes only its own synthetic temporary libraries. `RECALL_CHROMIUM` can select an installed Chromium executable. Otherwise the Playwright-installed Chromium is used. Local verification used `/usr/bin/chromium`.

## Remaining acceptance boundaries

This advances journey criterion 13; criteria 1–12 retain their prior evidence and open gates in `../native-library-editor/ACCEPTANCE.md`. This is locally verified integration, not independent device acceptance or a claim that the entire memory mission is finished.

Physical iPhone/Safari, installed Windows, actual Tailscale access/denied-peer behavior, real handwriting and live Jev/Claude remain unverified here. Browser offline reopening requires a secure context and successful first installation; on a phone that means HTTPS, for example an owner-configured Tailscale Serve endpoint preserving Host. HTTP supports queued captures in an already open page, not offline reopening. This change neither configures HTTPS nor exposes a public port. Browser storage can be evicted; a device-only copy is not a library backup. There is no offline library replica or generative answer. No provider credentials or private captures were used.
