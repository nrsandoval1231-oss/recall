# FD-01 completion evidence

- Worktree/base supplied by controller: `integrate/graphiti`, `04fe1ff0b094fb9ef7814ffd83819ffc80293876`.
- Builder start UTC: UNKNOWN; finish UTC: `2026-10-13 13:19:45 UTC`.
- Changed files: `services/backend/src/recall/knowledge/store.py`, `services/backend/src/recall/knowledge/providers.py`, `services/backend/tests/test_knowledge_service.py`.
- Measured tokens: UNKNOWN.
- No real note content was read, no credentials were accessed, and no provider calls were made.

The service inspection found 508 open descriptors to the same SQLite database inode, plus its WAL/SHM files and five sockets. The process soft descriptor limit was 1,024 (hard limit 1,048,576); systemd's effective `LimitNOFILE` property was 1,048,576. The service was stopped by the controller before implementation.

The store and budget ledger used SQLite connection context managers as if they closed connections. SQLite's context manager commits or rolls back but does not close. Both paths now use explicit connection-closing context managers. Store setup closes its connection if PRAGMA configuration fails; successful and exceptional operations retain commit/rollback behavior. Tests instrument SQLite connections and verify explicit closure with garbage collection disabled, including injected setup/SQL failures and budget rollback.

Validation on the changed candidate:

- `uv run --project services/backend pytest services/backend/tests/test_knowledge_service.py services/backend/tests/test_knowledge_answers.py -q` — 36 passed.
- `uv run --project services/backend ruff check services/backend/src/recall/knowledge/store.py services/backend/src/recall/knowledge/providers.py services/backend/tests/test_knowledge_service.py` — passed.
- `uv run --project services/backend mypy --config-file services/backend/pyproject.toml services/backend/src/recall/knowledge/store.py services/backend/src/recall/knowledge/providers.py` — passed, two source files.
- WSL Ruff format check on the three changed Python files — passed.
- `git diff --check` on the three changed Python files — passed.

The controller owns installed-service restart and post-restart descriptor-growth verification. No claim of runtime repair acceptance is made until that check passes.
