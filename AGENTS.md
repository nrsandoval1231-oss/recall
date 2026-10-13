# Recall builder instructions

## Graphiti mission amendment (2026-10-12)

The owner's Graphiti integration mission supersedes earlier Obsidian-required and no-graph restrictions below. Recall owns its portable Markdown notes, original attachments and correction history; Obsidian is optional. Graphiti is an optional, derived, rebuildable relationship index. Saving, reading, editing and local keyword retrieval must work without it or any model provider. Preserve the canonical desktop UI and existing Jev/Claude processing; do not import PR #26 wholesale. Graph processing requires its own explicit purpose consent and configured providers. Implementation and acceptance are tracked in `.agent/GRAPHITI-01/`; no production readiness, provider compatibility or device claim follows from this amendment.

## Active next packet — Meeting to Memory

Read `docs/MEETING-TO-MEMORY.md` before any new intelligence or desktop UI work. It defines the smallest Jev → Claude → deterministic Obsidian writer implementation, acceptance gates, and scope boundaries. Keep PR #26 isolated; do not import its divergent vault-only/no-Claude vision. The single active UI direction is the latest warm-glass business board in `docs/UX-SPEC.md`; do not revive older visual alternatives.


## Start here

Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and the active packet before changing code. The repository contains implemented desktop, phone, and legacy cloud components. Verify current code and acceptance evidence before claiming a feature works.

Preserve the product: a pen-and-paper user photographs notes and retrieves source-backed memories. The primary shell is the desktop Memory Surface. The phone is a capture and ask companion. Organized notes live in Obsidian, and originals stay preserved. The installable web app (PR #16) is an optional companion and enrollment transport, not the product people start using. Do not rebuild a general productivity suite. The 2026-10-10 amendment in `docs/PILOT-CONTRACT.md` is the product-center authority.

## Required intelligence pipeline (owner decision 2026-10-11)

Jev parses incoming sources into evidence-linked structured candidates. Claude is the core librarian that proposes Obsidian note organization, YAML frontmatter, wikilinks, relationships and safe updates. A deterministic vault writer validates and commits these proposals; neither model has unrestricted filesystem access. Markdown with YAML properties is the primary Obsidian representation; JSON is for internal structured state. Capture remains durable when models are unavailable, but keyword search is not a substitute for the intended Jev + Claude loop. See `docs/CANONICAL-FOUNDATION.md`. Keep PR #26 separate.

## Non-negotiable invariants

- The desktop product keeps memory in the user's Obsidian vault. Original photos live under `Recall/Sources`. Markdown notes live under `Recall/Memories`. History is append-only, and a locally edited note is not silently replaced. Cloud Postgres, private object storage, and SQLite remain the store for the optional web companion and the legacy cloud desktop (`?mode=legacy-cloud`). They are not the memory authority for the desktop vault path. Do not deploy the web PWA as the way to start using Recall.
- All private records and queries are workspace-scoped. Check authorization before retrieval, model context construction, source access, and mutation.
- Never commit real captures, client data, credentials, local databases, vault exports, or private test corpora. Synthetic fixtures must be clearly marked.
- Save original bytes durably before AI processing. Report local-only, uploaded, processed, and failed states honestly.
- Model output is untrusted input. Validate schema and references; the model cannot choose permissions, paths, SQL, or arbitrary tools.
- Never turn a question mark, hypothesis, illegible number, or unresolved first name into a verified fact or identity.
- Reprocessing must not undo a human correction. Every material answer needs eligible source evidence.
- Retry-safe writes, optimistic concurrency, and atomic local export are required. Never silently replace a locally edited Obsidian file.
- Never claim offline generative answers when only cached keyword search exists.
- No default location tracking, contact scraping, inbox access, public sharing, or external actions.

## Scope and structure

Build one packet at a time. Use the smallest end-to-end change that proves its acceptance criteria. Do not implement roadmap features as speculative scaffolding. Keep business logic in the Python domain package, UI outside it, and platform file access in narrow native adapters.

Use one backend package with separate API and worker entrypoints. Do not introduce Redis, a graph database, a separate vector service, Kafka, microservices, or a model router without measured evidence and a documented decision.

## Verification and handoff

Add regression tests before or alongside real behavior. Report exact commit, commands, results, skips, and untested environments. Documentation/schema checks do not establish app, security, deployment, iPhone, Windows, or live-provider acceptance.

When a contract changes, update its examples and consuming tests in the same packet. Update the current status and acceptance evidence rather than writing another contradictory PRD. Do not create alternate architecture files that compete with the canonical documents.

Do not provision paid infrastructure, enroll distribution accounts, publish apps, or enable production data processing without explicit authorization. Stop at a truthful bounded result if credentials, signing, or hardware are unavailable; do not replace live acceptance with mocks.
