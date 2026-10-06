# Recall backend

One FastAPI package (`src/recall`). RCL-001 implements the trusted-capture API; there is no worker, AI, or retrieval yet.

| Module | Role |
| --- | --- |
| `api` | transport: auth (JWT validation), request IDs, error envelope, routes (`api/app.py`) |
| `domain` | commands and policy: manifest validation, content validation, idempotency, upload capabilities, finalization (`domain/captures.py`) |
| `db` | pool + per-request security context, migration runner, provisioning CLI |
| `storage` | private object-store port with local (dev/test) and Supabase adapters; write-once keys |
| `ingestion`, `retrieval`, `sync`, `exports` | reserved for later packets |

Run, migrate, and test: [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md). Contract: [docs/API-CONTRACT.md](../../docs/API-CONTRACT.md). The API connects as a non-owner role and refuses to start otherwise.
