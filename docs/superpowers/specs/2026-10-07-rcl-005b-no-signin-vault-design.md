# RCL-005B — No-sign-in Obsidian memory spine

Date: 2026-10-07. Status reconciled: 2026-10-08. **Bounded local desktop foundation and lifecycle implemented on the review branches; full RCL-005B remains open. Pairing/relay remain proposed.**

Subsequent owner direction: “Ok keep going until the product is finished”. The bounded [local-only implementation plan](../plans/2026-10-07-local-vault-foundation.md) carries this design forward with tests and independent review; routine stage approval is not required for that scope. QR association remains unanswered. No operational permission is implied. The proposal text below retains the full target and excluded future stages.

This develops [ARCHITECTURE](../../ARCHITECTURE.md), [PRD](../../PRD.md) and [RCL-005B](../../ROADMAP.md), which remain the canonical product documents. It is not an implementation plan or permission to change deployed systems. The proposal itself changes no runtime. The subsequent local-only plan permits product code; credential creation, permission grants, private-data migration, deployment, purchase and merge remain excluded.

## 1. Requirement and decision boundary

The owner said: “i dont want to have to sign in anywhere”. Required meaning: **no account/password/email-link sign-in, including first use**. Remembering a login or avoiding repeated email entry does not qualify. Private local-only use must require no remote account. Obsidian remains the required user-owned memory authority, preserving immutable originals, provenance, human corrections, temporal history and source-grounded recall.

Cross-device private use still needs secure owner-approved device association. **One-time QR pairing is proposed, not accepted.** The owner has already been asked whether that interaction is acceptable; no answer is assumed. If declined, local-only remains viable, but automatic private cross-device access cannot be implemented by opening the vault or API to strangers. A different owner-approved association method would need review.

The original architectural gate called for separate written-design and plan approvals. Subsequent owner direction authorizes the bounded local-only work and agent-selected execution approach; no approval is inferred for unanswered QR pairing or operational changes.

## 2. Approaches and recommendation

| Approach | Benefit | Cost / limitation |
| --- | --- | --- |
| Local-only vault on one device | Smallest private foundation; no remote account, relay or network dependency | No automatic cross-device memory; phone drafts need explicit transfer/import, and lost devices need an owner-held backup |
| Local-first vault with optional paired private synchronization | Same local foundation plus automatic delivery between authorized devices; phone can capture while desktop is off | Requires owner-approved device association, revocation/recovery and a bounded transport; relay receipt is not vault commitment |
| Keep hosted email auth with persistent sessions | Reuses existing deployed implementation | Rejected as target: first use still requires sign-in and depends on provider delivery |

Recommend the second approach, built in bounded stages: local vault round trip first, then optional pairing/transport only if approved. Local-only must remain fully usable for capture, readable memory, correction and local search. A hosted relay or AI service is never a prerequisite for that loop. Do not introduce local PostgreSQL, a new graph/queue service, a community plugin or paid Obsidian Sync.

## 3. Current versus proposed

At this proposal's original baseline, authoritative memory/history lived in PostgreSQL and originals in private object storage. That remains the legacy cloud path: its native export is one-way and preserves direct edits as conflicts rather than ingesting them. Browser/mobile and explicit desktop legacy mode retain Supabase email auth. Historical deployment and email-delivery evidence must remain intact; it does not establish the no-sign-in target.

The newer local desktop review branches implement a bounded no-sign-in path: select a vault, import an original image, optionally annotate it, browse/search annotations, inspect the original/history, correct supported note bodies, reconcile direct Obsidian body edits and flat renames, explicitly restore missing notes, and logically remove memories with retained tombstones. New local records are vault-authoritative. No existing cloud records have been migrated. See the [foundation evidence](../../implementation/local-vault/README.md) and [lifecycle evidence](../../implementation/local-vault-lifecycle/README.md) for test and platform limits. This is not full semantic memory reconstruction, automatic photo understanding, grounded Ask, phone synchronization or installed-device acceptance.

