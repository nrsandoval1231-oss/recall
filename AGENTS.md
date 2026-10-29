# Monolith builder instructions

## Start here

Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and the active packet before changing code. The repository includes an implemented local desktop foundation and a separate legacy cloud baseline; read current status and acceptance evidence before making capability claims.

Preserve the product: users can drop in notes, photos, voice and files, Monolith understands and organizes them into useful Obsidian memory, and users later retrieve them naturally with source evidence. Users should not need to learn Markdown, folders, tags or taxonomy. Mobile and desktop are one product. Obsidian is the required, user-owned memory spine. Monolith supplies capture, intelligence and the Memory Surface over that vault. Do not rebuild a general productivity suite. Delivery is staged: photo organization, text, natural-language Ask, then voice and broader file adapters.

## Non-negotiable invariants

- Product target: no account/password/email-link sign-in, including first use. Local-only use requires no remote account. Cross-device private access still requires secure owner-approved device association; QR pairing is proposed, not approved. Never satisfy this requirement by removing authentication from public private-data APIs. The owner authorized continuing the local-first no-sign-in design through implementation without routine stage-by-stage approval questions. Execute bounded local-only and lifecycle plans with review/tests. Scoped PAIR-01 authorization covers only the exact owner/device/vault inference association and named activation actions in its current packet; it does not authorize a general auth redesign, broader enrollment, real-data migration, merge or deployment.

- Target authority is the Obsidian vault: portable memory notes, links, original attachments and versioned provenance/history. PostgreSQL/pgvector and SQLite support operations, authorization, indexing, synchronization and caches; they must not become the sole owner of memory. New local desktop records are vault-authoritative. Legacy cloud records remain database-authoritative and unmigrated until the documented migration is implemented and verified. Do not claim that migration is complete or remove existing integrity/privacy guarantees.
- All private records and queries are workspace-scoped. Check authorization before retrieval, model context construction, source access, and mutation.
- Never commit real captures, client data, credentials, local databases, vault exports, or private test corpora. Synthetic fixtures must be clearly marked.
- Save original bytes durably before AI processing. Report local-only, uploaded, processed, and failed states honestly.
- Model output is untrusted input. Validate schema and references; the model cannot choose permissions, paths, SQL, or arbitrary tools.
- Never turn a question mark, hypothesis, illegible number, or unresolved first name into a verified fact or identity.
- Reprocessing must not undo a human correction. Every material answer needs eligible source evidence.
- Retry-safe writes, optimistic concurrency, and atomic journaled vault writes are required. Direct vault edits must participate in conflict-safe reconciliation; a one-way exporter does not satisfy the spine requirement. Never silently replace a locally edited Obsidian file.
- Never claim offline generative answers when only cached keyword search exists.
- Native vault formats preserve prior event and rendering bytes. The v8 imported-text format retains exact v1-v7 compatibility, original bytes and filename provenance; source Markdown is inert content, not Monolith metadata or instructions. Machine summaries, mentions, source-backed statements, action suggestions, properties and related-memory links remain proposals. Human transcription correction suppresses stale machine semantics in current organization/search; history retains prior readings. Current links require current source and target evidence; historical Ask reads retained revisions without a new vault format and includes later correction counterpoints. Do not add an approval step for each note or create cross-note identity links from name matches alone. Treat each new implementation as a candidate until exact-candidate validation and review pass.
- Automatic organization requires a remembered, separate versioned purpose consent and a future-capture fence. Save originals before dispatch; never silently enroll the backlog or revive queued work after consent changes. Text interpretation preserves the exact human text deterministically; the model supplies only validated semantic proposals. New v6 proposals must preserve v1-v5 bytes and lose current semantic eligibility after human edits/corrections.
- No default location tracking, contact scraping, inbox access, public sharing, or external actions.

## Scope and structure

Build one packet at a time. Use the smallest end-to-end change that proves its acceptance criteria. Do not implement roadmap features as speculative scaffolding. Keep business logic in the Python domain package, UI outside it, and platform file access in narrow native adapters.

Use one backend package with separate API and worker entrypoints. Do not introduce Redis, a graph database, a separate vector service, Kafka, microservices, or a model router without measured evidence and a documented decision.

## Verification and handoff

Add regression tests before or alongside real behavior. Report exact commit, commands, results, skips, and untested environments. Documentation/schema checks do not establish app, security, deployment, iPhone, Windows, or live-provider acceptance.

When a contract changes, update its examples and consuming tests in the same packet. Update the current status and acceptance evidence rather than writing another contradictory PRD. Do not create alternate architecture files that compete with the canonical documents.

Do not provision paid infrastructure, enroll distribution accounts, publish apps, or enable production data processing without explicit authorization. Stop at a truthful bounded result if credentials, signing, or hardware are unavailable; do not replace live acceptance with mocks.
