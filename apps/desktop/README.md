# Recall desktop

The product: React Memory Surface (`src/`) plus the Rust core and `recall-phone` binary (`src-tauri/`). No login. Memory lives in a local Recall library folder.

- `npm run dev`: browser preview with a labelled synthetic fixture; cannot write files.
- `npx tauri dev`: the real app.
- `npm run phone`: phone Capture/Ask server for the same library.

See [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md) for setup, model configuration and the phone, and [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for how it fits together. `?mode=legacy-cloud` opens the frozen cloud-era client and is not the product path. The Windows NSIS build is unsigned.
