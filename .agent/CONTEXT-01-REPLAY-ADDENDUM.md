# CONTEXT-01 native v7 replay addendum

Status: bounded architecture decision for the **active** [CONTEXT-01 packet](CONTEXT-01.md), after ORGANIZE-01 PASS at `c6ba102968d9c4b6513d5a4f8c9a0cbe446293563249ce6ba1078cc24d777b82`. No source or canonical-document edit and no completion verdict. Native lane consumes this before implementation; backend wire/fixture and v1–v6 bytes are unchanged.

## Decision: journal the resolved projection, not a live lookup

The current vault validates every stored event with `e.markdown == markdown_for(e.format, e.memory)`, hashes the event bytes into history/receipt and chains `parent_sha256` to the prior history file. A v7 renderer that looks up a target's **current** note basename would change its output after the target is renamed, falsely marking valid historical source events corrupt. Persist the minimum software-derived link rendering snapshot **in each v7 source event**:

```json
"context_link_projection": [
  {
    "target_memory_id": "00000000-0000-4000-8000-000000000004",
    "note_basename": "Project Lantern.md",
    "suppressed": false
  }
]
```

`Event.context_link_projection` is **required (possibly `[]`) only for `recall-local-vault-v7`**, forbidden in v1–v6 event bytes, and is not an API/provider field or semantic identity edge. Exactly one entry, in result order, corresponds to each immutable `organization.result.related_context` target; no extra/duplicate target. Each basename must be a safe flat `.md` child of `Recall/Memories`, bounded and escaped by the renderer; reject separators, traversal, reparse paths and invalid names. The full v7 payload hash includes the projection as a version-specific final component after the existing reading/organization hash. The stored `markdown` is rendered **only from the event's memory plus this snapshot**; neither `event_valid`, replay, crash recovery nor old-format byte checks re-resolve a target against today's filesystem. `previous_markdown`, journal/history equality, receipt hash and parent hash continue their existing checks. This basename is a journaled publication fact: native derives it from the verified target's selected note path immediately before the first v7 commit under the vault lock; the model, UI and backend never choose it. Replay validates its syntax, target membership and renderer/hash consistency, not whether today's target still has that name.

Current eligibility is separate from historical replay. A live related link is offered only when the source proposal and projection entry are unsuppressed **and** the target is still active, conflict-free, source-verified, at the bound revision/hash/effective excerpt and at the snapshotted note basename. A failed check suppresses it from Recall search/UI immediately and queues a journaled repair; it cannot become current merely because an old Markdown link exists. Historical event bytes and old published Markdown remain inspectable as history.

## Monotone suppression and external rename reconciliation

Add one v7-only journal event `kind="context_suppress"`, `origin="system:recall"` with a fresh operation ID. It carries the same source `VaultMemory.organization` result/binding, unchanged human note and source, and a projection differing **only** by one or more `suppressed: false -> true` entries. It increments the source revision, uses the prior event hash as parent, retains `previous_markdown`, and deterministically removes those links from new v7 Markdown. `organization.suppressed` still governs the whole machine proposal after a source human edit/correction; `context_suppress` leaves unrelated source-local summary/statements intact. Never revive a suppressed entry or replace its basename/evidence in a later revision; a new provider proposal is a separate consented operation.

**Correction to the original draft:** Recall has no public/native note-rename operation. The supported rename is an already-completed flat `.md` move by Obsidian or the user. `inventory()` discovers stable identity at the new basename during `reconciled()`. Native cannot pre-suppress or abort that external move. Under the selected-vault/writer boundary, detecting a changed basename makes inbound links immediately ineligible through current-target basename/revision/source checks, then attempts monotone `context_suppress` journal commits for their source notes. A dependent source conflict or interrupted commit preserves both files, marks repair pending and retries reconciliation/recovery without replacing the user's edit or reviving the stale link. Target human correction/removal uses the same fail-closed eligibility and repair rule; never block the human action. Do not rewrite historical v7 events to follow a target's new path. This corrects the nonexistent native-rename assumption while preserving historical replay, source authority and stale-link protection.

Native tests must freeze a v7 event, externally rename its target, reopen/replay/recover the source and prove its old event/Markdown/history bytes still validate; prove the link is withheld immediately and a new suppression revision removes only that link. Inject an interruption between external rename discovery and suppression commit, then prove restart/reconciliation resumes the repair without a stale visible link or overwritten Obsidian edit. A conflicted dependent source leaves the external target rename intact, preserves both files, surfaces pending repair and never returns a live stale link. Run existing v1–v6 byte fixtures unchanged. This addendum introduces no native rename feature, graph service, database authority or second provider call.
