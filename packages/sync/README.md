# Client capture engine (`@recall/sync`)

Transport- and platform-independent logic for RCL-001's local-first capture, with ports for files and file upload (`src/ports.ts`):

- `draft.ts` — in-memory ordered pages (add/remove/reorder/retake, max 10). Not durable.
- `local-store.ts` — **durable Save**: copy into app-private storage → re-read and hash → ordered manifest → one atomic directory rename (the commit point). `recover()` reconciles after a crash/force-close without deleting acknowledged data.
- `syncer.ts` — resumable, idempotent create → upload only missing pages → finalize. "Uploaded" requires the server-computed SHA-256 of every page to equal the device's hash. Refuses to upload changed local bytes or another account's captures. Never deletes local originals.
- `testing/` — node:fs adapter, fake server with failure injection, crash injector. Test-only; never bundled into apps.

RCL-004 will extend this with the change feed and outbox; nothing of that exists yet.
