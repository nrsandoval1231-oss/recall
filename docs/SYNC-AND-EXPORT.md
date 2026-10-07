# Obsidian spine, synchronization and portability

## Required target — vault-backed memory

Obsidian is the required user-owned memory spine, not an optional export destination. Vault notes, links, immutable source attachments and versioned structured history/provenance hold durable memory. Recall must reconcile direct vault edits, service operations and offline commands without silent overwrite or resurrection. Memory/search projections must be rebuildable from the vault; operational permissions remain protected service state.

The target requires a workspace-scoped vault association, journaled/idempotent commits, stable IDs independent of filenames, explicit conflicts, source hashes, temporal/correction history and tombstones. Capture remains locally durable when the vault is unavailable, with explicit vault-pending state. A cloud upload alone cannot be represented as completed vault synchronization. Browser/mobile need an authorized vault bridge or replica transport; neither a specific paid sync service nor a community plugin is assumed. Transport, vault schema and conflict protocol remain open implementation work.

Acceptance must include capture reaching the vault, Obsidian edits returning to Recall, correction history surviving restart/reindex, rebuilding memory/search projections from the vault, and deletion/privacy/crash recovery. The sections below document the existing pre-migration implementation and its safe exporter, not fulfillment of the required target.

## V1 implementation details

The server serializes workspace changes into monotonic identifier events. Native SQLite applies records, FTS/inventory changes and cursor transactionally. Dependent changes use event sequence rather than only parent version. Snapshot recovery preserves pending outbox operations; terminal conflicts/rejections are not endlessly replayed. Downloaded originals are hash verified and scoped by user/workspace. Tombstones remove controlled bytes before advancing SQLite state, so file-lock failures remain retryable.

Portable exports include canonical JSON and full revision/identity/correction history, source UUIDs/hashes, deterministic Markdown and byte-preserved verified originals. Private storage keys are excluded. Manifest snapshot metadata identifies the exported sync state; unverified originals are listed as unavailable. Source/model text is fenced as literal content in Markdown. Server exports are bounded and abandoned private temporary archives expire after 24 hours; normal responses unlink immediately.

The existing one-way native adapter writes only UUID memory files beneath a selected `Recall` root, uses a manifest and recovery journal, and reports conflicts when generated files were edited locally. Arbitrary user files are preserved. A subsequent managed export removes unchanged managed files that no longer exist canonically; offline exports cannot be remotely revoked. Native ZIP IPC is capped at 32 MiB for the pilot; use the portable ZIP independently for larger exports. Backups are a distinct owner-operated format, not portable ZIP import.


Version: 0.2 | Required bidirectional vault integration remains unimplemented

## 1. Source of truth

Current code uses PostgreSQL as authoritative committed application state and SQLite as a local projection/outbox. Its Obsidian integration is one-way export. This implementation must migrate to the required vault spine above; until migration is verified, preserve existing conflict/authorization semantics rather than enabling competing uncoordinated masters.

Offline work is acknowledged as saved on this device until the server accepts it. The UI shows last successful sync and any failed/conflicting operations. Do not say "synced" just because a request was sent.

## 2. Local capture durability

Camera/import URIs can be temporary. Copy the selected bytes into app-private persistent storage and persist an ordered manifest before acknowledging Save. Local operation IDs and hashes survive app restarts.

File copying and SQLite commits are not one cross-system transaction. Use staged files, fsync/atomic renames where available, a journaled manifest, and startup reconciliation for partially committed drafts. Never delete the only local copy until the cloud hash/finalization acknowledgement is recorded.

Mobile retries on foreground/resume. OS background execution is best effort; do not promise upload completion after force-quitting the app. Desktop sync/export runs while the app is running; no separate daemon is included.

## 3. Commit-ordered server change feed

A naive auto-increment event ID is not sufficient: transaction A can allocate a lower sequence and commit after transaction B, causing cursor clients to skip A.

For the pilot, serialize canonical mutations per workspace with a `workspaces.sync_clock` row lock held through the short database transaction. Read/update that counter, write the changed rows and change events, then commit together. A later workspace mutation cannot publish a higher event before the earlier transaction commits. Provider calls/uploads occur outside this transaction.

Cursor semantics are workspace-bound and monotonically ordered by committed sequence. Local application of a received page and advancement of its cursor occur in one SQLite transaction. Replaying the same event is harmless. Include deletion tombstones and record versions. Bound the event log with a documented retention policy; expired cursors require a snapshot rather than silently starting from the current head.

For a consistent snapshot, establish a database snapshot with its visible workspace cursor, page the stable snapshot, and then replay changes after that cursor. Implementation must prove there is no gap between snapshot and feed. A snapshot rebuild must preserve unacknowledged local drafts/outbox operations.

