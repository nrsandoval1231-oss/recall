# FD-01 controller acceptance

Code candidate: `8249de41ea3f204a9848d84f2eee8f53e3582e44`. Bounded independent reviewer PASS covered the identical three Python-file diff against `04fe1ff`; no findings. This evidence-only receipt does not extend review to unrelated functionality.

Controller gates, 2026-10-13, all exit 0:

- From services/backend in WSL: `ESBUILD_BINARY_PATH=/home/nrsan/.local/recall-node-tools/node_modules/@esbuild/linux-x64/bin/esbuild /home/nrsan/.local/recall-backend/bin/python -m pytest -q`: 250 passed, 31.68 seconds.
- Same interpreter: `-m ruff check .`, `-m ruff format --check .`, `-m mypy src`: PASS; 93 formatted files, 55 typed source files.
- `git diff --check`: PASS.

Authorized installed-local runtime was updated to the reviewed Python files, preserving previous package and configuration. Restart health: empty, zero pending/indexed/failed. Idle process descriptor samples were 7 then 8 during desktop requests, with no unbounded SQLite descriptor accumulation observed. This short runtime observation supplements deterministic GC-disabled tests, not a long-duration soak guarantee.

Normal installed desktop was opened; selected owner vault and native persisted controls were verified: graph enabled, include_existing=false, quoted answers enabled for the configured Anthropic model. UI refreshed to enabled with no indexed relationships. No real source content was submitted, no provider budget ledger was created, and the remaining configured cap was 1.228298 USD (prior synthetic spend 0.771702 USD). Private paths, tokens, screenshots containing private configuration, and vault data remain outside Git.

Direction: CONTINUE normal use of future captures. Parent mission remains incomplete: no real first capture or physical-phone acceptance was invented. This setup proves saved settings and working idle transport, not real-data retrieval quality. Runtime service code and desktop binary are separately identified: backend 8249de4; desktop 04fe1ff. Planning/audit elapsed and tokens UNKNOWN; no speed claim.
