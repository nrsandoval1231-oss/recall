# Repository tree and ownership

This is an illustrative top-level map, not an exhaustive file tree. The repository now has runnable mobile, desktop, web, backend, shared-contract/sync and infrastructure surfaces. The backend's `ingestion` and `retrieval` modules implement the preserved cloud processing and Ask paths; `sync` implements the authenticated change feed; export commands live in `domain/export.py` and `api/export.py`. There is no separate `recall.exports` package. The native local-vault and selected-photo reading implementation lives in `apps/desktop/src-tauri`; current product truth and implementation limits are in [PRD](PRD.md), [architecture](ARCHITECTURE.md), [roadmap](ROADMAP.md) and [status](V1-STATUS.md).

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

`services/backend` is one Python package with separate API and worker entrypoints. Its migrations own the application database schema. `infra/supabase` documents the preserved cloud pilot's platform/auth/storage setup; it must not create a competing application migration history. The local desktop vault is not a backend service.

`tests/fixtures/synthetic` is safe public contract data. Real pilot material remains private and outside this tree. `tests/evaluation` contains harness logic and redacted/synthetic evaluation fixtures, never private scans or labels.

`docs/PRD.md` owns product scope. Architecture/data/API/sync documents own their named contracts. ROADMAP owns packet ordering. ACCEPTANCE owns release evidence expectations. Update these in place rather than spawning alternate PRDs.

## Intentionally absent

No separate bridge service, graph database, vector-service folder, agent framework or model router. The repository does contain the bounded Claude photo-reading adapter and legacy cloud provider/retrieval modules; these do not constitute a general assistant connector or full-memory LLM organization service. Add new services only after a concrete approved need.
