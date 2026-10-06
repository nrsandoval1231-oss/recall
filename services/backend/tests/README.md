# Backend tests

Real PostgreSQL (a throwaway cluster started by `conftest.py` via `initdb`; tests skip with a message if the server binaries are missing), real RLS with a non-owner API role, a private temp object store, and a locally generated token-signing key (the only simulated part: the identity provider). Synthetic images only.

`test_capture` (A01/A04), `test_idempotency` (A03), `test_isolation` (A12), `test_failures` (A04/A05, restarts), `test_auth`, `test_migrations` (migration and DB-invariant checks), `test_objectstore`, `test_contract`, `test_e2e_clients` (real uvicorn + TypeScript clients, needs `npm install`).
