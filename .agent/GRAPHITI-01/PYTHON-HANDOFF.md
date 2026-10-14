# G1 Python Graphiti handoff

Implemented the optional local Python knowledge service and Graphiti/FalkorDB adapter in `services/backend/src/recall/knowledge/`, with lifecycle/API and durable-store tests in `services/backend/tests/test_knowledge_service.py`. Added the pinned optional Graphiti/FastEmbed dependencies, lockfile resolution, `recall-knowledge` CLI, and operator setup notes in the package README. No commit was created.

The service uses a generation-fenced SQLite queue, append-only episode ingestion, scoped rebuild on edits/deletions/revocation or interrupted work, immediate result fencing and active-task cancellation, loopback/auth/body limits, explicit provider disclosure, and a durable pre-call Anthropic cost reservation ledger. Before serving a nonempty scope, Graphiti's complete episode ledger is checked against the current source ID/revision/hash keys; a missing, stale, duplicate, or unknown local episode queues a same-generation rebuild and the query returns no results. Graphiti is configured with telemetry disabled, raw episode content disabled, a bounded Anthropic adapter, local pinned BGE-small embeddings, and local RRF. Relationships are inferred proposals with exact current episode provenance. Because Graphiti 0.30.2's separate edge-attribute extraction stage does not receive episode text, support context is the full exact source note, explicitly not a precise evidence span.

## Validation evidence

At `2026-10-13 04:59 UTC`, from `services/backend`:

- `uv run ruff format src/recall/knowledge tests/test_knowledge_service.py` — pass, no changes.
- `uv run ruff check --output-format concise src/recall/knowledge tests/test_knowledge_service.py` — pass.
- `uv run pytest tests/test_knowledge_service.py -q` — 16 passed.
- `uv run pytest -q` — 62 passed, 168 skipped because PostgreSQL `initdb` binaries are unavailable in this Windows environment.
- `uv run mypy src/recall/knowledge` — pass in Windows base environment; optional Graphiti dependencies are intentionally not installed there.
- `PYTHONPATH=src ~/.local/recall-graphiti/bin/mypy src/recall/knowledge` in WSL against the installed Graphiti optional environment — pass, 7 source files.

The controller independently reports that the real configured Anthropic structured-output probe passed for synthetic content, and that a search-only probe against the persisted synthetic FalkorDB graph returned two relationships from both query and blank exploration, with zero foreign-scope or unknown-source results. The recorded provider ledger remained at `$0.079864` after search-only validation. These are controller-run observations, not tests executed by this worker. No real user notes were submitted by this worker. The controller's currently running service predates the final source-context, budget-cancellation, and missing-episode self-heal edits; restart it before a final service-level probe.

## Remaining validation boundary

The Windows optional extra is not runnable because upstream `falkordblite` does not support Windows; the supported service runtime is WSL. No paid provider calls were made by this worker. The live retrieval run reported here does not independently validate a fresh capture against the final loaded service version.
