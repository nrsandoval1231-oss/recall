# Claude vault reading implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute each task with tests and an independent spec/quality review.

**Goal:** Deliver selected full-page Claude readings as unreviewed, correctable, searchable local vault memory.

**Architecture:** Native vault authority owns originals, interpretation history and human overrides. A protected server boundary reuses existing Claude ingestion validation and budget machinery, while native-only transport binds requests/results to the selected source and revision. Default connection is disabled pending separately authorized device provisioning.

**Tech Stack:** Rust/Tauri, React/TypeScript, Python/FastAPI/PostgreSQL, existing Anthropic Provider and Pillow derivatives.

**Spec:** [Selected-photo Claude reading](../specs/2026-10-08-claude-vault-reading-design.md).

## Global Constraints

- No account/password/email-link sign-in, including first use; QR not approved.
- Claude full-page vision is primary; no OCR or speculative router.
- Explicit selected-photo intent only; immutable original bytes, vault authority, separate human and machine attribution.
- No credentials generated, grants/enrollment, real data, paid calls, production changes, merge or deployment.
- Reuse existing Provider, derivative, extraction and durable budget contracts. No parallel canonical memory database.
- Existing v1/v2 events retain exact bytes; new semantics fence old writers.
- Independent task reviews and final whole-branch review; exact-head CI on stacked draft PR based on ee7898506d7905c4b424f49f9696b5b815784aa2.

## Review Focus

- Cancellation after server dispatch must not publish or conceal possible provider cost (tasks 1–3).
- Concurrent direct edits/removal or a vault switch must invalidate pending results (tasks 2–3).
- Lost HTTP responses/restarts must preserve idempotency and uncertain budget holds (tasks 1–2).
- Crafted results and Markdown must not relabel human/machine content or bypass source binding (tasks 1–2).
- Unconfigured access and stale/revoked device membership must fail closed without breaking local capture/search (tasks 1–3).

### Task 1: Protected selected-photo inference service

**Files:** create `services/backend/src/recall/ingestion/local_reading.py`, `services/backend/src/recall/api/local_reading.py`, backend tests and versioned shared contract documentation/schema as needed; modify `api/app.py` and minimal operational receipt migration if needed.

**Interfaces:** Produce POST `/v1/local-readings` and a bounded result/recovery contract. Define exact request/response fields in `docs/API-CONTRACT.md` for native consumption before completing. Inject device authorization which defaults to deny; derive existing operational principal/workspace without first-use provisioning. Reuse existing budget reservation and image/extraction code. Provider calls occur outside database locks. Operational receipts are scoped, bind payload, and distinguish complete/in-flight/unknown failures; no canonical cloud capture.

- [x] Write failing HTTP/domain tests for default denial before bytes, scoped authorized synthetic image, binding/hash/size failures, validated extraction, duplicate/in-flight replay, malformed/refusal/timeout responses, budget/consent and revocation.
- [x] Run focused tests and record initial failures.
- [x] Implement smallest protected service and operational receipts, with bounded request sizes and sanitized errors. Keep existing cloud routes unchanged.
- [x] Run focused tests, ruff and mypy; commit and report exact interface, retention, tests and residual limits.

### Task 2: Native reading history and protected transport

**Files:** `apps/desktop/src-tauri/src/local_vault.rs`, narrow new reading/transport modules, `lib.rs`, Cargo manifest/lock only if transport requires; `apps/desktop/src/platform/local-vault.ts` and adapter tests for the declared contract.

**Interfaces:** Consume task 1 HTTP contract. Produce native capability/status, explicit read/cancel or prepare/commit commands, reading correction command, and reading fields in memory/history DTOs. Renderer cannot supply paths, secrets or arbitrary URLs. Native configuration reads an existing scoped connection from protected storage only; no provisioning command. Tests may inject loopback transport without production bypass.

- [x] Write failing tests for source/revision bound unreviewed commit, retained machine proposal versus human correction, retry, stale/delete/switch/cancel, original equality, reopen/rebuild and v1/v2 compatibility/writer fence.
- [x] Run focused tests to establish failures.
- [x] Implement versioned events through existing atomic journal and receipt machinery; search effective reading and render readable provenance without conflating annotation. Keep network I/O outside vault locks; revalidate on completion.
- [x] Exercise actual local synthetic HTTP request/response including auth header, timeout/invalid body and redirection rejection; verify default capability disabled.
- [x] Run native/adapter suites, commit and report exact DTO/commands and tests.

### Task 3: Visible reading/review flow and delivery evidence

**Files:** `apps/desktop/src/local/LocalVaultApp.tsx`, `local.css`, focused tests, `tests/local-vault/*`, canonical PRD/architecture/roadmap/status and `docs/implementation/claude-vault-reading/README.md`.

**Interfaces:** Consume task 2 LocalVault contract; no renderer credential/provider client. Reading action applies only to selected active memory after explicit intent, with cancel/retry and source comparison. Unconfigured service displays honest explanation while local use remains available.

- [x] Write failing UI tests for explicit consent, unreviewed label, uncertainty/attribution, correction precedence, searching effective text, error/cancel/retry, navigation/vault-switch stale completions and no automatic upload.
- [x] Implement focused controls matching existing warm Memory Surface, optional annotation intact, no fake Ask.
- [x] Extend browser synthetic journeys, run meaningful real-browser checks and save synthetic screenshots/evidence; no live model quality claim.
- [x] Update canonical documents with Claude primary and exact implemented/disabled/remaining boundaries; preserve historic evidence and proposed QR choice.
- [x] Run relevant suites, lint/typecheck/build and commit.
- [ ] Independent Task 3 and whole-branch final review, then all exact-head CI jobs after opening stacked draft PR; repair verified failures, never merge/deploy.
