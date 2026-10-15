# Recall — Architecture

Describes the code as it exists today. Product intent lives in [VISION.md](VISION.md). If this file drifts from the code, fix this file in the same PR.

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

There is no server, no login and no cloud dependency on the product path. Model calls (Jev, Claude) go out from the Rust process only, with the user's consent and within budget caps. API keys never reach the webview.

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
- Default location: `Documents/Recall`, or `RECALL_VAULT_DIR`. ("Vault" in code identifiers means "library"; it's a naming leftover.)

## Capture → memory pipeline

1. **Capture** (`local_vault`, `attachments`): assign an idempotent ID and write the original plus a receipt under the writer lock. The capture shows as *Saved* even if no model is available.
2. **Consent + budget** (`processing`, `secrets`, `companion_processing`): processing runs only for an explicitly consented source, with configured model, prices and daily/monthly caps.
3. **Jev parse** (`jev`, `processing`): bounded, versioned structured candidates: claims, people, dates, questions, follow-ups, uncertainty, source spans. Photos go through the Claude visual adapter for transcription.
4. **Claude librarian** (`librarian`, `meeting`): proposes title, properties, links and updates from Jev output plus minimal library context. It is a closed schema; the model never supplies paths or claims outside the evidence.
5. **Validate + write** (`organization_plan`, `local_vault`): deterministic schema/citation/path/revision/idempotency checks, then an atomic revision-aware publish. A stale revision or an external edit stops the write for review.
6. **Retrieve** (`memory_query`, optional `knowledge`): lexical plus explicit-link retrieval over the library, plus source filenames. Every hit is rebound to verified source bytes and offsets. Answers are quoted evidence, labelled as keyword retrieval unless a model synthesized them.

Uncertain provider delivery is never auto-resent; it waits for explicit review. Human corrections block replay of stale organization.

## Desktop UI (`apps/desktop/src`)

- `surface/MemorySurface.tsx`: the adaptive shell (capture bubbles, inspector, Ask, graph, history, settings).
- `surface/AdaptiveGraph.tsx`, `adaptive-graph.ts`, `vault-context.ts`: graph derived from library notes and links.
- `surface/MemoryEditor.tsx`, `editor-session.ts`: native editor with autosave, conflict and revision handling.
- `surface/meeting-workflow.ts`, `native-librarian.ts`: drives the pipeline over IPC and reports honest states.
- `platform/local-vault.ts`: the only bridge to native commands.
- `?design=canonical` and the Brooks fixture are labelled synthetic previews for browser-only development, never shown as user data.

## Phone (`src-tauri/src/phone.rs`, `bin/recall-phone.rs`)

A small HTTP server in the same crate. It binds the Tailscale IPv4 only (loopback fallback; all-interfaces needs two explicit env flags). It shares the library writer lock with the desktop. Cross-site requests are refused. It never calls a model or reads API keys; captured items queue for desktop processing. Setup: [DEVELOPMENT.md](DEVELOPMENT.md#phone-companion).

## Backup and portability

- `library_backup`: portable, hash-verified full-library backup. Restore never merges into an existing library.
- `managed_export`: Markdown export to a chosen folder with a manifest and journal, preserving local edits there.

## Shared packages

`packages/design-tokens` is used by the desktop UI. `packages/api-client`, `packages/sync`, `packages/contracts` serve the legacy cloud stack only.

## Legacy (not the product)

`services/backend` (FastAPI, Postgres/pgvector, worker), `apps/web` (PWA), `apps/mobile` (Expo), and the desktop's `?mode=legacy-cloud` entry. They are frozen; see [legacy-cloud/](legacy-cloud/README.md).

## Constraints

- Business logic in the Rust core (and the legacy Python domain package); UI stays in React; platform access goes through narrow native adapters.
- No Redis, Kafka, microservices, graph DB, separate vector service, or model router without measured evidence and a written decision in this file.
