import type { AudioOperationStatus, AudioState, OrganizationOperation } from "../platform/local-vault";

export const TRANSCRIPT_CAVEAT = "Machine transcript may omit or mishear words; check the recording.";
// States that can still change on their own. Everything else is final for this operation.
export const AUDIO_LIVE: readonly AudioState[] = ["recording", "saved_local", "transcription_processing"];
export const AUDIO_SAVED: readonly AudioState[] = ["saved_local", "transcription_processing", "transcribed", "transcription_unavailable", "unknown"];
export function audioFinal(state: AudioState) { return ["transcribed", "transcription_unavailable", "unknown", "failed", "discarded"].includes(state); }
// Status reads are cheap and read-only; back off gently while the recognizer works.
export function audioPollDelay(attempt: number): number { return Math.min(5_000, 1_000 + 500 * attempt); }
export const AUDIO_OBSERVE_MS = 300_000;
export function clock(ms: number): string { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
export function limitText(reason: string | null | undefined): string {
  if (reason === "duration_limit") return "Recording stopped automatically at the 2-minute limit.";
  if (reason === "byte_limit") return "Recording stopped automatically at the 24 MiB size limit.";
  return "";
}
// Honest, specific wording for native failure codes; unknown codes are shown, not hidden.
export function audioProblem(code: string | null | undefined): string {
  switch (code) {
    case "permission_denied": return "Microphone access was denied. Allow Monolith to use the microphone in Windows privacy settings, then record again. Nothing was saved.";
    case "unsupported_device": return "This computer’s microphone format isn’t supported. Monolith records 16-bit audio at 16, 32, 44.1 or 48 kHz, mono or stereo. You can import a WAV file instead. Nothing was saved.";
    case "device_busy": return "The microphone is in use by another app. Close that app and record again.";
    case "device_lost": return "The microphone stopped working or was unplugged during recording.";
    case "queue_overflow": case "capture_gap": return "The computer couldn’t keep up with the microphone, so the recording has gaps.";
    case "stage_write_failed": return "Monolith couldn’t write the recording to this computer’s private storage.";
    case "unfinished_recording": return "Monolith was closed or restarted while recording. What was captured is held privately and is not in your vault yet.";
    case "empty_recording": return "Nothing was recorded.";
    case "finalize_failed": case "commit_failed": return "Monolith couldn’t finish saving this recording to your vault.";
    case "capture_failed": return "The recording was interrupted.";
    default: return code ? `The recording ran into a problem (${code}).` : "";
  }
}
export function transcriptProblem(code: string | null | undefined): string {
  switch (code) {
    case "asr_assets_missing": case "asr_hash_mismatch": return "Monolith’s local speech recognizer is missing or failed its integrity check.";
    case "unsupported_cpu": return "This computer’s processor can’t run the local speech recognizer.";
    case "asr_timeout": return "Transcription took too long and was stopped.";
    // Native reports the first quality flag as the code when recognition finished but its result is not usable.
    case "rms_gate": return "Recognition finished, but the recording was too quiet to find clear speech.";
    case "empty_output": return "Recognition finished, but no words were found in the recording.";
    case "non_speech_annotation": return "Recognition finished, but it only detected background sound, not clear speech.";
    case "no_usable_transcript": return "Recognition finished, but no clear speech was found.";
    case "asr_exit_nonzero": return "The local speech recognizer stopped with an error.";
    case "asr_bad_output": return "The local speech recognizer returned a result Monolith couldn’t trust.";
    case "asr_launch_failed": return "The local speech recognizer couldn’t be started.";
    case "asr_staging_failed": return "Monolith couldn’t prepare the recording for the local speech recognizer.";
    case "asr_error": case "asr_failed": return "The local speech recognizer ran into a problem.";
    case "asr_outcome_unknown": return "Monolith can’t confirm whether transcription finished.";
    case undefined: case null: case "": return "";
    default: return `Transcription didn’t finish (${code}).`;
  }
}
// One line per state; the original recording is always described as safe when it is.
export function audioHeadline(s: AudioOperationStatus): string {
  switch (s.state) {
    case "recording": return "Recording";
    case "saved_local": return "Saved on this computer";
    case "transcription_processing": return "Saved on this computer · transcribing on this computer…";
    case "transcribed": return "Saved on this computer · transcript ready";
    case "transcription_unavailable": return "Saved on this computer · no transcript";
    case "unknown": return "Saved on this computer · transcription status unknown";
    case "recovery_required": return "A recording needs your decision";
    case "failed": return "Recording failed";
    case "discarded": return "Recording discarded";
  }
}

// ---- Voice-note organization (read-only status of the single automatic operation) ----
export const ORG_LIVE: readonly OrganizationOperation["state"][] = ["awaiting_transcript", "queued", "processing"];
const STALE: Record<string, string> = {
  CONSENT_REVOKED: "you turned voice-note organization off",
  CONSENT_EPOCH_CHANGED: "your voice-note organization choice changed",
  CONSENT_CHANGED: "your voice-note organization permission changed",
  CONNECTION_CHANGED: "the private service connection changed",
  SOURCE_OR_CONNECTION_CHANGED: "the recording or the private service connection changed",
  SOURCE_OR_REVISION_CHANGED: "the recording changed",
  TRANSCRIPT_CHANGED: "the transcript changed",
  HUMAN_CORRECTION: "you corrected the transcript",
  INPUT_CHANGED: "the text to organize changed",
  REQUEST_CHANGED: "the prepared request no longer matched the recording",
  NOT_QUEUED: "it was never queued to be sent",
  STATE_CHANGED: "something changed while it was being prepared, so Monolith retired it",
};
const LOCAL: Record<string, string> = {
  TRANSCRIPT_INELIGIBLE: "Monolith found no clear speech to organize, so nothing was sent",
  TRANSCRIPTION_FAILED: "transcription did not complete, so there was nothing to organize",
  INPUT_LIMIT_EXCEEDED: "the transcript is too long to organize (over 30,000 characters or 120,000 bytes)",
  EMPTY_CORRECTION: "your correction is empty, so there is nothing to organize",
  REQUEST_INVALID: "the transcript could not be prepared for organization",
};
const UNKNOWN: Record<string, string> = {
  NOT_DISPATCHED: "Monolith could not confirm whether the transcript text was sent",
  RECEIPT_UNAVAILABLE: "the private service has no receipt for it yet",
  PROVIDER_OUTCOME_UNKNOWN: "the service did not confirm the outcome",
  RECEIPT_INVALID: "the service’s answer could not be trusted, so nothing was added to the note",
  PROMOTION_FAILED: "the result could not be saved to the note",
};
const FAILED: Record<string, string> = {
  INVALID_EXTRACTION: "the service could not produce a valid result", INVALID_JSON: "the service could not produce a valid result", SCHEMA_INVALID: "the service could not produce a valid result",
  PROVIDER_FAILED: "the AI service could not finish", RECEIPT_EXPIRED: "the service result expired before it could be saved",
};
const reason = (table: Record<string, string>, code: string | null) => code ? table[code] ?? `(${code})` : "";
// Plain wording for each state; the recording and transcript are always described as safe, and nothing is called verified.
export function audioOrganizationText(op: OrganizationOperation): { headline: string; detail: string } {
  const why = (table: Record<string, string>) => { const r = reason(table, op.error_code); return r ? ` — ${r}` : ""; };
  switch (op.state) {
    case "awaiting_transcript": return { headline: "Waiting for a usable transcript", detail: "Once there is one, its text is sent to Claude automatically. The recording is never sent." };
    case "queued": case "prepared": return { headline: "Queued for organization", detail: "The transcript text will be sent to Claude automatically. The recording is never sent." };
    case "processing": return { headline: "Organizing the transcript…", detail: "Only the transcript text is sent to Claude; the recording never is." };
    case "unknown": return { headline: `Organization result uncertain${why(UNKNOWN)}`, detail: "Your recording and transcript are safe. Check the result to look up the same request; Monolith will not send it again blindly." };
    case "organized": return { headline: "Organized", detail: "The proposals below are unreviewed machine suggestions, not facts." };
    case "failed": return { headline: `Not organized — the service reported a problem${why(FAILED)}`, detail: "Your recording and transcript are unchanged." };
    case "stale": return { headline: `Not organized — retired without being sent${why(STALE)}`, detail: "Nothing from this request was applied. Your recording and transcript are unchanged." };
    case "saved_local": return { headline: `Saved locally, not organized${why(LOCAL)}`, detail: "Your recording and transcript are kept." };
  }
}
