# MONOLITH desktop

The product: React Memory Surface (`src/`) plus the Rust core and `recall-phone` binary (`src-tauri/`). Independent local-library mode plus authenticated browser/PWA and optional native cloud mode. Technical Recall identifiers remain compatible.

**Visual authority:** [MONOLITH guide](../../branding/monolith/v1/BRAND_GUIDE.md) and [DESIGN.md](../../docs/DESIGN.md), owner-selected 2026-10-17. Earlier boards and orbital/ivory identity are superseded. Preserve all working evidence and offline behavior.

- `npm run dev`: authenticated browser entry; synthetic UI verification uses the existing explicit fixture harness.
- `npx tauri dev`: the real app.
- `npm run phone`: phone Capture/Ask server for the same library.

See [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md) for setup, model configuration and the phone, [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for how it fits together, and [docs/STATUS.md](../../docs/STATUS.md) for visual evidence and remaining acceptance limits. `?mode=legacy-cloud` no longer activates an alternative UI; the shared Memory Surface is used by native and authenticated cloud entries. The Windows NSIS build is unsigned.
