# MONOLITH cloud backend

One FastAPI package (`src/recall`) backs the authenticated cloud checkpoint. It includes trusted capture, workspace-scoped native library records, synchronization, background enrichment, retrieval, and export. See [ARCHITECTURE](../../docs/ARCHITECTURE.md) for current boundaries and [STATUS](../../docs/STATUS.md) for verified progress and open release gates.

| Module | Role |
| --- | --- |
| `api` | transport: auth (JWT validation), request IDs, error envelope, routes (`api/app.py`) |
| `domain` | commands and policy: manifest validation, content validation, idempotency, upload capabilities, finalization (`domain/captures.py`) |
| `db` | pool + per-request security context, migration runner, provisioning CLI |
| `storage` | private object-store port with local (dev/test) and Supabase adapters; write-once keys |
| `ingestion` | RCL-002 worker, Claude adapter, derivatives, deterministic validation |
| `retrieval` | RCL-002 keyword search and grounded Ask |
| `sync`, `exports` | revision-aware synchronization and portable export |

Run, migrate, and test: [DEVELOPMENT](../../docs/DEVELOPMENT.md). Earlier wire and operational contracts remain in [legacy-cloud](../../docs/legacy-cloud/README.md); inspect the current routes and tests before changing them. The API connects as a non-owner role and refuses to start otherwise.

