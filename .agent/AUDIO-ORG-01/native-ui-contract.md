# AUDIO-ORG-01 native command and DTO contract

Status: frozen for the UI packet; native may refine only optional diagnostics. All JS arguments are camelCase (Tauri converts); every result field below is snake_case exactly as shown. `expectedVaultId` is `selected.vault_id` (the selection-session token), validated before any state is read, exactly like the existing organization commands. Nothing here sends a recording anywhere: only the bounded transcript text of recordings captured **after** the remembered decision is ever sent, and only to the private service.

## Commands (all new; text/photo commands are unchanged)

| Command | JS invoke | Result |
|---|---|---|
| `vault_audio_organization_capability` | `{ expectedVaultId }` | `AudioOrganizationCapability` |
| `vault_set_audio_organization_consent` | `{ expectedVaultId, enabled, expectedConsentEpoch }` | `AudioOrganizationCapability` |
| `vault_reconcile_audio_organization_consent` | `{ expectedVaultId }` | `AudioOrganizationCapability` |
| `vault_audio_organization_operations` | `{ expectedVaultId, memoryId }` | `OrganizationOperation[]` (zero or one entry) |
| `vault_recover_audio_organization` | `{ expectedVaultId, operationId }` | `OrganizationOperation` |

The first three mirror `vault_organization_capability`, `vault_set_organization_consent` and `vault_reconcile_organization_consent` and behave identically (server decision first; local future-capture marker only after a confirmed decision for the unchanged paired connection; ambiguous outcomes surface as errors and must be refreshed with capability/reconcile). They use a **separate** server consent, epoch and local marker; the text/photo control never affects them and vice versa. There is no per-note approval and no "organize now" command: queueing and dispatch are automatic. `vault_recover_audio_organization` only retries *recovery of the same operation* (receipt lookup; it never re-sends an ambiguous operation blindly).

### `AudioOrganizationCapability` (same shape as `NativeOrganizationCapability`)

```json
{
  "schema_version": "1.0",
  "scope": "vault_intelligence",
  "purpose": "organize_audio",
  "vault_id": "<stable vault uuid>",
  "policy_version": "organize-audio-v1|<ai policy>|<model or unconfigured>",
  "provider": "anthropic" ,
  "consent": "active | missing | outdated",
  "enabled": true,
  "consent_epoch": 1,
  "decided_at": "<RFC3339 or null>",
  "local_readiness": "ready | needs_setup | unknown | off",
  "automatic_enabled": true
}
```

`provider` may be `null`. `enabled` is the server's (consent AND service flag AND provider configured). `automatic_enabled = enabled && local_readiness == "ready"`. `local_readiness` semantics are identical to the text/photo control: `ready` (marker matches server consent, policy, epoch and the paired connection), `needs_setup` (server consent active but no/old local marker, or marker for another policy/epoch/connection), `unknown` (marker exists but server says missing/outdated, or the marker is unreadable), `off` (no consent, no marker). Copy for the control must say that only the transcript text of **future** recordings is sent to Claude, never the recording; that the choice is remembered and revocable; that existing recordings are not affected; and that the private service connection is required.

### `OrganizationOperation`

```json
{ "operation_id": "<uuid>", "memory_id": "<uuid>", "state": "<state>", "error_code": "<code or null>" }
```

Exactly one operation exists per recording captured while an audio marker existed (none for earlier recordings). `state` values:

| state | meaning |
|---|---|
| `awaiting_transcript` | recording saved; no usable transcript yet |
| `queued` | eligible transcript (or human correction) bound; will be sent automatically |
| `processing` | send/recovery in progress |
| `unknown` | outcome ambiguous (e.g. `NOT_DISPATCHED`, `RECEIPT_UNAVAILABLE`, `PROVIDER_OUTCOME_UNKNOWN`, `RECEIPT_INVALID`, `PROMOTION_FAILED`); recoverable with `vault_recover_audio_organization`, never re-sent blindly |
| `organized` | validated proposals were journaled onto the recording |
| `failed` | service reported failure (`error_code` from the service, e.g. `INVALID_EXTRACTION`, `PROVIDER_FAILED`, `RECEIPT_EXPIRED`) |
| `stale` | retired, never sent or promoted: `CONSENT_REVOKED`, `CONSENT_EPOCH_CHANGED`, `CONNECTION_CHANGED`, `CONSENT_CHANGED`, `SOURCE_OR_REVISION_CHANGED`, `TRANSCRIPT_CHANGED`, `HUMAN_CORRECTION`, `INPUT_CHANGED`, `REQUEST_CHANGED`, `NOT_QUEUED`, `SOURCE_OR_CONNECTION_CHANGED`, `STATE_CHANGED` |
| `saved_local` | recording and transcript kept; honestly not organized: `TRANSCRIPT_INELIGIBLE`, `TRANSCRIPTION_FAILED`, `INPUT_LIMIT_EXCEEDED`, `EMPTY_CORRECTION`, `REQUEST_INVALID` |