Remaining full target: extend the native vault commitment boundary to semantic memory and its retrieval projections. SQLite may store rebuildable local indexes plus non-rebuildable pending operations until acknowledged; the bounded annotation search currently rebuilds directly from validated vault files. PostgreSQL/pgvector may support optional jobs and search projections, but a complete vault must recover memory without the old database. Credentials, device membership and revocation state are separate protected operational state; importing a vault cannot import permission to a network service.

## 4. Components and trust boundaries

- **Native vault adapter:** receives validated domain operations, reads/writes only the selected vault scope, checks paths and hashes, journals commits, observes direct edits and returns durable commit receipts. Obsidian need not be running.
- **Local domain and projection layer:** preserves the universal source/semantic/temporal model, validates corrections and expected revisions, indexes committed vault events and serves local source-backed search. Model output cannot write files or grant permissions.
- **Phone capture adapter:** writes exact original bytes and an ordered manifest into durable app-private storage before acknowledging Save. Pending operations survive restart, retries and desktop unavailability.
- **Optional transport:** moves authorized envelopes and original bytes between paired devices. The recommended first transport is authenticated direct transfer when reachable, with an optional store-and-forward relay for independent availability. No plaintext public vault endpoint, anonymous private API, LAN trust shortcut or automatic port exposure.
- **Optional AI/service adapter:** reads only authorized necessary content after explicit consent/budget configuration. A relay is not an AI processor. Local source browsing/search remains available if AI is unavailable; no fresh offline generative answer is promised.

An ordinary Obsidian vault is readable by its OS owner and other software granted that filesystem access. App scope and OS permissions protect local use; disk encryption and backups are separate owner controls. “Private” does not mean a plaintext Markdown vault is cryptographically hidden from its unlocked OS user.

## 5. First device, phone-first use and association

Proposed first desktop use: open Recall, create or choose a vault through an OS folder permission, initialize its manifest, and capture. No remote account, password, email, cloud provisioning or internet check blocks this. Existing non-Recall notes are left untouched unless explicitly imported. A phone starting first creates durable local drafts without enrollment; it truthfully shows “Saved on this device; waiting for vault”. The first bounded design anchors canonical vault commitment on the native desktop adapter; a phone-only canonical vault is a separate platform feasibility question, not promised here.

For optional sync, propose locally generated per-device identities in OS-protected storage and an owner-controlled device registry. Initial trust is created on the local owner device, never by “first visitor wins” on a public endpoint. Relay bootstrap, if used, is installed/enrolled through that trusted device or an owner-administered provisioning channel, with no end-user account sign-in. Exact cryptographic library, protocol and service provisioning contracts require review in the implementation plan; this proposal does not invent or deploy a custom protocol.

Proposed QR flow: an already trusted owner device presents a short-lived, single-use invitation bound to its vault and a new-device challenge. Both devices confirm matching identity/fingerprint information; the trusted device explicitly approves the new key and scope. Expired, replayed, wrong-vault or substituted invitations fail closed. A QR must not contain a persistent owner credential or grant access merely by being photographed. An unpaired browser/phone cannot claim an existing workspace using its name, ID or a known URL. Subsequent requests authenticate device possession and check current membership; no account login is involved.

## 6. Vault representation and durable commitment

Conceptual full-target managed subtree, within the user-selected Obsidian vault (not an on-disk version-1 contract):

```text
Recall/
  Memories/<stable-id>.md
  Entities/<stable-id>.md
  Sources/<source-id>/original.<validated-extension>
  History/<operation-id>.json
  _meta/manifest.json
  _meta/commits/<commit-id>.json
```

