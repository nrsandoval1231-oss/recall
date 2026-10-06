# Python package boundaries

- `api`: HTTP transport, auth (JWT validation), routes, error envelope.
- `domain`: commands and policy — captures/uploads/finalize (`captures.py`), consent/budget/enqueue (`processing.py`), memories/search/Ask orchestration (`memories.py`), manifest + content validation, signed tokens.
- `ingestion` (RCL-002): durable worker (`worker.py`, `python -m recall.ingestion.worker`), provider boundary (`provider.py`) and Claude adapter (`anthropic_provider.py`), prompts, model-input derivatives (`images.py`), deterministic validation (`validate.py`).
- `retrieval` (RCL-002): authorized keyword search (`search.py`), grounded Ask with server-resolved citations (`ask.py`).
- `db`: pool, per-request security context, migrations, provisioning.
- `storage`: private object-store port (local, Supabase).
- `sync`, `exports`: reserved (RCL-004/005).

API and worker share these modules; they run as separate processes with separate least-privilege database roles.
