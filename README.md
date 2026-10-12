# Recall

## Next build — Meeting to Memory

The approved next vertical slice is [Meeting to Memory](docs/MEETING-TO-MEMORY.md): messy source capture → Jev parsing → Claude librarian proposals → validated Markdown/YAML Obsidian write → evidence-backed Recall retrieval. This is a product requirement, **not** a completed live workflow. The sole active desktop UI direction is in [UX-SPEC](docs/UX-SPEC.md). PR #26 remains isolated.


## Canonical pilot implementation (2026-10-11)

The active product is the Tauri desktop Memory Surface with a user-selected Obsidian vault as durable memory, and a local Tailscale phone Capture/Ask companion. Claude interpretation is opt-in and has not passed live end-to-end acceptance. The Expo/FastAPI/PostgreSQL/Cloudflare PWA stack described below is retained as legacy or optional infrastructure, **not** a prerequisite or source of truth for this pilot. Read [Canonical Foundation](docs/CANONICAL-FOUNDATION.md) and [Pilot Contract](docs/PILOT-CONTRACT.md) before implementing features.


> **CURRENT PRODUCT CENTER — 2026-10-10.** The [pilot amendment](docs/PILOT-CONTRACT.md) is normative. You capture and ask. Recall organizes. **Obsidian holds your memory.** The primary shell is the desktop Memory Surface in the [owner-supplied reference](docs/assets/memory-surface-reference-2026-10-10.jpg) (Nick Sandoval, 2026-10-10; Recall did not invent it). The phone is the capture/ask companion. PR #16, the installable web app, remains an optional companion and enrollment transport. No login or email-auth UX. The 2026-10-09 “web PWA is the pilot” notes are historical.


**Your life remembers itself.**

Recall lets someone use Obsidian fully without learning how to organize or maintain it. They photograph handwritten notes and ask vague questions. Claude reads, organizes, and connects people, projects, and ideas. The notes land in Obsidian, and the original pages stay preserved. Desktop is the main surface. The phone is how they capture and ask without Obsidian mobile and without an account. The broader universal-memory application grows from making that experience work.

```text
Capture -> Understand -> Connect -> Remember -> Recall -> Act
```

The user should not need to file, tag, name, link, or maintain a taxonomy. The approved interface is a continuously transforming **Memory Surface**: glass represents Recall's understanding, original artifacts remain visible as evidence, light signals intelligence/attention, space expresses relationships, depth expresses context, and time expresses memory evolution. See [UX](docs/UX-SPEC.md). Paul Cockerham is the first design partner and a demanding pilot because his work spans handwriting, consulting, generator maintenance, people, equipment, projects, numbers, and vague recall queries. His workflows validate the universal product; they do not define its domain model.

## North-star test

A user can give Recall something today, forget that Recall exists, return six months later with only a vague human recollection, and recover the right information with evidence.

Example: “What was the name of that guy Sarah introduced me to last summer who did something with solar?”

## Current status

**The product center is the desktop Memory Surface writing into an Obsidian vault.** The Tauri app opens that surface with no login, saves a photo as an original plus a Markdown note, and answers from keyword search over the vault. Claude reading is opt-in on that desktop process and off unless a key, model, prices, and budgets are set; no live reading was accepted. The phone companion is implemented with synthetic and loopback evidence, but a real iPhone over Tailscale and an installed Windows run remain unaccepted. Automated evidence is in [ACCEPTANCE](docs/ACCEPTANCE.md) under "Desktop Obsidian Memory Surface". PRs #11–#14 are closed; their historical vault-slice work is retained in the implementation and evidence history. Do not deploy PR #16 as the way to start using Recall.

PR #16 is merged and real: `apps/web` is an installable PWA with no login screen and operator device enrollment, covered by synthetic tests. iPhone Home Screen, a Windows browser, and a deployed enrollment were not accepted. That web app stays as an optional companion and enrollment transport. The October 9 decision that made it the pilot is historical.

RCL-001 (Trusted Capture) and RCL-002 (First Useful Recall) are implemented as code and verified by automated tests. No real iPhone → Windows acceptance has been run, and no live AI provider has been called from this amendment. RCL-002 adds opt-in AI reading of captures, keyword retrieval, and cited answers that abstain without evidence. The V1 build adds canonical entities and temporal claims, user corrections, hybrid retrieval, SQLite/offline sync, portable exports, managed Markdown, deletion, and backup/restore. See [V1 implementation status](docs/V1-STATUS.md) for that evidence and its limits. The legacy cloud subsystem retains PostgreSQL canonical state and Markdown export. The active desktop-vault path already writes to the user-selected Obsidian vault, which is its authority; live device and librarian acceptance remain open.

What exists: Expo iPhone app, Tauri/React Windows app, FastAPI backend, Postgres schema with RLS, private-storage adapters, shared sync/API/token packages, and the web companion from PR #16. See [DEVELOPMENT](docs/DEVELOPMENT.md) to run it and [ACCEPTANCE](docs/ACCEPTANCE.md) ("RCL-001 evidence") for exactly what was and was not verified.

This repository is public. Every checked-in example must remain synthetic. Never commit private notes, customer information, personal documents, credentials, exported memories, or a private evaluation corpus.

## Product layers

| Layer | Responsibility |
| --- | --- |
| Original sources | Immutable evidence: photos first; later voice, screenshots, files, links, text, and other authorized inputs |
| Obsidian vault | Memory for the desktop product: original photos, Markdown notes, and append-only history in a folder the user chooses. |
| Cloud PostgreSQL + pgvector | Store for the optional web companion and the legacy cloud desktop. Not the authority for the desktop vault path. |
| Desktop SQLite | Rebuildable cache and outbox for that legacy cloud desktop. |
| AI | The current desktop reader is default-off and consent-gated. The required Jev parsing and Claude librarian organization pipeline is not yet accepted end to end. Keyword search is not a Claude answer; model output remains untrusted. |
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
- Active desktop state: owner-selected Obsidian vault; SQLite may hold rebuildable indexes and local operational state. Legacy cloud state: managed PostgreSQL + pgvector.
- Original evidence: private object storage.
- Desktop offline state: SQLite.
- AI: one evaluated multimodal configuration plus embeddings; no model router or autonomous agent framework in V1.

The moat is not “send a photo to an LLM.” Recall must become better through trusted identity resolution, temporal history, relationships, provenance, corrections, uncertainty, retrieval, and accumulated personal context.
