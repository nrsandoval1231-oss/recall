# Client capture engine (`@monolith/sync`)

Transport- and platform-independent logic for RCL-001's local-first capture, with ports for files and file upload (`src/ports.ts`):

- `draft.ts` — in-memory ordered pages (add/remove/reorder/retake, max 10). Not durable.
- `local-store.ts` — **durable Save**: copy into app-private storage → re-read and hash → ordered manifest → one atomic directory rename (the commit point). `recover()` reconciles after a crash/force-close without deleting acknowledged data.
- `syncer.ts` — resumable, idempotent create → upload only missing pages → finalize. "Uploaded" requires the server-computed SHA-256 of every page to equal the device's hash. Refuses to upload changed local bytes or another account's captures. Never deletes local originals.
- `testing/` — node:fs adapter, fake server with failure injection, crash injector. Test-only; never bundled into apps.

This package remains the mobile capture/upload engine. The authenticated cloud change feed is implemented separately under `services/backend/src/monolith/sync`; this package does not implement Obsidian vault transport or the local desktop vault. Product-level phone-to-vault synchronization remains open.
