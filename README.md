# Recall

**Your life remembers itself.**

Recall is a universal external-memory application. People already capture important information in notebooks, screenshots, photos, voice notes, files, links, meetings, and messages. Recall removes the organizational burden after capture: it preserves the source, understands what it means, connects it across time, and lets the user recover it later using the imperfect way humans actually remember.

```text
Capture -> Understand -> Connect -> Remember -> Recall -> Act
```

The user should not need to file, tag, name, link, or maintain a taxonomy. Paul Cockerham is the first design partner and a demanding pilot because his work spans handwriting, consulting, generator maintenance, people, equipment, projects, numbers, and vague recall queries. His workflows validate the universal product; they do not define its domain model.

## North-star test

A user can give Recall something today, forget that Recall exists, return six months later with only a vague human recollection, and recover the right information with evidence.

Example: “What was the name of that guy Sarah introduced me to last summer who did something with solar?”

## Current status

**Product definition and repository scaffold only. No application is implemented or deployed.**

This repository is public. Every checked-in example must remain synthetic. Never commit private notes, customer information, personal documents, credentials, exported memories, or a private evaluation corpus.

## Product layers

| Layer | Responsibility |
| --- | --- |
| Original sources | Immutable evidence: photos first; later voice, screenshots, files, links, text, and other authorized inputs |
| Cloud PostgreSQL + pgvector | Canonical memory state, temporal history, relationships, corrections, permissions, and retrieval indexes |
| Desktop SQLite | Rebuildable offline cache and durable pending operations |
| AI | Interpretation, extraction, retrieval synthesis, and proposals; never canonical truth |
| Exports/integrations | Portable Markdown/JSON/originals; Obsidian is one optional adapter, not a core dependency |

## First useful loop

```text
Photo -> durable original -> validated interpretation
      -> searchable memory -> vague question -> grounded answer + original source
```

V1 proves trusted photo/text capture and grounded recall. Voice, screenshots/share sheet, broad document ingestion, active reminders, Claude/MCP, email/calendar, and proactive synthesis follow only after the memory loop is trustworthy.

## Read in this order

1. [Product requirements](docs/PRD.md)
2. [Architecture](docs/ARCHITECTURE.md)
3. [Data model](docs/DATA-MODEL.md), [API contract](docs/API-CONTRACT.md), and [AI ingestion](docs/AI-INGESTION.md)
4. [UX](docs/UX-SPEC.md), [sync/export](docs/SYNC-AND-EXPORT.md), and [security/operations](docs/SECURITY-AND-OPERATIONS.md)
5. [Acceptance](docs/ACCEPTANCE.md), [roadmap](docs/ROADMAP.md), and [builder handoff](docs/BUILD-HANDOFF.md)

## Proposed stack

- Mobile: Expo / React Native / TypeScript, iPhone first.
- Desktop: Tauri 2 / React / TypeScript, Windows first.
- Backend: FastAPI + durable worker.
- Canonical state: managed PostgreSQL + pgvector.
- Original evidence: private object storage.
- Desktop offline state: SQLite.
- AI: one evaluated multimodal configuration plus embeddings; no model router or autonomous agent framework in V1.

The moat is not “send a photo to an LLM.” Recall must become better through trusted identity resolution, temporal history, relationships, provenance, corrections, uncertainty, retrieval, and accumulated personal context.
