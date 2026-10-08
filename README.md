# Recall

**Required product target:** no account, password, or email-link sign-in, including first use. Private local use needs no remote account. Secure owner-approved device association is still required for private cross-device use; one-time QR pairing is proposed and awaits the owner’s answer. The desktop now defaults to a local-only vault foundation with no sign-in or cloud configuration. The browser/mobile and opt-in legacy desktop flows retain Supabase authentication. See the [RCL-005B design proposal](docs/superpowers/specs/2026-10-07-rcl-005b-no-signin-vault-design.md).

**Your life remembers itself.**

Recall is a universal external-memory application. People already capture important information in notebooks, screenshots, photos, voice notes, files, links, meetings, and messages. Recall removes the organizational burden after capture: it preserves the source, understands what it means, connects it across time, and lets the user recover it later using the imperfect way humans actually remember.

```text
Capture -> Understand -> Connect -> Remember -> Recall -> Act
```

The user should not need to file, tag, name, link, or maintain a taxonomy. The approved interface is a continuously transforming **Memory Surface**: glass represents Recall's understanding, original artifacts remain visible as evidence, light signals intelligence/attention, space expresses relationships, depth expresses context, and time expresses memory evolution. See [UX](docs/UX-SPEC.md). Paul Cockerham is the first design partner and a demanding pilot because his work spans handwriting, consulting, generator maintenance, people, equipment, projects, numbers, and vague recall queries. His workflows validate the universal product; they do not define its domain model.

## North-star test

A user can give Recall something today, forget that Recall exists, return six months later with only a vague human recollection, and recover the right information with evidence.

Example: “What was the name of that guy Sarah introduced me to last summer who did something with solar?”

## Current status

The local desktop loop is choose vault → import PNG/JPEG/WebP → search human notes/filenames → inspect original → correct/review history. See [run instructions](docs/DEVELOPMENT.md#local-only-desktop-foundation) and [synthetic verification and limits](docs/implementation/local-vault/README.md). It does not read handwriting or generate answers. Installed Windows acceptance remains open.

**RCL-001 (Trusted Capture) and RCL-002 (First Useful Recall) have automated implementation evidence. The status ledger records deployed pilot infrastructure and a browser adapter; real signed-in cross-device acceptance and live handwriting quality remain open.** RCL-002 adds opt-in AI reading of captures, keyword retrieval, and cited answers that abstain without evidence. The V1 build adds canonical entities and temporal claims, user corrections, hybrid retrieval, SQLite/offline sync, portable exports, managed Markdown, deletion, and backup/restore. See [V1 implementation status](docs/V1-STATUS.md) for current evidence and limitations.

What exists: Expo iPhone app, Tauri/React Windows app, FastAPI backend, Postgres schema with RLS, private-storage adapters, shared sync/API/token packages. See [DEVELOPMENT](docs/DEVELOPMENT.md) to run it and [ACCEPTANCE](docs/ACCEPTANCE.md) ("RCL-001 evidence") for exactly what was and was not verified.

This repository is public. Every checked-in example must remain synthetic. Never commit private notes, customer information, personal documents, credentials, exported memories, or a private evaluation corpus.

## Required Obsidian spine

Obsidian is the required memory spine, not an optional export destination. The user-owned vault holds durable memory notes, relationships, original attachments and the provenance/history needed to preserve meaning over time. Recall adds low-friction capture, LLM-assisted understanding, grounded retrieval and the Memory Surface over that foundation. Users do not need to organize folders or maintain a taxonomy.

**Local foundation:** new desktop captures commit originals, human notes and retained revisions to a selected vault, reconcile supported direct Markdown body edits and rebuild local keyword retrieval from validated files. This is a usable local desktop foundation candidate, not full RCL-005B: existing cloud memory remains PostgreSQL-authoritative. The [lifecycle slice](docs/implementation/local-vault-lifecycle/README.md) adds same-folder renames, explicit missing-note restore, retained logical removal and annotation-search rebuild. Nested moves, secure purge/undelete, semantic reconstruction, migration, phone synchronization and local AI remain open. See [architecture](docs/ARCHITECTURE.md) and [roadmap](docs/ROADMAP.md).

## Product layers

| Layer | Responsibility |
| --- | --- |
| Original sources | Immutable evidence: photos first; later voice, screenshots, files, links, text, and other authorized inputs |
| Obsidian vault | Required user-owned memory spine: notes, links, original attachments and versioned provenance/history |
| PostgreSQL + pgvector | Supporting operational state, authorization, synchronization and rebuildable memory/search projections; currently authoritative in the pre-migration implementation |
| Legacy cloud desktop SQLite | Rebuildable offline cache and durable pending operations; default local desktop reads validated vault files |
| AI | Interpretation, extraction, retrieval synthesis, and proposals; never canonical truth |
| Portability/integrations | Vault-compatible Markdown, structured history and originals; other tools are adapters to the Obsidian-backed memory |

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
- Required memory spine: user-owned Obsidian vault.
- Supporting service database/search: PostgreSQL + pgvector; vault-authority migration remains open.
- Original evidence: immutable vault attachments with authorized private-storage replicas; current code uses private object storage.
- Desktop offline state: SQLite.
- AI: one evaluated multimodal configuration plus embeddings; no model router or autonomous agent framework in V1.

The moat is not “send a photo to an LLM.” Recall must become better through trusted identity resolution, temporal history, relationships, provenance, corrections, uncertainty, retrieval, and accumulated personal context.
