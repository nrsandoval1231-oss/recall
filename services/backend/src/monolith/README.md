# Python package boundaries

- `api`: HTTP transport, auth (JWT validation), routes, error envelope.
- `domain`: commands and policy — captures/uploads/finalize (`captures.py`), consent/budget/enqueue (`processing.py`), memories/search/Ask orchestration (`memories.py`), manifest + content validation, signed tokens.
- `ingestion` (RCL-002): durable worker (`worker.py`, `python -m monolith.ingestion.worker`), provider boundary (`provider.py`) and Claude adapter (`anthropic_provider.py`), prompts, model-input derivatives (`images.py`), deterministic validation (`validate.py`).
- `retrieval` (RCL-002): authorized keyword search (`search.py`), grounded Ask with server-resolved citations (`ask.py`).
- `db`: pool, per-request security context, migrations, provisioning.
- `storage`: private object-store port (local, Supabase).
- `sync`: implemented authenticated workspace change-feed and snapshot routes/services (`sync/routes.py`, `sync/service.py`).
- `domain.export` and `api.export`: implemented portable snapshot/export job contracts. There is no separate `monolith.exports` package; native desktop owns selected local filesystem writes.

API and worker share these modules; they run as separate processes with separate least-privilege database roles.

This package serves the retained authenticated cloud implementation and a narrowly scoped, default-denied selected-photo inference API. The no-sign-in local desktop vault adapter is native Tauri code, not a Python API call. Neither path alone proves complete phone-to-vault synchronization or current product acceptance.
