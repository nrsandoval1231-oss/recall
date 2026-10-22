# VOICE-01 native command contract

Status: frozen for dependent UI/backend work; native implementation may refine only optional diagnostics without changing command names, required fields, status meanings, or evidence eligibility. This contract does not authorize organization, provider calls, or recording real user audio during tests.

## Commands

- `vault_audio_start(expected_vault_id, operation_id) -> AudioOperationStatus`: JS uses `invoke("vault_audio_start", { expectedVaultId, operationId })`. It validates the currently selected vault before creating one durable capture intent and opening one supported Windows input device. The renderer supplies a UUID and never supplies a path or samples.
- `vault_audio_stop(expected_vault_id, operation_id) -> AudioOperationStatus`: JS uses `invoke("vault_audio_stop", { expectedVaultId, operationId })`. It stops/finalizes that session, durably publishes the immutable WAV and v9 `capture` event first, then launches the one bound local ASR attempt. The original remains saved if ASR fails.
- `vault_audio_status(expected_vault_id, operation_id) -> AudioOperationStatus`: JS uses `invoke("vault_audio_status", { expectedVaultId, operationId })`. It validates the selected vault before inspecting any in-memory session, stage, intent, source, receipt, or ASR state. A status read never starts or retries work.
- `vault_audio_recover(expected_vault_id, operation_id, action) -> AudioOperationStatus`: JS uses `invoke("vault_audio_recover", { expectedVaultId, operationId, action })`; `action` is `"save"` or `"discard"`. It is available only for a validated `recovery_required` draft with no committed source. Save finalizes verifiable staged PCM and commits its original before one ASR attempt; discard records an explicit discard receipt and removes only a fully verified, uncommitted private stage. If the stage/source receipt is ambiguous or a source is already committed, discard is refused and all evidence is preserved. It cannot redirect a draft to another vault.
- `vault_audio_correct(expected_vault_id, memory_id, expected_revision, operation_id, text) -> VaultMemory`: JS uses `invoke("vault_audio_correct", { expectedVaultId, memoryId, expectedRevision, operationId, text })`. It appends one human correction while preserving machine transcript, source, and history.

The existing `vault_source(expected_vault_id, memory_id)` returns verified original WAV bytes as `audio/wav` for in-app playback. It continues to return the original image/text bytes for existing source kinds. Organization is deliberately absent from the native command surface until the independent audio-purpose consent contract is implemented and integrated; the current text/photo route cannot authorize audio.

## Result shape

For all five command inputs, `expectedVaultId` preserves the existing native command convention: it is `selected.vault_id`, the current selection-session token. Native validates it using `LocalVaultState::session/with`; the new commands do not introduce another selection mechanism. Response `AudioOperationStatus.vault_id` is the stable vault identity, matching `selected.vault_identity` and the internal `Vault.id`. The session token is never returned by these commands. `AudioOperationStatus` has these exact JSON fields: `schema_version: string` (currently `"1.0"`), `operation_id: string` (UUID), `vault_id: string` (stable UUID), `state: string` (`recording | saved_local | transcription_processing | transcribed | transcription_unavailable | recovery_required | unknown | failed | discarded`), `memory: VaultMemory | null`, `error_code: string | null`, `limit_reason: string | null` (`duration_limit | byte_limit | null`), `source_sample_rate_hz: integer | null`, and `source_channels: integer | null`.

At 120 seconds or 24 MiB payload the recorder automatically stops, finalizes, saves the source, and launches ASR; the UI does not need to send Stop to preserve the clip. Status may briefly report `saved_local` then `transcription_processing`. A process restart with an incomplete private stage reports `recovery_required`; no bytes are silently resumed into a new capture, and no ASR starts until explicit `recover(..., "save")`. Invalid stage identity/format fails closed and preserves evidence for diagnosis. Discard applies only to a validated uncommitted stage and never deletes a committed source or journal event.

