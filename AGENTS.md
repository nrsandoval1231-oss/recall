# Recall builder instructions

## Start here

Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and the active packet before changing code. The repository includes an implemented local desktop foundation and a separate legacy cloud baseline; read current status and acceptance evidence before making capability claims.

Preserve the product: a pen-and-paper user photographs notes and retrieves source-backed memories. Mobile and desktop are one product. Obsidian is the required, user-owned memory spine. Recall supplies capture, intelligence and the Memory Surface over that vault. Do not rebuild a general productivity suite.

## Non-negotiable invariants

- Product target: no account/password/email-link sign-in, including first use. Local-only use requires no remote account. Cross-device private access still requires secure owner-approved device association; QR pairing is proposed, not approved. Never satisfy this requirement by removing authentication from public private-data APIs. The owner subsequently authorized continuing the local-first no-sign-in design through implementation without routine stage-by-stage approval questions. Execute the bounded local-only foundation and authorized lifecycle plans with review/tests; QR pairing remains proposed and excluded. This does not authorize production auth/access changes, migration of real data, merge or deployment.

- Target authority is the Obsidian vault: portable memory notes, links, original attachments and versioned provenance/history. PostgreSQL/pgvector and SQLite support operations, authorization, indexing, synchronization and caches; they must not become the sole owner of memory. New local desktop records are vault-authoritative. Legacy cloud records remain database-authoritative and unmigrated until the documented migration is implemented and verified. Do not claim that migration is complete or remove existing integrity/privacy guarantees.
- All private records and queries are workspace-scoped. Check authorization before retrieval, model context construction, source access, and mutation.
- Never commit real captures, client data, credentials, local databases, vault exports, or private test corpora. Synthetic fixtures must be clearly marked.
- Save original bytes durably before AI processing. Report local-only, uploaded, processed, and failed states honestly.
- Model output is untrusted input. Validate schema and references; the model cannot choose permissions, paths, SQL, or arbitrary tools.
- Never turn a question mark, hypothesis, illegible number, or unresolved first name into a verified fact or identity.
- Reprocessing must not undo a human correction. Every material answer needs eligible source evidence.
- Retry-safe writes, optimistic concurrency, and atomic journaled vault writes are required. Direct vault edits must participate in conflict-safe reconciliation; a one-way exporter does not satisfy the spine requirement. Never silently replace a locally edited Obsidian file.
- Never claim offline generative answers when only cached keyword search exists.
- No default location tracking, contact scraping, inbox access, public sharing, or external actions.

## Scope and structure

Build one packet at a time. Use the smallest end-to-end change that proves its acceptance criteria. Do not implement roadmap features as speculative scaffolding. Keep business logic in the Python domain package, UI outside it, and platform file access in narrow native adapters.

Use one backend package with separate API and worker entrypoints. Do not introduce Redis, a graph database, a separate vector service, Kafka, microservices, or a model router without measured evidence and a documented decision.

## Verification and handoff

Add regression tests before or alongside real behavior. Report exact commit, commands, results, skips, and untested environments. Documentation/schema checks do not establish app, security, deployment, iPhone, Windows, or live-provider acceptance.

When a contract changes, update its examples and consuming tests in the same packet. Update the current status and acceptance evidence rather than writing another contradictory PRD. Do not create alternate architecture files that compete with the canonical documents.

Do not provision paid infrastructure, enroll distribution accounts, publish apps, or enable production data processing without explicit authorization. Stop at a truthful bounded result if credentials, signing, or hardware are unavailable; do not replace live acceptance with mocks.
