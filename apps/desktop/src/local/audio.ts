import type { AudioOperationStatus, AudioState } from "../platform/local-vault";

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
    case "permission_denied": return "Microphone access was denied. Allow Recall to use the microphone in Windows privacy settings, then record again. Nothing was saved.";
    case "unsupported_device": return "This computer’s microphone format isn’t supported. Recall records 16-bit audio at 16, 32, 44.1 or 48 kHz, mono or stereo. You can import a WAV file instead. Nothing was saved.";
    case "device_busy": return "The microphone is in use by another app. Close that app and record again.";
    case "device_lost": return "The microphone stopped working or was unplugged during recording.";
    case "queue_overflow": case "capture_gap": return "The computer couldn’t keep up with the microphone, so the recording has gaps.";
    case "stage_write_failed": return "Recall couldn’t write the recording to this computer’s private storage.";
    case "unfinished_recording": return "Recall was closed or restarted while recording. What was captured is held privately and is not in your vault yet.";
    case "empty_recording": return "Nothing was recorded.";
    case "finalize_failed": case "commit_failed": return "Recall couldn’t finish saving this recording to your vault.";
    case "capture_failed": return "The recording was interrupted.";
    default: return code ? `The recording ran into a problem (${code}).` : "";
  }
}
export function transcriptProblem(code: string | null | undefined): string {
  switch (code) {
    case "asr_assets_missing": case "asr_hash_mismatch": return "Recall’s local speech recognizer is missing or failed its integrity check.";
    case "unsupported_cpu": return "This computer’s processor can’t run the local speech recognizer.";
    case "asr_timeout": return "Transcription took too long and was stopped.";
    // Native reports the first quality flag as the code when recognition finished but its result is not usable.
    case "rms_gate": return "Recognition finished, but the recording was too quiet to find clear speech.";
    case "empty_output": return "Recognition finished, but no words were found in the recording.";
    case "non_speech_annotation": return "Recognition finished, but it only detected background sound, not clear speech.";
    case "no_usable_transcript": return "Recognition finished, but no clear speech was found.";
    case "asr_exit_nonzero": return "The local speech recognizer stopped with an error.";
    case "asr_bad_output": return "The local speech recognizer returned a result Recall couldn’t trust.";
    case "asr_launch_failed": return "The local speech recognizer couldn’t be started.";
    case "asr_staging_failed": return "Recall couldn’t prepare the recording for the local speech recognizer.";
    case "asr_error": case "asr_failed": return "The local speech recognizer ran into a problem.";
    case "asr_outcome_unknown": return "Recall can’t confirm whether transcription finished.";
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
