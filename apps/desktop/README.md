# Recall desktop

The product: React Memory Surface (`src/`) plus the Rust core and `recall-phone` binary (`src-tauri/`). No login. Memory lives in a local Recall library folder.

**Visual authority:** [docs/DESIGN.md](../../docs/DESIGN.md), locked by the owner on 2026-10-15. The approved photo-free desktop/mobile/brand boards replace all previous UI references. Current CSS, fixture names and old assets are implementation to migrate, not a competing design specification. Do not remove working capture, source inspection, revision, consent, provider or pairing behavior during the visual work.

- `npm run dev`: browser preview with a labelled synthetic fixture; cannot write files.
- `npx tauri dev`: the real app.
- `npm run phone`: phone Capture/Ask server for the same library.

See [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md) for setup, model configuration and the phone, [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for how it fits together, and [docs/STATUS.md](../../docs/STATUS.md) for PNG import and visual migration status. `?mode=legacy-cloud` opens the frozen cloud-era client and is not the product path or an approved visual alternative. The Windows NSIS build is unsigned.
