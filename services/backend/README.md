# Recall backend

## Current continuation — automatic organization

REALIGN-01 and TEXT-01 have independent local acceptance in `.agent/REALIGN-01/COMPLETION.json` and `.agent/FINISH-02/TEXT-COMPLETION.json`. INTELLIGENCE-01 has independent bounded acceptance for grounded Ask over current vault evidence in `.agent/INTELLIGENCE-01/COMPLETION.json`. ORGANIZE-01 is the active candidate: after one remembered purpose-specific opt-in, future text and photo captures are automatically queued for useful Obsidian organization. Its current status is in the active `.agent/ORGANIZE-01.md` packet; implementation in progress is not acceptance. Ask uses a separate, default-disabled `vault_intelligence` permission and versioned excerpt-processing consent. Photo permission does not authorize Ask. No live activation or provider processing is implied.

Ask considers up to eight current eligible memories, with bounded excerpts and visible coverage limits. It preserves uncertainty, opens cited memories/originals, and suppresses answers after source or vault changes. Keyword search remains available locally; it is not an offline generated answer. Historical questions, automatic AI text organization, grounded cross-memory links, voice/files, phone transport and full real-device/live acceptance remain open.

One FastAPI package at `src/recall` supplies the preserved authenticated cloud pilot and the bounded private selected-photo inference service. API and worker entrypoints reuse the same Python domain modules with separate least-privilege database roles. The default local desktop reads/writes its selected Obsidian vault through native commands; it does not use this package for local capture or keyword search.

| Module | Current role |
| --- | --- |
| `api` | Authenticated capture, memory, Ask, sync, export/deletion and bounded local-reading/inference routes. |
| `domain` | Capture, memory, consent/budget, identity, deletion and export commands. |
| `ingestion` | Durable cloud worker, Claude adapter, derivatives, validation, corrections, embeddings and selected-photo reading validation. |
| `retrieval` | Authorized keyword/hybrid search and grounded Ask with server-resolved citations. |
| `sync` | Workspace-scoped change feed, cursors, snapshots and client reconciliation contract. |
| `storage` | Private object-store port with local and Supabase adapters for the legacy cloud path. |
| `db` | Security-context pool, migrations, backup/restore and provisioning. |

Run and test through [developer instructions](../../docs/DEVELOPMENT.md). The authenticated cloud path remains workspace-scoped; the separate photo-inference path defaults to deny and does not turn a device grant into general capture, Ask, sync or vault access. These implemented modules do not establish full Obsidian migration, phone transport or production readiness.
