# VOICE-01 installed-device + microphone acceptance checklist

Candidate: `879569f5438a3c15f4dc5c7ca63718779d15d92a` (VOICE-01 + AUDIO-ORG-01 + ORGSTATE-01)
Independent source review: PASS — `.agent/VOICE-01/INDEPENDENT-REVIEW-2026-10-26.json`
Installer: `.agent/VOICE-01/Recall-879569f-x64-setup.exe`
**SHA-256: `074e40cb9fe93639039b5f977247d7cd9d283f730be6e69ea7acd85a6b46de68`** (135,284,280 bytes, unsigned, currentUser install mode)

Build facts already verified at script/archive level (no install needed):
- `whisper-cli.exe` + 4 DLLs install beside `recall-desktop.exe` (install root).
- Model at `resources\models\ggml-base.bin`, 147,951,465 bytes, SHA-256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` — matches the compiled-in manifest, F0 pin.
- Licenses at `resources\licenses\`. Bundled model: no first-use download.

## Before you install (2 minutes)

1. Verify the installer hash you actually run equals the SHA-256 above:
   `certutil -sha256 .agent\VOICE-01\Recall-879569f-x64-setup.exe` (or `sha256sum` in Git Bash).
2. Use a **disposable Windows user or VM** if possible. This is an unsigned build; Windows SmartScreen will warn ("Windows protected your PC" → More info → Run anyway). It writes only to the user profile (`%LOCALAPPDATA%`, selected vault folder). Do not point it at your real Obsidian vault first — create a disposable vault folder.

## Install and first run

3. Run the installer; keep the default install location. Note exact install path.
4. **No-download check:** before first Record, set the machine offline (airplane mode / disable adapters). First transcription must succeed offline — a download prompt or network failure here is a FAIL (bundled-runtime requirement).
5. Launch Recall. Confirm the app shows the everyday surface (capture / search / recent), not an error about missing runtime or model.

## Microphone proof (core acceptance)

6. **Denial path first:** temporarily deny microphone permission (Windows Settings → Privacy → Microphone → off). Press Record. Expected: a clear explanation that the microphone is denied, and **nothing saved** (no partial source, no journal event). Screenshot.
7. Re-enable the microphone. Press **Record**, speak 10–20 s of known content (say distinctive words/numbers you can verify, e.g. "Meeting with Sarah on March 3rd, budget 250 dollars"). Press **Stop**.
8. Expected within a short local processing time: a **visibly unreviewed** machine transcript appears; the recording is listed as saved. Confirm:
   - The WAV original exists in the vault (`Recall/Sources/<id>.wav`) with nonzero size.
   - Playback works (hear your actual words).
   - The transcript is labeled as machine/unreviewed — it must not look like verified text.
9. **Correction:** edit at least one transcript word to the correct text, save. Expected: the human correction takes precedence in current organization/search; the prior machine reading remains visible in history (open the memory's history and confirm both readings appear).
10. **Ask citation:** ask a natural question whose answer is only in that recording (e.g. "what was the budget number?"). Expected: the answer cites the audio memory; opening the citation plays/lands on the original recording and labels the transcript as machine-derived.

## Audio organization consent (AUDIO-ORG-01)

11. Confirm automatic organization of transcripts is **off by default** (no transcript is silently organized after step 8).
12. Enable "Organize voice notes automatically". Record a second note. Expected: the transcript becomes organized only after the opt-in; earlier recordings (step 7) stay unorganized (future-only, no backlog sweep).
13. Revoke the consent. Record a third note. Expected: it stays unreviewed/unorganized; nothing is queued silently.

## State honesty (ORGSTATE-01) — optional spot checks

14. While an organization is showing `queued`/`processing`, revoke consent (step 13 covers the visible path). Expected honest terminal state, no phantom `processing` forever.
15. Kill the app mid-processing (Task Manager → End task) and relaunch. Expected: the operation resumes or reports an honest `unknown` with the original intact; never a duplicate or second dispatch.

## Wrap-up evidence to record

- Exact installer SHA-256, install path, Windows version, microphone device.
- UTC timestamps of install, first record, correction, ask.
- Screenshots: denied-mic message, unreviewed transcript, history with both readings, Ask citation, consent on/off states.
- Honest failures are acceptable — record what happened instead of retrying until it looks good. Plain-word hallucinations from silence (documented quality risk) should be noted verbatim when observed.
- Known limits to state in the completion record: English-only recognition; no speaker identity; bundled `ggml-base` accuracy tier; unsigned build; synthetic+fixture code evidence remains the basis for everything not proven on the installed app.

## What this checklist does NOT close

Live provider audio Ask (separate private service authorization), held-out speech-quality evaluation on diverse voices/noise, phone transport (R7C), parent finish gates (R8). Do not claim them from this checklist.