`VaultMemory` gains optional `audio_source: AudioSource | null` and `audio_transcript: AudioTranscript | null`. Exact shapes:

```json
{
  "audio_source": {
    "capture_origin": "recorded",
    "original_name": null,
    "media_type": "audio/wav",
    "source_sha256": "<64 lowercase hex>",
    "source_bytes": 64044,
    "sample_rate_hz": 16000,
    "channels": 1,
    "pcm_bits": 16,
    "duration_ms": 2000
  },
  "audio_transcript": {
    "machine": {
      "operation_id": "00000000-0000-4000-8000-000000000002",
      "source_sha256": "<same source hash>",
      "source_revision": 1,
      "runtime_source_commit": "d1be6fde11ac6e0407606b4e42fe72d34add8037",
      "runtime_binary_sha256": "<64 lowercase hex>",
      "model_sha256": "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
      "derivative_sha256": "<64 lowercase hex>",
      "transform_version": "pcm16-mono-16khz-rubato-fft-v1",
      "output_sha256": "<64 lowercase hex>",
      "text": "Remember to call the dentist tomorrow at three in the afternoon.",
      "segments": null,
      "input_rms_pcm16": 2810.4,
      "quality_flags": [],
      "eligibility": "eligible",
      "quality_state": "machine_unreviewed"
    },
    "human_correction": null
  }
}
```

`AudioSource` required types: `capture_origin: "recorded" | "imported_wav"`, `original_name: string | null` (safe basename, display only), `media_type: "audio/wav"`, `source_sha256: string`, `source_bytes: integer`, `sample_rate_hz: 16000 | 32000 | 44100 | 48000`, `channels: 1 | 2`, `pcm_bits: 16`, `duration_ms: integer`. `AudioTranscript.machine` required types: `operation_id: string`, `source_sha256: string`, `source_revision: integer`, `runtime_source_commit: string`, `runtime_binary_sha256: string`, `model_sha256: string`, `derivative_sha256: string`, `transform_version: string`, `output_sha256: string`, `text: string`, `segments: AudioSegment[] | null`, `input_rms_pcm16: number`, `quality_flags: string[]`, `eligibility: "eligible" | "ineligible"`, `quality_state: "machine_unreviewed"`. `AudioSegment` is `{ start_ms: integer, end_ms: integer, text: string }`; only validated, monotonic in-duration arrays are returned. `human_correction` is `{ operation_id: string, text: string, corrected_at: string } | null`. Missing v9 audio fields serialize as `null` in the command DTO; v1-v8 on-disk event serialization omits them to preserve bytes.

ASR completes after `vault_audio_stop` has committed and returned the `saved_local` receipt. The UI polls `vault_audio_status`; an ASR error never hides or removes the saved source. Transcript details display: “Machine transcript may omit or mishear words; check the recording.” A citation uses the existing vault evidence flow and opens `vault_source`; no local path is exposed. `VaultMemory` carries the exact same field objects above plus existing fields. `vault_source` for audio returns the existing `{ bytes: number[], mime_type: "audio/wav", sha256: string }` response shape after source verification.

## Organization boundary

Audio organization is reported unavailable until the separate remembered, future-only audio consent API and `OrganizationBinding` 3.0 are integrated. Native will not call the existing text/photo organization API for audio. Ordinary machine transcripts may be eligible for a future audio-specific organization operation without a per-note approval prompt; failed, unknown, empty, near-zero-gated, or sole observed non-speech-marker results are ineligible.

## Limits and device behavior

One session; advertised PCM input only; 16/32/44.1/48 kHz mono/stereo; auto-stop after 120 seconds or 24 MiB PCM payload. Unsupported device/configuration, denied permission, device loss, bounded-queue overflow, selected-vault change, ASR timeout, hash mismatch, or unsupported CPU return a truthful state/error while preserving any already-saved source. This command contract does not claim installed microphone acceptance.
