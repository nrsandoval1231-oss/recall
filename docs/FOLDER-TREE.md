# Repository tree and ownership

This was the starter layout. RCL-001 added runnable packages in `apps/mobile`, `apps/desktop`, `services/backend`, `packages/{api-client,design-tokens,sync}`, `tests/e2e`, `scripts/dev-db.sh`, `.github/workflows/ci.yml`, a root npm workspace, and `docs/DEVELOPMENT.md`. The backend also has a `storage/` adapter package (object-store port, local and Supabase adapters) beside the documented modules; `ingestion`, `retrieval`, `sync`, and `exports` remain reserved.

```text
recall/
  README.md
  AGENTS.md
  .editorconfig
  .env.example
  .gitignore
  .github/
    pull_request_template.md
  apps/
    mobile/
      README.md
      src/
    desktop/
      README.md
      src/
      src-tauri/
        README.md
        src/
        capabilities/
  packages/
    contracts/
      README.md
      capture.schema.json
      extraction.schema.json
    api-client/
      README.md
      src/
    design-tokens/
      README.md
      src/
    sync/
      README.md
      src/
  services/
    backend/
      README.md
      migrations/
        README.md
      src/
        recall/
          README.md
          api/
          domain/
          ingestion/
          retrieval/
          sync/
          exports/
          db/
      tests/
        README.md
  tests/
    fixtures/
      synthetic/
        README.md
        maintenance-capture.json
        maintenance-extraction.json
    evaluation/
      README.md
    e2e/
      README.md
  infra/
    README.md
    supabase/
      README.md
  scripts/
    README.md
  docs/
    PRD.md
    ARCHITECTURE.md
    DATA-MODEL.md
    API-CONTRACT.md
    AI-INGESTION.md
    SYNC-AND-EXPORT.md
    UX-SPEC.md
    SECURITY-AND-OPERATIONS.md
    ACCEPTANCE.md
    ROADMAP.md
    BUILD-HANDOFF.md
    FOLDER-TREE.md
    REFERENCES.md
```

## Boundary rules

`apps/mobile` owns Expo/native screens and device adapters. `apps/desktop` owns React desktop screens and Tauri-native storage/export adapters. Share contracts, API behavior, token names, and sync semantics; do not force DOM and native views into a pretend universal UI package.

`packages/contracts` contains versioned capture/extraction envelopes and associated examples. When OpenAPI is introduced, generated client types belong in `packages/api-client`; do not maintain a second handwritten API specification that drifts from runtime behavior.

`packages/sync` owns reusable client protocol/state logic, not a second server implementation or a universal filesystem layer. Platform persistence adapters stay in each app.

`services/backend` is one Python package with API and worker entrypoints once implemented. Its migrations own the application database schema. `infra/supabase` documents platform/auth/storage setup; it must not create a competing application migration history.

`tests/fixtures/synthetic` is safe public contract data. The real pilot corpus lives in approved private storage outside this tree. `tests/evaluation` will hold harness logic and redacted manifest formats, never private scans or labels.

`docs/PRD.md` owns product scope. Architecture/data/API/sync documents own their named contracts. ROADMAP owns packet ordering. ACCEPTANCE owns release evidence expectations. Update these in place rather than spawning alternate PRDs.

## Intentionally absent

No marketing website, independent web product, separate bridge service, graph database, vector-service folder, agent framework, model router, billing service, or implemented Claude connector. Add those only after a concrete approved need.
