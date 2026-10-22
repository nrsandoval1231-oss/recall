# MONOLITH — Architecture

Describes the code as it exists today. Product intent lives in [VISION.md](VISION.md). If this file drifts from the code, fix this file in the same PR.

## MONOLITH cloud evolution — owner decision 2026-10-17

The owner authorized an always-on Hostinger platform, authenticated web/PWA access, and offline Windows synchronization. This supersedes the local-only/no-login restriction below; the existing implementation description is retained for migration context. The approved React Memory Surface and native library remain the compatibility boundary. Reuse the existing FastAPI/PostgreSQL service, private write-once object storage, revocable device enrollment, provider adapters, budget enforcement and backup machinery. Do not introduce a second mobile backend or replace the desktop library.

Native Markdown memories need an additive cloud representation because the older cloud capture schema only accepts image pages and AI-projected memories. Preserve native UUIDs, original hashes, Markdown, revisions and deletion tombstones in workspace-scoped records; never coerce native notes into fabricated image captures. Use revision-conditional writes and operation receipts, with immutable originals and append-only history. PostgreSQL is canonical for synchronized cloud records; the desktop library remains usable independently. Initial migration is opt-in, additive and backed up, with no local deletion or overwrite.

Browser sessions use the existing one-time operator enrollment exchanged for HttpOnly cookies, with strict same-origin mutation checks. No open signup or browser-held operator/provider secret. Desktop credentials stay in the OS credential store. All platform access stays behind adapters. Deploy only into a dedicated Compose project/network/volumes and the existing reverse proxy after inspecting Hostinger; do not alter Orloom or GridLens. No Hostinger access is currently present in this workspace.

## Cloud checkpoint implementation

`apps/desktop/src/main.tsx` selects native entry only inside Tauri and `CloudEntry` in an ordinary browser. Both use the approved MemorySurface. `platform/cloud-vault.ts` translates its existing interface to authenticated `/v1/library` calls. IndexedDB or native SQLite stores the record and pending mutation together. Remote revisions cannot replace records with pending edits. Tombstones retain originals/history. A refused (409) edit is parked, never dropped; the user resolves it in Cloud settings by keeping their edit, taking the cloud version or saving combined text, and kept edits are rebased as new revisions above the cloud revision. The current implementation uses full bounded snapshots and prefetches primary originals, not yet incremental large-library replication.

`services/backend/src/recall/library` adds native Markdown records beside the retained image-capture model, using the existing database transactions/RLS/workspace serialization, object store, enrollment, consent, provider budgets and answer citation validator. It does not currently feed these native records through the legacy extraction/embedding worker. Relationships explicitly present in Markdown remain available to the shared graph; automatic cloud relationship extraction is unfinished.

The native cloud adapter performs bounded HTTPS requests on blocking-worker tasks, refuses redirects and holds credentials in the existing OS credential store. Its SQLite journal is additive to `recall.sqlite3`. Original library mode is preserved; imports require a full backup and refuse memories whose secondary attachments cannot yet migrate. This is an incremental cloud client, not a claim that the old Markdown folder is already continuously synchronized.

Deploy configuration: `infra/megraph/compose.yml`, restricted API/worker, PostgreSQL/pgvector, private original volume, and a same-origin web reverse proxy on host loopback. Production TLS remains the existing Hostinger proxy's responsibility. See `infra/megraph/README.md` and the open implementation/acceptance gates in STATUS.

## Shape

```text
 iPhone (Safari, over Tailscale)          Windows desktop (Tauri 2)
 ┌──────────────────────┐                ┌───────────────────────────────────────────┐
 │ Capture / Ask page   │ ── HTTP ──▶    │ recall-phone  (Rust bin, same crate)      │
 └──────────────────────┘                │                                           │
                                         │ React webview: Memory Surface             │
                                         │   └─ IPC (narrow tauri::command set) ──┐  │
                                         │ Rust core                              ▼  │
                                         │   local_vault ─ attachments ─ persistence │
                                         │   processing ─ jev ─ librarian ─ meeting  │
                                         │   organization_plan (validator/writer)    │
                                         │   memory_query ─ knowledge (Graphiti opt.) │
                                         │   library_backup ─ managed_export ─ secrets│
                                         └───────────────┬───────────────────────────┘
                                                         ▼
                                          Recall library (a folder the user owns)
```

Independent local-library mode needs no cloud account. The authenticated cloud mode above reuses the backend; the diagram describes local companion mode. Model calls (Jev, Claude) go out from the Rust process only, with the user's consent and within budget caps. API keys never reach the webview.

## The Recall library (on disk)

```text
<library>/Recall/
  Sources/     original bytes (photos, text originals), written once, never modified by AI
  Memories/    one Markdown note per memory: YAML frontmatter + body + [[links]]
  History/     append-only revisions
  _meta/       manifest, writer.lock, journals, commit receipts, attachment receipts,
               parser/organization operations and reviews, budget ledger, preserved external edits
```

- The **library is the authority.** Search indexes, the graph, and the optional Graphiti index are derived and rebuildable from it.
- Notes are plain Markdown readable in any editor. Recall detects edits made outside it, records them as `human:obsidian` revisions (a legacy origin string kept for compatibility with existing libraries; it means "edited outside Recall"), and never silently overwrites them.
- Default location: `Documents/Recall`, or `RECALL_VAULT_DIR`. ("Vault" and "library" mean the same thing.)

