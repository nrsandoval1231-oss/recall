# FD-01: close SQLite connections deterministically

READY localized reliability repair discovered during authorized real-vault setup.
Base: integrate/graphiti, 04fe1ff0b094fb9ef7814ffd83819ffc80293876.
Worktree: C:/Users/nrsan/.codex/worktrees/recall-graphiti/Recall.

Observed: idle systemd knowledge service exhausted its 1024 soft file limit and worker stopped before ingesting any real sources. SQLite transaction context managers do not close connections.

Luna owns knowledge/store.py, knowledge/providers.py if the same issue exists, focused connection lifecycle tests, and FD-REPAIR completion evidence. No UI, ontology, vault format, provider contracts, real source content, credentials, or model calls. Do not alter other builder edits. Preserve transaction commit/rollback, checkpoint privacy semantics, queue recovery and budget accounting. Two bounded repair attempts maximum.

Acceptance: deterministic connection closure on success and exception; idle poll/health loop remains bounded with GC disabled; existing knowledge/answer tests pass; Ruff and mypy pass. Controller verifies real service restart and idle descriptor count without ingesting data, then independent review. No production-readiness claim. No merge or remote deployment. Owner authorized local operational setup; only accepted changed runtime package files may update the installed local service, with backup.

Record exact commands, UTC timing, changed files, measured or UNKNOWN tokens, and limitations in FD-REPAIR-COMPLETION.md. No commits by builder. Controller commits integrated candidate after validation.
