# Recall

> **CURRENT PRODUCT CENTER — 2026-10-11.** The [pilot amendment](docs/PILOT-CONTRACT.md) is normative. You capture and ask. Recall keeps the memory. The store is the local vault in [RECALL-STORE](docs/RECALL-STORE.md). Obsidian is not on the product path, and Claude is not required for the default loop. The primary shell is the desktop Memory Surface in the [owner-supplied reference](docs/assets/memory-surface-reference-2026-10-10.jpg) (Nick Sandoval, 2026-10-10; Recall did not invent it). The phone is the capture/ask companion. PR #16, the installable web app, remains an optional companion and enrollment transport. No login or email-auth UX. The 2026-10-09 “web PWA is the pilot” notes, and the 2026-10-10 “Obsidian holds your memory” sentences, are previous.


**Your life remembers itself.**

Recall is the whole product. Someone photographs a handwritten note, or writes a few words, without choosing a title, folder, or tags. The original and the note stay in Recall's vault. Review happens in the Memories browser. Ask searches those notes on the device and cites the note, with or without a Claude key. Desktop is the main surface. The phone is how they capture and ask without an account. The broader universal-memory application grows from making that experience work.

```text
Capture -> Understand -> Connect -> Remember -> Recall -> Act
```

The user should not need to file, tag, name, link, or maintain a taxonomy. The approved interface is a continuously transforming **Memory Surface**: glass represents Recall's understanding, original artifacts remain visible as evidence, light signals intelligence/attention, space expresses relationships, depth expresses context, and time expresses memory evolution. See [UX](docs/UX-SPEC.md). Paul Cockerham is the first design partner and a demanding pilot because his work spans handwriting, consulting, generator maintenance, people, equipment, projects, numbers, and vague recall queries. His workflows validate the universal product; they do not define its domain model.

## North-star test

A user can give Recall something today, forget that Recall exists, return six months later with only a vague human recollection, and recover the right information with evidence.

Example: “What was the name of that guy Sarah introduced me to last summer who did something with solar?”

## Current status

**The product center is the desktop Memory Surface writing into Recall's local vault.** The Tauri app opens that surface with no login, saves a photo as an original plus a Markdown note, lists those notes in the app, and answers from keyword search with a citation when no Claude key is set. Claude reading stays opt-in on that desktop process. The phone companion writes the same vault. An installed Windows run is not done. Automated evidence for the earlier vault slice is in [ACCEPTANCE](docs/ACCEPTANCE.md) under "Desktop Obsidian Memory Surface"; the 2026-10-11 store, browser, and keyword-ask slice is recorded with that run's commands. Do not deploy PR #16 as the way to start using Recall.

PR #16 is merged and real: `apps/web` is an installable PWA with no login screen and operator device enrollment, covered by synthetic tests. iPhone Home Screen, a Windows browser, and a deployed enrollment were not accepted. That web app stays as an optional companion and enrollment transport. The October 9 decision that made it the pilot is historical.

RCL-001 (Trusted Capture) and RCL-002 (First Useful Recall) are implemented as code and verified by automated tests. No real iPhone → Windows acceptance has been run, and no live AI provider has been called from this amendment. RCL-002 adds opt-in AI reading of captures, keyword retrieval, and cited answers that abstain without evidence. The V1 build adds canonical entities and temporal claims, user corrections, hybrid retrieval, SQLite/offline sync, portable exports, managed Markdown, deletion, and backup/restore. See [V1 implementation status](docs/V1-STATUS.md) for that evidence and its limits. The code on `main` still stores canonical state in Cloud Postgres for the web companion and the legacy cloud desktop. The 2026-10-11 amendment makes Recall's local vault the memory for the desktop product and the phone companion.

What exists: Expo iPhone app, Tauri/React Windows app, FastAPI backend, Postgres schema with RLS, private-storage adapters, shared sync/API/token packages, and the web companion from PR #16. See [DEVELOPMENT](docs/DEVELOPMENT.md) to run it and [ACCEPTANCE](docs/ACCEPTANCE.md) ("RCL-001 evidence") for exactly what was and was not verified.

This repository is public. Every checked-in example must remain synthetic. Never commit private notes, customer information, personal documents, credentials, exported memories, or a private evaluation corpus.

## Product layers

| Layer | Responsibility |
| --- | --- |
| Original sources | Immutable evidence: photos first; later voice, screenshots, files, links, text, and other authorized inputs |
| Recall vault | Memory for the desktop product and the phone companion: `Recall/Sources`, `Recall/Memories`, `Recall/History`, and `Recall/_meta` in a folder the user chooses. Markdown is the format. See [RECALL-STORE](docs/RECALL-STORE.md). |
| Cloud PostgreSQL + pgvector | Store for the optional web companion and the legacy cloud desktop. Not the authority for the desktop vault path. |
| Desktop SQLite | Rebuildable cache and outbox for that legacy cloud desktop. |
| AI | Interpretation is off on the desktop vault path. Keyword search is not a Claude answer. Model output stays untrusted when a reader exists. |
| Organized notes | The desktop app writes them into the vault. The legacy cloud path can still export Markdown and will not overwrite a local-vault tree. |
| Web companion (PR #16) | Optional browser companion and enrollment transport. Not the primary shell. |

## First useful loop

```text
Photo -> durable original -> validated interpretation
      -> searchable memory -> vague question -> grounded answer + original source
```

V1 proves trusted photo capture and grounded recall. Typed text joins voice, screenshots/share sheet, files, and links in V1.5 after the first source contract is proven. Voice, screenshots/share sheet, broad document ingestion, active reminders, Claude/MCP, email/calendar, and proactive synthesis follow only after the memory loop is trustworthy.

## Read in this order

1. [Product requirements](docs/PRD.md)
2. [Architecture](docs/ARCHITECTURE.md)
3. [Data model](docs/DATA-MODEL.md), [API contract](docs/API-CONTRACT.md), and [AI ingestion](docs/AI-INGESTION.md)
4. **[Canonical experience & visual system](docs/UX-SPEC.md)**, [sync/export](docs/SYNC-AND-EXPORT.md), and [security/operations](docs/SECURITY-AND-OPERATIONS.md)
5. [Acceptance](docs/ACCEPTANCE.md), [roadmap](docs/ROADMAP.md), and [builder handoff](docs/BUILD-HANDOFF.md)

## Stack

- Mobile: Expo / React Native / TypeScript, iPhone first.
- Desktop: Tauri 2 / React / TypeScript, Windows first.
- Backend: FastAPI + durable worker.
- Canonical state: managed PostgreSQL + pgvector.
- Original evidence: private object storage.
- Desktop offline state: SQLite.
- AI: one evaluated multimodal configuration plus embeddings; no model router or autonomous agent framework in V1.

The moat is not “send a photo to an LLM.” Recall must become better through trusted identity resolution, temporal history, relationships, provenance, corrections, uncertainty, retrieval, and accumulated personal context.