## Capture → memory pipeline

1. **Capture** (`local_vault`, `attachments`): assign an idempotent ID and write the original plus a receipt under the writer lock. The capture shows as *Saved* even if no model is available.
2. **Consent + budget** (`processing`, `secrets`, `companion_processing`): processing runs only for an explicitly consented source, with configured model, prices and daily/monthly caps.
3. **Jev parse** (`jev`, `processing`): bounded, versioned structured candidates: claims, people, dates, questions, follow-ups, uncertainty, source spans. Photos go through the Claude visual adapter for transcription.
4. **Claude librarian** (`librarian`, `meeting`): proposes title, properties, links and updates from Jev output plus minimal library context. It is a closed schema; the model never supplies paths or claims outside the evidence.
5. **Validate + write** (`organization_plan`, `local_vault`): deterministic schema/citation/path/revision/idempotency checks, then an atomic revision-aware publish. A stale revision or an external edit stops the write for review.
6. **Retrieve** (`memory_query`, optional `knowledge`): lexical plus explicit-link retrieval over the library, plus source filenames. Every hit is rebound to verified source bytes and offsets. Answers are quoted evidence, labelled as keyword retrieval unless a model synthesized them.

Uncertain provider delivery is never auto-resent; it waits for explicit review. Human corrections block replay of stale organization.

The shared capture UI can authorize automatic processing of future captures on one device/library (off by default). Each capture persists its own source permission; changing this preference never backfills older captures. Native capture and reopen use `companion_processing` durable source/revision intents and deterministic stage IDs. Native memory responses project durable processing state; an explicit retry after a known HTTP rejection requires source-bound retry receipts, with three attempts maximum. Unknown delivery remains fenced, and old renderer intents retain their existing recovery path. Render version 3 adds general note/photo metadata; versions 1 and 2 retain historical publication bytes.

Cloud native records use additive `library_processing` rows with forced RLS. The existing Python worker consumes them alongside the existing ingestion jobs; no new service is required. Source-specific authorization, workspace AI consent, configuration and the shared reservation ledger gate dispatch. A lease ownership token and source/revision check precede a durable dispatch marker. The SDK does not silently retry. Expired undispatched leases can recover; dispatched jobs without a durable result become uncertain, while saved validated results recover without another charge. Publication rechecks permission, source revision and every suggested target revision under the workspace writer lock. Human changes stop publication. Up to four relevant excerpts from a bounded candidate set accompany a source; photo descriptions and suggested connections remain explicitly unverified proposals. Automatic cloud text processing is bounded to 64,000 UTF-8 bytes, preserving larger originals for manual review.

## Desktop UI (`apps/desktop/src`)

- `surface/MemorySurface.tsx`: the approved rail, global search, memory field, contextual inspector and capture bar, with Ask, history and Settings.
- `surface/AdaptiveGraph.tsx`, `adaptive-graph.ts`, `vault-context.ts`: graph derived from library notes and links.
- `surface/MemoryEditor.tsx`, `editor-session.ts`: native editor with autosave, conflict and revision handling.
- `surface/meeting-workflow.ts`, `native-librarian.ts`: drives the pipeline over IPC and reports honest states.
- `platform/local-vault.ts`: the only bridge to native commands.
- `scripts/verify-ui.mjs` and `scripts/verify-populated.mjs` inject labelled synthetic browser IPC for regression screenshots; production opens the real local library or authenticated cloud adapter. The old selectable legacy-cloud entry and unused dashboard fixture components are removed.

## Phone (`src-tauri/src/phone.rs`, `bin/recall-phone.rs`)

A small HTTP server in the same crate. It binds the Tailscale IPv4 only (loopback fallback; all-interfaces needs two explicit env flags). It shares the library writer lock with the desktop. Cross-site requests are refused. It never calls a model or reads API keys; captured items queue for desktop processing. Its focused Home, Capture, Ask and device-receipt views use the shared brand CSS and fonts; `phone/ui.js` handles presentation only, while `phone/companion.js` retains durable outbox and delivery behavior. Source inspection and processing receipts remain native routes. Setup: [DEVELOPMENT.md](DEVELOPMENT.md#phone-companion).

## Backup and portability

- `library_backup`: portable, hash-verified full-library backup. Restore never merges into an existing library.
- `managed_export`: Markdown export to a chosen folder with a manifest and journal, preserving local edits there.

## Shared packages

`packages/design-tokens` supplies the approved palette and semantic tokens. Its `brand.css` is shared by desktop and the native phone renderer. `packages/api-client`, `packages/sync`, `packages/contracts` retain compatibility contracts; inspect live consumers before changing them.

## Historical clients and reused backend

`services/backend` (FastAPI, Postgres/pgvector, worker) is active in the authenticated cloud checkpoint described above. `apps/web` (historical PWA), `apps/mobile` (Expo) and the old desktop LegacyCloudEntry remain historical clients; the active browser entry is CloudEntry. Old docs in [legacy-cloud/](legacy-cloud/README.md) are migration context, not a freeze on the reused backend.

## Constraints

- Business logic in the Rust core (and the legacy Python domain package); UI stays in React; platform access goes through narrow native adapters.
- No Redis, Kafka, microservices, graph DB, separate vector service, or model router without measured evidence and a written decision in this file.
