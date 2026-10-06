# Recall

**Your work remembers itself.**

Recall is a photo-first memory application for people whose work still starts on paper. Write normally, photograph the page, and later ask a plain-language question. The answer must lead back to the original evidence.

The first pilot spans consulting, generator maintenance, equipment, projects, people, and business ideas. The core is intentionally industry-neutral.

## Current status

**Product definition and repository scaffold only. No application is implemented or deployed.**

The product direction and storage architecture were agreed before this foundation was written. The detailed contracts and acceptance criteria below are the proposed V1 implementation baseline, not evidence of working software. Directory READMEs and `.gitkeep` files reserve boundaries; they are not working modules. No cloud resources, AI subscriptions, signing certificates, or paid services have been created.

This repository is public. Every example is synthetic. Never commit real notebook pages, customer information, credentials, exported vaults, database dumps, or a private evaluation corpus.

## Read in this order

1. [Product requirements](docs/PRD.md) — user, value proposition, V1 scope, and requirements.
2. [Architecture](docs/ARCHITECTURE.md) — components, storage ownership, and stack decisions.
3. [Data model](docs/DATA-MODEL.md), [API contract](docs/API-CONTRACT.md), and [AI ingestion](docs/AI-INGESTION.md).
4. [Sync and Obsidian export](docs/SYNC-AND-EXPORT.md), [UX](docs/UX-SPEC.md), and [security/operations](docs/SECURITY-AND-OPERATIONS.md).
5. [Acceptance](docs/ACCEPTANCE.md), [roadmap](docs/ROADMAP.md), and [first-builder handoff](docs/BUILD-HANDOFF.md).
6. [Folder tree](docs/FOLDER-TREE.md) and [primary technical references](docs/REFERENCES.md).

## The first useful loop

```text
Paper -> photo -> durable original -> validated interpretation
      -> searchable memory -> question -> answer + original page
```

Capturing must not require filing, tagging, Markdown, or identity cleanup. Ambiguity must not prevent saving the original. An uploaded image is not automatically a searchable transcription, and a transcription is not a verified fact.

## Agreed ownership

| Layer | Responsibility |
| --- | --- |
| Private object storage | Original photos and later other source files; append-only during normal operation, explicitly deletable by the owner |
| Cloud PostgreSQL + pgvector | Canonical application records, versions, relationships, permissions, and retrieval indexes |
| Desktop SQLite | Rebuildable local cache and durable pending operations; not a competing canonical database |
| Obsidian/Markdown | Optional portable archive; not the app database or a requirement on mobile |
| AI | Interprets and proposes; deterministic code validates, authorizes, and commits |

Mobile and desktop use the same API. Neither receives database-owner credentials or AI provider secrets. Cloud processing remains available while the desktop is off.

## Proposed implementation stack

- iPhone first: Expo / React Native / TypeScript.
- Windows first: Tauri 2 / React / TypeScript; SQLite and scoped local export.
- Shared: design tokens, versioned contracts, generated API types, and synchronization protocol logic. Native and DOM view components are not assumed interchangeable.
- Backend: FastAPI with one Python domain package, an API process, and a durable worker process.
- Infrastructure default: managed Supabase Postgres, Auth, and private Storage; provider setup and spend still require owner authorization.
- AI: one evaluated multimodal model and one embedding model, configurable and pinned during implementation. No model router or autonomous agent framework.

Exact dependency versions will be selected and locked when real packages are initialized. There are deliberately no fake runnable manifests in this scaffold.

## First implementation packet

**RCL-001 — trusted capture.** Prove an authenticated phone upload survives retries and restarts, reaches private cloud storage with a verified hash, and appears with the same original in the minimal desktop app. Do not build AI, dashboards, voice, or MCP in this packet.

**RCL-002 — first useful memory.** Add structured transcription and a source-backed answer to complete the product's first useful loop. The pilot is not accepted until the remaining offline, export, correction, security, and restore gates pass.

See [BUILD-HANDOFF](docs/BUILD-HANDOFF.md) for the exact first-packet scope.