## 4. Offline commands and conflicts

Each pending command includes operation UUID, actor/device, target ID, expected version, payload, created time, and retry/error state. The server validates authorization and version independently for every command.

- Duplicate operation: return the existing outcome.
- Different payload under the same operation ID: reject.
- Stale target version: return conflict; show current and local values for explicit reconciliation.
- Deleted/revoked target: reject and prevent resurrection.
- Transient transport failure: retry with backoff and the same ID.

V1 does not attempt automatic rich-text merging or a general CRDT. Preserve both alternatives and require a targeted decision where a mutation conflicts. Commutative behavior may be introduced only with explicit tests.

## 5. Offline capability matrix

| Function | Online | Offline desktop |
| --- | --- | --- |
| Browse synchronized memory/entities | Yes | Cached records only |
| View original | Authorized cloud or cache | Downloaded and hash-verified sources only |
| Search | Keyword/entity; hybrid when enabled | Local keyword/full-text only |
| Generate a new grounded answer | Configured cloud provider | No; offer cached search, label any previously generated answer with its timestamp |
| Capture/import | Yes | Durable local draft/outbox |
| Correct a memory or complete an action | Version-checked immediately | Queued operation, may conflict on reconnect |
| Export Markdown | Latest committed synchronized snapshot | Cached snapshot, labeled with last sync time |

Mobile guarantees durable offline drafts in V1; full offline library/Ask parity is not required. Do not infer offline availability from a thumbnail.

## 6. Existing safe Markdown exporter — insufficient as the spine

The user chooses an existing vault or a new export destination. Create a dedicated `Recall/` subfolder. V1 writes nowhere else and does not ingest or relocate existing Paul-Intelligence notes automatically.

Example managed layout:

```text
<chosen vault>/
  Personal Notes/                 # untouched, user-managed
  Recall/
    HOME.md
    Memories/
    People/
    Organizations/
    Projects/
    Assets/
    Sites/
    Areas/
    Sources/
    _manifest.json
```

Exported notes contain stable Recall IDs, source revision, generated timestamp, verification qualifiers, links, and original-source references. Only claim a local original is present after its download and hash check succeed. Use supported relative Markdown/wikilinks; never require a community plugin.

Filenames use a readable sanitized title plus short stable ID. Resolve Windows reserved names, invalid characters, long paths, collisions, and case-insensitive equivalence deterministically. IDs, not titles, control identity.

## 7. Preserve manual edits

For each managed file, store the last generated content hash and corresponding Recall revision in the local export manifest. Before replacing a file, compare its current on-disk hash to the last generated hash.

- Unchanged: write to a temporary file in the same directory, flush, then atomically replace where supported.
- Changed locally: preserve it untouched; record an export conflict and offer the generated version separately without overwriting the original.
- Unmanaged file/path collision: never replace it; select a safe ID-qualified path or require resolution.
- Missing file: recreate only according to the selected export policy and show that it is managed output.

There is currently no automatic import of Obsidian edits. This is a required architecture gap, not the intended product boundary. Paul can retain a personal note or explicitly apply the correction in Recall. The UI must explain this before export is enabled. Do not put Recall-managed output under multiple competing live sync engines.

## 8. Filesystem boundary

Tauri permissions must cover only app-private storage and the explicitly selected export root. Canonicalize and validate paths in native code, reject traversal, symlink/reparse-point escapes, and absolute-path injection. Model text never becomes an executable path.

The manifest and each file update need a recoverable journal; a crash between file rename and manifest update must not cause the next run to classify a generated file as a silent permission to overwrite user changes. Test restart recovery and read-only/disk-full errors on Windows.

## 9. Deletion and portability

Deleting a capture immediately removes its content from live retrieval and schedules its derived data/originals for the documented purge flow. Send tombstones to devices; do not resurrect deleted content from an old outbox or export.

The app can clean controlled cache/managed copies when online, but cannot guarantee erasure from an offline device, a manually copied vault, or a downloaded external backup. Describe that limit clearly. Locally edited exports must not be silently destroyed by deletion reconciliation; surface them for the user's decision.

A complete user export includes Markdown, a JSON snapshot of structured records/relationships/versions, original sources, and a hash manifest. Markdown alone is not a full application backup. Exports identify the snapshot time and any unavailable sources. Current implementation recovery requires database data and source objects; target recovery must also validate the vault and reconstruct semantic projections from its notes, originals and structured history; see [SECURITY-AND-OPERATIONS](SECURITY-AND-OPERATIONS.md).
