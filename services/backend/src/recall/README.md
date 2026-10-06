# Python package boundaries

These directories are reserved, not implemented:

- `api`: HTTP schemas/auth/transport.
- `domain`: deterministic commands, identity policy, versions, and correction rules.
- `ingestion`: jobs, image derivatives, provider adapter, validation, and commit orchestration.
- `retrieval`: authorized search, evidence selection, and grounded answers.
- `sync`: committed change feed, snapshots, commands, and tombstones.
- `exports`: portable snapshots/manifests, not uncontrolled local filesystem writes.
- `db`: transactions, repositories, auth context, and persistence.

Keep API and worker entrypoints thin and share domain code. Avoid circular module dependencies and unrelated abstractions before real use cases exist.