The implemented bounded adapter uses a different, versioned layout: flat `Recall/Sources/<uuid>.<type>` originals, `Recall/Memories/<uuid>.md` notes (including supported flat renames), per-memory `Recall/History/<uuid>/<revision>.json` revisions, and metadata under `Recall/_meta`. [ARCHITECTURE](../../ARCHITECTURE.md#implemented-local-desktop-subset) describes that current contract. The conceptual tree above does not authorize rewriting it; future semantic/schema changes need explicit compatibility and recovery design.

Markdown supplies readable text, stable IDs and relative evidence/entity links. Structured history records schema version, operation/device IDs, parent revisions, source IDs/hashes, actor attribution, uncertainty, correction precedence, event/recorded time, temporal validity, supersession and tombstones. Commit manifests list exact paths, lengths and hashes. Identity follows IDs, not filenames. Sensitive credentials and private keys never enter this tree. A content hash detects corruption; it does not establish owner authorization.

Originals are immutable once accepted; a replacement is a new source with an explicit relationship, never overwritten evidence. User edits to an original are quarantined as a hash mismatch and require recovery from a verified replica or explicit import as new evidence. Unknown schemas or corrupt history block promotion; preserve bytes and explain the issue.

A single adapter coordinates writes per local vault replica. Stage bytes on the same filesystem, validate and flush, append the operation/history, write a commit manifest, atomically publish supported file replacements and record a durable completion marker. A multi-file rename is not assumed atomic. On restart, use the journal to finish or roll back incomplete application before indexing. External readers may briefly observe partial materialized notes; Recall does not acknowledge or index a partial commit. Verify platform-specific flush/rename behavior, disk-full, read-only and crash recovery before claiming durability. Native path validation rejects traversal, absolute paths and symlink/reparse escapes.

The adapter returns separate local-save, relay-receipt, vault-commit and projection-version acknowledgments. Only a verified committed vault revision counts as canonical memory. Unsupported files or drafts never become eligible evidence because an index row happens to exist.

## 7. Direct edits, conflicts and reconstruction

Observe managed Markdown changes against the last committed bytes/hash; debounce incomplete editor writes and retain a base revision. A valid edit becomes an attributed human revision with the previous content retained in history. Unstructured prose changes never silently become verified claims, temporal assertions, identity merges or permission changes. Preserve prose as a human note and request targeted resolution where structured meaning is ambiguous. Accepted human overrides continue to outrank model reprocessing.

Use operation IDs and expected parent revisions. Identical retries reuse receipts; a changed payload under the same ID fails. Concurrent edits from Obsidian, Recall or another device preserve both variants and their common base, requiring explicit resolution before affected projections advance. No silent last-writer-wins or speculative CRDT. Unaffected memories remain usable. Detect renames by stable ID; duplicate IDs are conflicts. A missing file is a pending deletion decision, not automatic destruction or automatic resurrection. Confirmed deletion creates a tombstone that dominates stale edits/outboxes. Unsupported external sync engines are not allowed to race as competing writers to the managed subtree.

Reconstruction validates the manifest, completed commits, original hashes and full structured history, then deterministically rebuilds semantic records, corrections, temporal views, relationships, citations and tombstones. Embeddings/FTS are regenerated. Device clocks do not choose the winning revision or rewrite event time. A new projection generation becomes active only after validation; retain the previous generation if rebuilding fails. Rebuilding memory never restores revoked network grants.

## 8. Offline periods and browser limits

| Situation | Required behavior |
| --- | --- |
| Desktop running, Wi-Fi/internet unavailable | Commit locally; read verified local originals; use local search; queue sync. No cloud AI claim |
| Desktop off, phone offline | Save originals/manifest on phone; show local-only, preserve across restart, retry later |
| Desktop off, phone online, approved relay enabled | Relay may acknowledge encrypted durable receipt; show waiting for vault; desktop later validates and commits before canonical success |
| Desktop off, no relay | Keep durable phone outbox until an authorized peer is reachable; no false upload or sync promise |
| Reconnection/concurrent changes | Revalidate membership, revisions and tombstones, verify bytes, resolve conflicts, then advance cursors atomically |
| Browser alone | No assumed arbitrary vault filesystem access, reliable background execution or native durability; show scoped draft/cache limits |

The optional relay stores end-to-end encrypted envelopes/blobs for paired devices, with quotas, bounded retention and explicit acknowledgments. Devices retain pending originals until vault commitment; relay expiry cannot silently delete their only copy. Retention and disk-pressure failures must stop new acceptance truthfully. This encryption claim applies to the proposed relay, not the current deployed backend. Cloud AI/search, if enabled, creates a separate consented plaintext processing boundary and must be described as such.

A browser can be an optional paired surface through an authenticated scoped bridge, but it is not the primary vault owner in this minimal design. Test supported browsers for file permission persistence, storage eviction, restart and background behavior before claiming offline reliability. Browser-held device state can be cleared; reenrollment requires a trusted device. Do not promise an iPhone browser can continuously synchronize an arbitrary Obsidian folder. The existing browser-first pilot therefore cannot fulfill the entire target merely by hiding its login screen.

## 9. Revocation, recovery and loss

Trusted owner device settings show associated devices and allow revocation. Network services reject revoked identities on every request; rotate affected future transport encryption keys and distribute them only to remaining members. Offline peers learn revocation on reconnect, then reject stale grants before accepting pending operations. Remote revocation cannot erase already downloaded plaintext, offline vault copies or backups; loss of a trusted unlocked device is a disclosure risk.

An owner may separately elect an offline recovery package: vault backup, verified history/hash manifest and protected recovery material, stored outside the synchronized vault. Creating such material is future implementation/owner action, not part of this task. Recovery must revoke old network identities and establish a new trust epoch; importing a backup never silently reactivates revoked devices. With no trusted device and no valid recovery material, private encrypted synchronization may be unrecoverable. A surviving readable vault can bootstrap a new local workspace, but cannot claim access to the old relay by knowing its vault ID. No email-based fallback or hidden master bypass.

## 10. Migration and rollback

Do not migrate private data under this proposal. After design/plan approval and separate operational authorization:

1. Snapshot legacy PostgreSQL/history and hash-verified originals under existing maintenance controls; retain rollback backups and record the schema/cutover revision. A trustworthy existing owner credential or separately approved local administrative transfer is needed to access legacy private data; never bypass current auth. The fresh-install target still has no sign-in.
2. Build a candidate vault in a separate selected root. Preserve IDs, links, attribution, original bytes, accepted corrections, temporal revisions, uncertainty and deletion state. Do not invent missing original bytes or mark incomplete migration successful.
3. Rebuild clean projections solely from the candidate vault and compare entity/revision counts, hashes, citation resolution, corrections, historical/latest queries and tombstones against the baseline. Quiesce writes for final delta verification; never operate two independent authorities.
4. Change authority only after parity and recovery checks pass. Legacy services remain read-only or explicitly route writes through the new commit boundary. Keep cutover manifests and backups until rollback rehearsal and owner acceptance.
5. Before cutover, rollback discards only the candidate and resumes the untouched legacy baseline. After new vault writes, freeze writes and preserve a complete vault snapshot/event log; prove replay into the old schema before reverting. If replay cannot preserve semantics, stay in vault recovery/read-only mode rather than silently lose new memory. Restoring an old database is not a valid post-cutover rollback by itself.

## 11. Acceptance and next decision

Required future evidence: fresh install without network/account; phone-first force-close recovery; desktop-off/Wi-Fi-off retry; original hash equality; interrupted multi-file commit recovery; direct Obsidian edits and concurrent revisions; duplicate IDs and malicious paths; stale correction/reprocessing; historical/latest citations; tombstone replay; complete projection rebuild; expired/replayed pairing invitations; wrong-workspace access; revocation and recovery; browser limits; migration parity and both rollback boundaries. Use synthetic fixtures for repository evidence; real device/private corpus acceptance remains separately authorized.

Documentation checks do not prove these behaviors. This design supplies requirements and a proposed full architecture; the linked implementation evidence covers only the bounded local subset. Its tests do not establish the remaining phone, pairing, relay, semantic reconstruction or migration acceptance criteria.

**Smallest unresolved product decision:** is a one-time owner-approved QR device association acceptable, provided there is no account, password or email-link sign-in, including first use? Local-only use remains viable independently of that answer. Pairing, relay and operational migration remain outside the bounded local implementation and this documentation review.
