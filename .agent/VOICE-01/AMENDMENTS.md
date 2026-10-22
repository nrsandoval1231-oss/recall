# VOICE-01 controller amendments

Date: 2026-10-22. Applies on top of [NATIVE-DRAFT](NATIVE-DRAFT.md) (design-reviewed SHA256 `3a4cfaa8b8e5e28e9f18248bb36a945e967f2884484e605b8db1982cc8471aae`, left unchanged) and [native-ui-contract](native-ui-contract.md). Each item was raised by implementation or independent review and approved by the controller within the existing local-only authority. None widens provider, consent, device-association, deployment or private-data authority.

## A1. Non-speech eligibility rule (replaces the marker list)

The draft listed sole `[Music]` / `[BLANK_AUDIO]` as ineligible. The pinned runtime also emitted `(crickets chirping)` for a 440 Hz tone, and multi-segment clips produce repeated markers such as `[Music] [Music]`. The structural rule is now: after removing every whole `[...]` and `(...)` span, if only whitespace, punctuation or music-note characters remain, the machine transcript is **ineligible** with quality flag `non_speech_annotation`. Mixed text such as `(laughs) call at 3` stays eligible. Native recomputes eligibility; a forged `eligible` is rejected. The RMS <= 5 preflight gate is unchanged. Plain words hallucinated from non-speech (for example `you` from silence when the gate does not fire) are **not** caught and remain a quality risk for held-out acceptance.

## A2. Asset layout follows the F0-proven installed layout

The four runtime DLLs install beside `whisper-cli.exe` (resource destination `""`, install root); the model installs at `resources/models/ggml-base.bin`; notices at `resources/licenses/`. Native requires the DLL directory to equal the sidecar's parent and hash-verifies all files against the compiled-in manifest before each launch. Verified 2026-10-22 at script level: an unsigned release NSIS build (SHA256 `8389f56b22b23ea10316bef2714255131ff28852ee4644e967b1ddf137f8cfb4`, not installed) generated `installer.nsi` placing `whisper-cli.exe` and the four DLLs at `$INSTDIR` beside `recall-desktop.exe`, the model at `resources\models\ggml-base.bin` and notices at `resources\licenses\`; the staged DLL, CLI and model hashes match the manifest. Running an installed copy and launching the sidecar from it remain unproven.

## A3. Content-Security-Policy

In-app playback uses `blob:` media URLs, so the CSP gains exactly `media-src 'self' blob:`. A regression test pins it.

## A4. Command surface additions and behaviors

- `vault_import_wav(expected_vault_id, operation_id) -> VaultMemory | null` is a supported optional command (native picker; same source commit path; refuses an operation ID that already has a recording stage).
- `vault_select` (including re-selecting the same vault) is refused while a recording or a local transcription is in flight, with specific messages; the check is enforced under the selection mutex.
- Status after a failed start or an empty recording returns the same `failed` state and code the original call returned.
- History/citation DTOs serialize an absent `audio_transcript` as `null`; v1-v8 on-disk events still omit absent audio fields.
- Segments are always `null` for now (the pinned CLI argument vector `-nt -np` emits no timestamps); the bound check is strict (ends at or before duration).
- Recognition language is the CLI default (English) on the multilingual model, matching the F0 argument vector. Multilingual transcription is not accepted.

## A5. Related-memory links across formats

Current related links and their suppression apply to v7, v8 and v9 manifests (previously v7 only, a pre-existing gap now covered by regression tests under v8 and v9 including target correction and removal). Context suppression events are built as v7 and normalized to the manifest format by the writer.

## A6. Backend Ask evidence kinds

The current (1.0) and retained-history (2.0) Ask wires accept exactly `machine_audio_transcript` (epistemic state `unreviewed`) and `human_audio_correction` (`reported`). Machine audio transcript is presented as untrusted, unreviewed machine transcription; a human correction takes precedence; answers relying on machine transcript carry a fixed disclosure limitation. Audio **organization** (separate audio consent route, `OrganizationBinding` 3.0) is **not** implemented and remains the next backend/native packet.