A human correction made while the operation is `awaiting_transcript`, `queued` (not yet sent) or `saved_local` with one of the codes above re-binds it to the corrected wording (`queued` again with evidence kind `human_corrected`). After dispatch or promotion a correction never re-organizes: the earlier proposals are suppressed (see below).

## `VaultMemory` additions

`VaultMemory` gains one field, `audio_organization`, **always present in command results**: `null` when there are no proposals (and for every non-audio memory), otherwise an `OrganizationProposal`:

```json
{
  "binding": {
    "schema_version": "3.0",
    "operation_id": "<uuid>", "vault_id": "<uuid>", "memory_id": "<uuid>",
    "source_kind": "audio_transcript",
    "source_sha256": "<sha256 of the full WAV>",
    "expected_revision": 3,
    "input_sha256": "<sha256 of the exact transcript UTF-8>",
    "derivative_sha256": "<sha256 of the 16 kHz derivative that was transcribed>",
    "transcript_revision": 3,
    "transcript_evidence_kind": "machine_unreviewed | human_corrected",
    "consent_epoch": 1,
    "captured_at": "2026-10-22T12:00:00Z"
  },
  "media_type": "text/plain; charset=utf-8",
  "payload_sha256": "<sha256>",
  "result": {
    "provider": "anthropic", "model_id": "<model>", "input_manifest_sha256": "<sha256>",
    "extraction": { "summary": "...", "summary_evidence": [], "pages": [{ "page_id": "<memory id>", "ordinal": 1, "transcription": "<exact transcript>", "legibility": "mixed" }], "mentions": [], "statements": [], "action_suggestions": [], "uncertainties": [] },
    "validation_notes": [], "review_state": "unreviewed"
  },
  "review_state": "unreviewed",
  "suppressed": false
}
```

The `extraction` has exactly the shape of the text/photo `organization.result.extraction` (every `quote` is an exact substring of `pages[0].transcription`; `legibility` is never `clear` for `machine_unreviewed`). `provider: "anthropic"` is semantic-provider provenance only; it is **never** ASR provenance (that is `audio_transcript.machine`). Everything is an unreviewed proposal, not a verified fact; the UI must present it under the transcript as "Unreviewed machine proposals derived from an unreviewed machine transcript" (or "…a human-corrected transcript" when `binding.transcript_evidence_kind == "human_corrected"`), with no approve/verify affordance.

`suppressed: true` means a human transcript correction (or removal/restore, or a machine re-run) retired the proposals after they were created: show a "suppressed; kept in history" state, do not offer them as current, and do not use them for search or answers. Native search ignores suppressed proposals.

The same field appears (always present, `null` when absent) on `VaultRevision.audio_organization` and `RetainedRevision.audio_organization` (history and historical citations retain suppressed proposals). Note: `VaultRevision.audio_transcript` and `RetainedRevision.audio_transcript` are likewise always present (`null` when absent).

## Obsidian Markdown (informational)

When an unsuppressed proposal exists the note contains an inert `## Machine proposals (unreviewed)` section between the transcript and the human annotation; when suppressed it contains `## Machine proposals (suppressed)`. Direct edits remain confined to the human annotation region; editing generated sections is a conflict.

## Not in this contract

No related-memory context or links for audio, no organization of text/photo from audio, no per-note approval, no backlog enrollment, no consent shortcut from the text/photo control. Audio transcripts are still excluded from the context sent for other memories' organization.
