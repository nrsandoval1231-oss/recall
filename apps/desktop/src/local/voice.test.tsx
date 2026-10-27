// @vitest-environment jsdom
// Synthetic fixtures only: no microphone, recording or transcript here is real user audio.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopEntry } from "../entry";
import { TRANSCRIPT_CAVEAT, transcriptProblem } from "./audio";
import { HistoricalSourceView } from "./AskPanel";
import type { AskOutcome, AudioMachineTranscript, HistoryCitation, AudioOperationStatus, AudioSource, AudioState, LocalVault, VaultMemory, VaultStatus } from "../platform/local-vault";

const selected: VaultStatus = { root: "/synthetic/vault", vault_id: "session-a", vault_identity: "manifest-a" };
const UUID = "00000000-0000-4000-8000-0000000000a1";
const source: AudioSource = { capture_origin: "recorded", original_name: null, media_type: "audio/wav", source_sha256: "hash", source_bytes: 64044, sample_rate_hz: 16000, channels: 1, pcm_bits: 16, duration_ms: 2000 };
const machine: AudioMachineTranscript = { operation_id: "00000000-0000-4000-8000-000000000002", source_sha256: "hash", source_revision: 1, runtime_source_commit: "d1be6fde11ac6e0407606b4e42fe72d34add8037", runtime_binary_sha256: "b".repeat(64), model_sha256: "c".repeat(64), derivative_sha256: "d".repeat(64), transform_version: "pcm16-mono-16khz-rubato-fft-v1", output_sha256: "e".repeat(64), text: "SYNTHETIC remember to call the dentist tomorrow.", segments: null, input_rms_pcm16: 2810.4, quality_flags: [], eligibility: "eligible", quality_state: "machine_unreviewed" };
const base: VaultMemory = { id: UUID, revision: 1, note: "", source_name: "recording.wav", source_sha256: "hash", captured_at: "2026-10-08T12:00:00Z", updated_at: "2026-10-08T12:00:00Z", conflict: null, state: "active", note_path: "recording.md", audio_source: source, audio_transcript: null };
const transcribed: VaultMemory = { ...base, audio_transcript: { machine, human_correction: null } };
const corrected = (text: string, revision = 2): VaultMemory => ({ ...base, revision, audio_transcript: { machine, human_correction: { operation_id: "00000000-0000-4000-8000-000000000003", text, corrected_at: "2026-10-09T12:00:00Z" } } });
function status(state: AudioState, over: Partial<AudioOperationStatus> = {}): AudioOperationStatus { return { schema_version: "1.0", operation_id: UUID, vault_id: "manifest-a", state, memory: null, error_code: null, limit_reason: null, source_sample_rate_hz: 48000, source_channels: 1, ...over }; }
function vault(over: Partial<LocalVault> = {}): LocalVault {
  return {
    available: true, status: vi.fn(async () => selected), select: vi.fn(async () => selected), capture: vi.fn(async () => base), list: vi.fn(async () => [] as VaultMemory[]), rebuild: vi.fn(async () => [] as VaultMemory[]),
    restoreNote: vi.fn(async () => base), remove: vi.fn(async () => base), correct: vi.fn(async () => base),
    source: vi.fn(async () => ({ bytes: [82, 73, 70, 70], mime_type: "audio/wav", sha256: "hash" })),
    history: vi.fn(async () => []), readingCapability: vi.fn(async () => ({ enabled: false, explanation: "Not connected" })), readingOperations: vi.fn(async () => []),
    readPhoto: vi.fn(async () => { throw new Error("Not connected"); }), recoverReading: vi.fn(async () => { throw new Error("Not connected"); }), cancelReading: vi.fn(async () => { throw new Error("No operation"); }), correctReading: vi.fn(async () => base),
    organizationCapability: vi.fn(async () => ({ schema_version: "1.0" as const, scope: "vault_intelligence" as const, purpose: "organize" as const, vault_id: "manifest-a", policy_version: "organize-v1|synthetic", provider: "anthropic" as const, consent: "missing" as const, enabled: false, consent_epoch: 0, decided_at: null, local_readiness: "off" as const, automatic_enabled: false })),
    ...over,
  };
}
const mount = (v: LocalVault) => render(<DesktopEntry vault={v} search="" />);
const intentKey = `recall.local.audio:${JSON.stringify([selected.root, selected.vault_identity])}`;
// Waits until the button exists and is enabled, so a click can never land on a still-busy control.
async function press(name: string | RegExp) { const button = await screen.findByRole("button", { name }) as HTMLButtonElement; await waitFor(() => expect(button.disabled).toBe(false)); await userEvent.click(button); }
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { localStorage.clear(); URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("records, stops, shows the save immediately, then only reads status until the transcript arrives", async () => {
  let current: AudioOperationStatus = status("recording");
  const audioStart = vi.fn(async (_v: string, op: string) => (current = status("recording", { operation_id: op })));
  const audioStop = vi.fn(async (_v: string, op: string) => { current = status("transcription_processing", { operation_id: op, memory: base }); return status("saved_local", { operation_id: op, memory: base }); });
  const audioStatus = vi.fn(async () => current);
  const audioRecover = vi.fn(async () => status("failed"));
  const v = vault({ audioStart, audioStop, audioStatus, audioRecover, list: vi.fn(async () => [transcribed]) }); mount(v);
  await press("Record");
  expect(await screen.findByRole("button", { name: "Stop & save" })).toBe(document.activeElement);
  expect(audioStart).toHaveBeenCalledWith("session-a", expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(screen.getByRole("timer").textContent).toBe("0:00");
  expect(screen.queryByRole("button", { name: /Save recording|Discard/ })).toBeNull();
  await press("Stop & save");
  expect(await screen.findByText("Saved on this computer", { exact: true })).toBeTruthy();
  expect(audioStop).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(vi.mocked(v.list).mock.calls.length).toBeGreaterThan(1));
  current = status("transcribed", { memory: transcribed });
  await tick(1_100);
  expect(await screen.findByText("Saved on this computer · transcript ready")).toBeTruthy();
  // Status is read-only: no second start, stop or recovery was ever sent.
  expect(audioStart).toHaveBeenCalledTimes(1); expect(audioStop).toHaveBeenCalledTimes(1); expect(audioRecover).not.toHaveBeenCalled();
  expect(localStorage.getItem(intentKey)).toBeNull();
  await press("Open recording");
  expect(await screen.findByRole("heading", { level: 1, name: "Voice recording" })).toBeTruthy();
  expect(screen.getByText("Machine transcript · unreviewed")).toBeTruthy();
  expect(screen.getByText(machine.text)).toBeTruthy();
  expect(screen.getByText(TRANSCRIPT_CAVEAT).closest("details")).not.toBeNull();
  // Audio is not organized, read as a photo, or annotated through the note editor in this packet.
  expect(screen.queryByText(/AI suggestion/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Read this photo/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Correct note" })).toBeNull();
  await waitFor(() => expect(document.querySelector("audio")?.getAttribute("src")).toBe("blob:synthetic"));
});

it("ignores a double click and reuses the same operation ID when a start could not be confirmed", async () => {
  const audioStart = vi.fn().mockRejectedValueOnce(new Error("Native bridge interrupted")).mockImplementation(async (_v: string, op: string) => status("recording", { operation_id: op }));
  mount(vault({ audioStart, audioStop: vi.fn(), audioStatus: vi.fn(async () => status("recording")) }));
  const button = await screen.findByRole("button", { name: "Record" });
  fireEvent.click(button); fireEvent.click(button);
  expect((await screen.findByRole("alert")).textContent).toContain("Native bridge interrupted");
  expect(audioStart).toHaveBeenCalledTimes(1);
  await press("Record again");
  await screen.findByRole("button", { name: "Stop & save" });
  expect(audioStart.mock.calls[1]?.[1]).toBe(audioStart.mock.calls[0]?.[1]);
});

it.each([
  ["permission_denied", /Microphone access was denied/],
  ["unsupported_device", /microphone format isn’t supported/],
  ["device_busy", /in use by another app/],
] as const)("explains %s truthfully, saves nothing and starts the next recording fresh", async (code, text) => {
  const audioStart = vi.fn(async (_v: string, op: string) => status("failed", { operation_id: op, error_code: code }));
  mount(vault({ audioStart, audioStop: vi.fn(), audioStatus: vi.fn(), importWav: vi.fn(async () => null) }));
  await press("Record");
  expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
  expect(screen.getByText(/Nothing was saved\./)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Import WAV" })).toBeTruthy();
  await press("Record");
  await waitFor(() => expect(audioStart).toHaveBeenCalledTimes(2));
  expect(audioStart.mock.calls[1]?.[1]).not.toBe(audioStart.mock.calls[0]?.[1]);
});

it("handles the automatic 2-minute stop without a Stop request and names the limit", async () => {
  let current: AudioOperationStatus = status("recording");
  const audioStop = vi.fn();
  mount(vault({ audioStart: vi.fn(async () => current), audioStop, audioStatus: vi.fn(async () => current), list: vi.fn(async () => [base]) }));
  await press("Record");
  await screen.findByRole("button", { name: "Stop & save" });
  current = status("transcription_processing", { memory: base, limit_reason: "duration_limit" });
  await tick(1_100);
  expect(await screen.findByText("Recording stopped automatically at the 2-minute limit.")).toBeTruthy();
  expect(screen.getByText("Saved on this computer · transcribing on this computer…")).toBeTruthy();
  expect(audioStop).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Stop & save" })).toBeNull();
});

it("offers Save or Discard only for recovery_required, confirms discard, and keeps evidence otherwise", async () => {
  localStorage.setItem(intentKey, JSON.stringify({ operationId: UUID, kind: "record", startedAt: 1 }));
  let current = status("recovery_required", { error_code: "unfinished_recording" });
  const audioRecover = vi.fn(async (_v: string, _op: string, action: "save" | "discard") => (current = action === "discard" ? status("discarded") : status("saved_local", { memory: base })));
  mount(vault({ audioStart: vi.fn(), audioStop: vi.fn(), audioStatus: vi.fn(async () => current), audioRecover }));
  expect(await screen.findByText(/closed or restarted while recording/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Record" }) as HTMLButtonElement).disabled).toBe(true);
  await press("Discard recording");
  expect(audioRecover).not.toHaveBeenCalled();
  await press("Keep it for now");
  await press("Discard recording");
  await press("Yes, discard this audio");
  expect(audioRecover).toHaveBeenCalledWith("session-a", UUID, "discard");
  expect(await screen.findByText("Recording discarded")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Save recording|Discard recording/ })).toBeNull();
  expect(localStorage.getItem(intentKey)).toBeNull();
});

it("saves a recovered recording with the same operation and then offers no recovery action", async () => {
  localStorage.setItem(intentKey, JSON.stringify({ operationId: UUID, kind: "record", startedAt: 1 }));
  let current = status("recovery_required", { error_code: "device_lost" });
  const audioRecover = vi.fn(async () => (current = status("saved_local", { memory: base })));
  mount(vault({ audioStart: vi.fn(), audioStop: vi.fn(), audioStatus: vi.fn(async () => current), audioRecover, list: vi.fn(async () => [base]) }));
  expect(await screen.findByText(/microphone stopped working or was unplugged/)).toBeTruthy();
  await press("Save recording");
  expect(await screen.findByText("Saved on this computer", { exact: true })).toBeTruthy();
  expect(audioRecover).toHaveBeenCalledTimes(1); expect(audioRecover).toHaveBeenCalledWith("session-a", UUID, "save");
  expect(screen.queryByRole("button", { name: /Save recording|Discard recording/ })).toBeNull();
});

it("stops polling at unknown, never restarts work, and checks again only when asked", async () => {
  let current: AudioOperationStatus = status("transcription_processing", { memory: base });
  const audioStatus = vi.fn(async () => current);
  const audioStop = vi.fn(async () => status("saved_local", { memory: base }));
  const audioStart = vi.fn(async () => status("recording"));
  const audioRecover = vi.fn();
  mount(vault({ audioStart, audioStop, audioStatus, audioRecover, list: vi.fn(async () => [base]) }));
  await press("Record");
  await press("Stop & save");
  await screen.findByText("Saved on this computer", { exact: true });
  current = status("unknown", { memory: base, error_code: "asr_outcome_unknown" });
  await tick(1_100);
  expect(await screen.findByText("Saved on this computer · transcription status unknown")).toBeTruthy();
  expect(screen.getByText(/won’t start it again automatically/)).toBeTruthy();
  const calls = audioStatus.mock.calls.length;
  await tick(30_000);
  expect(audioStatus.mock.calls.length).toBe(calls);
  await press("Check status");
  await waitFor(() => expect(audioStatus.mock.calls.length).toBe(calls + 1));
  expect(audioStart).toHaveBeenCalledTimes(1); expect(audioStop).toHaveBeenCalledTimes(1); expect(audioRecover).not.toHaveBeenCalled();
});

it("keeps the original playable when transcription is unavailable and says why", async () => {
  const audioStatus = vi.fn(async () => status("transcription_unavailable", { memory: base, error_code: "asr_assets_missing" }));
  const v = vault({ audioStart: vi.fn(async () => status("recording")), audioStop: vi.fn(async () => status("saved_local", { memory: base })), audioStatus, list: vi.fn(async () => [base]) }); mount(v);
  await press("Record");
  await press("Stop & save");
  await tick(1_100);
  expect(await screen.findByText(/speech recognizer is missing or failed its integrity check\. Your original recording is saved/)).toBeTruthy();
  await press("Open recording");
  expect(await screen.findByText(/Your original recording is saved and playable above/)).toBeTruthy();
  await waitFor(() => expect(document.querySelector("audio")).not.toBeNull());
  expect(v.source).toHaveBeenCalledWith("session-a", UUID);
  expect(screen.queryByRole("button", { name: "Correct transcript" })).toBeNull();
});

it("revokes the playback Blob URL when the memory closes and refuses a mismatched original", async () => {
  const v = vault({ list: vi.fn(async () => [transcribed]) }); const view = mount(v);
  await press(/Voice recording/);
  await waitFor(() => expect(document.querySelector("audio")).not.toBeNull());
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  await press("Back to memories");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
  view.unmount(); cleanup();
  const bad = vault({ list: vi.fn(async () => [transcribed]), source: vi.fn(async () => ({ bytes: [1], mime_type: "audio/wav", sha256: "other" })) }); mount(bad);
  await press(/Voice recording/);
  expect((await screen.findAllByText(/Original recording unavailable: The recording’s hash no longer matches/)).length).toBeGreaterThan(0);
  expect(document.querySelector("audio")).toBeNull();
});

it("does not display an ineligible machine result as a transcript", async () => {
  const empty: VaultMemory = { ...base, audio_transcript: { machine: { ...machine, text: "[BLANK_AUDIO]", eligibility: "ineligible", quality_flags: ["near_zero_input"] }, human_correction: null } };
  mount(vault({ list: vi.fn(async () => [empty]), audioCorrect: vi.fn() }));
  await press(/Voice recording/);
  expect(await screen.findByText("No usable transcript")).toBeTruthy();
  expect(screen.queryByText("[BLANK_AUDIO]")).toBeNull();
  expect(screen.getByText(/Quality notes: near_zero_input/)).toBeTruthy();
  // The human can still type what they hear; that wording then becomes the current transcript.
  expect(screen.getByRole("button", { name: "Correct transcript" })).toBeTruthy();
});

it("corrects a transcript with an expected revision, survives a stale-revision conflict, and keeps the machine reading", async () => {
  const external: VaultMemory = { ...transcribed, revision: 2 };
  const audioCorrect = vi.fn()
    .mockRejectedValueOnce(new Error("Conflict: the recording changed. Refresh, review it, then retry your correction"))
    .mockResolvedValueOnce(corrected("Call the dentist at 3 pm.", 3));
  const list = vi.fn(async () => [transcribed]);
  mount(vault({ list, audioCorrect, audioStatus: vi.fn(), audioStart: vi.fn(), audioStop: vi.fn() }));
  await press(/Voice recording/);
  await press("Correct transcript");
  const box = screen.getByLabelText("Your transcript correction") as HTMLTextAreaElement;
  expect(box.value).toBe(machine.text);
  await userEvent.clear(box); await userEvent.type(box, "Call the dentist at 3 pm.");
  await press("Save correction");
  expect((await screen.findByRole("alert")).textContent).toContain("Conflict: the recording changed");
  expect(audioCorrect).toHaveBeenLastCalledWith("session-a", UUID, 1, expect.stringMatching(/^[0-9a-f-]{36}$/), "Call the dentist at 3 pm.");
  expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
  list.mockImplementation(async () => [external]);
  await press("Reload latest transcript");
  expect(await screen.findByText("Current transcript · revision 2")).toBeTruthy();
  await userEvent.click(screen.getByLabelText("I reviewed the latest transcript"));
  await press("Save correction");
  expect(await screen.findByText("Your corrected transcript")).toBeTruthy();
  expect(audioCorrect).toHaveBeenCalledTimes(2);
  expect(audioCorrect.mock.calls[1]?.[2]).toBe(2);
  expect(audioCorrect.mock.calls[1]?.[3]).not.toBe(audioCorrect.mock.calls[0]?.[3]);
  expect(screen.getByText("Call the dentist at 3 pm.")).toBeTruthy();
  expect(screen.getByText("Machine transcript kept in history · unreviewed")).toBeTruthy();
});

it("shows audio citations as unreviewed or reported and opens the verified original recording", async () => {
  const citation = (id: string, kind: "machine_audio_transcript" | "human_audio_correction") => ({ citation_id: id, memory_id: UUID, memory_revision: 1, source_sha256: "hash", evidence_kind: kind, quote: "SYNTHETIC dentist" });
  const outcome = (operationId: string): AskOutcome => ({ operation: { operation_id: operationId, state: "complete", error_code: null }, answer: { status: "answered", sentences: [{ text: "A dentist call was mentioned.", citation_ids: ["c1", "c2"] }], citations: [citation("c1", "machine_audio_transcript"), citation("c2", "human_audio_correction")], limitations: [], coverage: { eligible_count: 1, selected_count: 1, limited: false, truncated_count: 0 } } });
  const v = vault({ list: vi.fn(async () => [transcribed]), askCapability: vi.fn(async () => ({ enabled: true, scope: "vault_intelligence" as const, consent: "active" as const, explanation: "Ready" })), ask: vi.fn(async (_v: string, op: string) => outcome(op)) }); mount(v);
  await userEvent.type(await screen.findByLabelText("Your question"), "Who did I plan to call?"); await press("Ask");
  expect(await screen.findByRole("button", { name: "Source 2 · Your transcript correction · reported" })).toBeTruthy();
  await press("Source 1 · Machine transcript · unreviewed");
  expect((await screen.findByLabelText("Cited source")).textContent).toContain("machine transcript · unreviewed");
  await waitFor(() => expect(document.querySelector("audio")?.getAttribute("src")).toBe("blob:synthetic"));
  expect(v.source).toHaveBeenCalledWith("session-a", UUID);
});

it("imports one WAV with a stable retry ID, treats cancel as nothing saved, and resumes status", async () => {
  const importWav = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Temporary vault interruption")).mockResolvedValue(base);
  const audioStatus = vi.fn(async () => status("transcription_processing", { memory: base }));
  mount(vault({ importWav, audioStart: vi.fn(), audioStop: vi.fn(), audioStatus, list: vi.fn(async () => [base]) }));
  await press("Import WAV");
  expect((await screen.findByText(/WAV selection cancelled\. Nothing was saved\./)).textContent).toBeTruthy();
  await press("Import WAV");
  expect((await screen.findByRole("alert")).textContent).toContain("can’t create a duplicate");
  expect(localStorage.getItem(intentKey)).toContain(importWav.mock.calls[1]?.[1]);
  await press("Retry WAV import");
  expect(await screen.findByText("Saved on this computer · transcribing on this computer…")).toBeTruthy();
  expect(importWav).toHaveBeenCalledTimes(3);
  expect(importWav.mock.calls[2]?.[1]).toBe(importWav.mock.calls[1]?.[1]);
  expect(importWav.mock.calls[1]?.[1]).not.toBe(importWav.mock.calls[0]?.[1]);
  expect(localStorage.getItem(intentKey)).toBeNull();
});

it("resumes a recording that outlived the view from its stored operation ID", async () => {
  localStorage.setItem(intentKey, JSON.stringify({ operationId: UUID, kind: "record", startedAt: Date.now() - 65_000 }));
  mount(vault({ audioStart: vi.fn(), audioStop: vi.fn(async () => status("saved_local", { memory: base })), audioStatus: vi.fn(async () => status("recording")) }));
  expect(await screen.findByRole("button", { name: "Stop & save" })).toBeTruthy();
  expect(screen.getByRole("timer").textContent).toMatch(/^1:0\d$/);
});

it("starts a fresh recording with a new operation ID while the previous clip is still being transcribed", async () => {
  let current: AudioOperationStatus = status("recording");
  const audioStart = vi.fn(async (_v: string, op: string) => (current = status("recording", { operation_id: op })));
  const audioStop = vi.fn(async (_v: string, op: string) => { current = status("transcription_processing", { operation_id: op, memory: base }); return status("saved_local", { operation_id: op, memory: base }); });
  mount(vault({ audioStart, audioStop, audioStatus: vi.fn(async () => current), list: vi.fn(async () => [base]) }));
  await press("Record"); await press("Stop & save");
  expect(await screen.findByText("Saved on this computer", { exact: true })).toBeTruthy();
  await press("Record");
  await screen.findByRole("button", { name: "Stop & save" });
  expect(audioStart).toHaveBeenCalledTimes(2);
  expect(audioStart.mock.calls[1]?.[1]).not.toBe(audioStart.mock.calls[0]?.[1]);
});

it("lets the user abandon a stored recording ID whose status cannot be read, keeping native evidence", async () => {
  localStorage.setItem(intentKey, JSON.stringify({ operationId: UUID, kind: "record", startedAt: 1 }));
  const audioStart = vi.fn(async (_v: string, op: string) => status("recording", { operation_id: op }));
  const audioStatus = vi.fn().mockRejectedValueOnce(new Error("Native bridge unavailable")).mockImplementation(async () => status("recording"));
  mount(vault({ audioStart, audioStop: vi.fn(), audioStatus }));
  expect((await screen.findByRole("alert")).textContent).toContain("Native bridge unavailable");
  expect(audioStart).not.toHaveBeenCalled();
  await press("Start a new recording");
  await screen.findByRole("button", { name: "Stop & save" });
  expect(audioStart).toHaveBeenCalledTimes(1);
  expect(audioStart.mock.calls[0]?.[1]).not.toBe(UUID);
  expect(localStorage.getItem(intentKey)).not.toContain(UUID);
});

it("ignores a stored operation ID that is not lowercase, as native requires", async () => {
  localStorage.setItem(intentKey, JSON.stringify({ operationId: UUID.toUpperCase(), kind: "record", startedAt: 1 }));
  const audioStatus = vi.fn();
  mount(vault({ audioStart: vi.fn(), audioStop: vi.fn(), audioStatus }));
  expect(((await screen.findByRole("button", { name: "Record" })) as HTMLButtonElement).disabled).toBe(false);
  expect(audioStatus).not.toHaveBeenCalled();
});

it("keeps a Stop failure visible while background status reads continue", async () => {
  const audioStatus = vi.fn(async () => status("recording"));
  mount(vault({ audioStart: vi.fn(async () => status("recording")), audioStop: vi.fn(async () => { throw new Error("Stop bridge dropped"); }), audioStatus }));
  await press("Record"); await press("Stop & save");
  expect((await screen.findByRole("alert")).textContent).toContain("Stop bridge dropped");
  const calls = audioStatus.mock.calls.length;
  await tick(3_200);
  expect(audioStatus.mock.calls.length).toBeGreaterThan(calls);
  expect(screen.getByRole("alert").textContent).toContain("Stop bridge dropped");
});

it.each([
  ["rms_gate", /too quiet/], ["empty_output", /no words were found/], ["non_speech_annotation", /background sound/],
  ["asr_exit_nonzero", /stopped with an error/], ["asr_bad_output", /couldn’t trust/], ["asr_launch_failed", /couldn’t be started/],
  ["asr_staging_failed", /couldn’t prepare/], ["asr_error", /ran into a problem/], ["asr_failed", /ran into a problem/],
] as const)("explains the %s transcription outcome in plain words", (code, text) => {
  const sentence = transcriptProblem(code);
  expect(sentence).toMatch(text); expect(sentence).not.toContain(code);
  if (code === "rms_gate" || code === "empty_output" || code === "non_speech_annotation") { expect(sentence).toMatch(/^Recognition finished/); expect(sentence).not.toMatch(/didn’t finish/); }
  expect(transcriptProblem("brand_new_code")).toContain("(brand_new_code)");
});

it("tells the user recognition finished but found no clear speech, with the original still playable", async () => {
  const audioStatus = vi.fn(async () => status("transcription_unavailable", { memory: base, error_code: "rms_gate" }));
  mount(vault({ audioStart: vi.fn(async () => status("recording")), audioStop: vi.fn(async () => status("saved_local", { memory: base })), audioStatus, list: vi.fn(async () => [base]) }));
  await press("Record"); await press("Stop & save"); await tick(1_100);
  expect(await screen.findByText(/Recognition finished, but the recording was too quiet to find clear speech\. Your original recording is saved/)).toBeTruthy();
});

it("shows a direct Obsidian annotation as the user’s own text, and uses audio wording for removal", async () => {
  const annotated: VaultMemory = { ...transcribed, note: "SYNTHETIC garden idea" };
  mount(vault({ list: vi.fn(async () => [annotated]) }));
  await press(/Voice recording/);
  expect(await screen.findByRole("heading", { name: "Your annotation" })).toBeTruthy();
  expect(screen.getByText("SYNTHETIC garden idea")).toBeTruthy();
  await press("Remove from Monolith");
  const confirm = await screen.findByLabelText("Confirm removal");
  expect(confirm.textContent).toMatch(/original recording, transcripts/); expect(confirm.textContent).not.toMatch(/photo/i);
  expect(document.body.textContent).not.toMatch(/saved photo readings/);
});

it("omits the annotation section without human text and shows the correction time readably", async () => {
  mount(vault({ list: vi.fn(async () => [corrected("Water the seedlings.")]) }));
  await press(/Voice recording/);
  expect(await screen.findByRole("heading", { name: "Your corrected transcript" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Your annotation" })).toBeNull();
  const time = document.querySelector("time")!;
  expect(time.getAttribute("datetime")).toBe("2026-10-09T12:00:00Z"); expect(time.getAttribute("title")).toBe("2026-10-09T12:00:00Z");
  expect(time.textContent).not.toContain("T12:00:00Z");
});

function retainedSource(audio_transcript: VaultMemory["audio_transcript"]): HistoryCitation {
  return { memory_id: UUID, revision: 2, event_sha256: "a".repeat(64), source_sha256: "hash", current_revision: 3, current: false, quote: "SYNTHETIC dentist", retained_revision: { revision: 2, note: "", recorded_at: "2026-10-09T12:00:00Z", origin: "human:recall", kind: "audio_transcript_correction", audio_transcript }, original: { bytes: [82, 73, 70, 70], mime_type: "audio/wav", sha256: "hash" } };
}
it("shows the retained transcript of an audio citation with audio wording, a .wav download and the original recording", () => {
  const view = render(<HistoricalSourceView source={retainedSource({ machine, human_correction: { operation_id: "00000000-0000-4000-8000-000000000003", text: "SYNTHETIC human wording", corrected_at: "2026-10-09T12:00:00Z" } })} onClose={() => {}} />);
  expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/^Saved recording/);
  expect(screen.getByText("Your transcript correction · reported")).toBeTruthy(); expect(screen.getByText("SYNTHETIC human wording")).toBeTruthy();
  expect(view.container.textContent).not.toMatch(/photo reading|saved note or photo/i);
  expect(view.container.querySelector("audio")).not.toBeNull();
  expect(view.container.querySelector("a")?.getAttribute("download")).toBe(`monolith-original-${UUID}.wav`);
  view.unmount();
  const machineOnly = render(<HistoricalSourceView source={retainedSource({ machine, human_correction: null })} onClose={() => {}} />);
  expect(screen.getByText("Machine transcript · unreviewed")).toBeTruthy(); expect(screen.getByText(machine.text)).toBeTruthy(); expect(screen.getByText(TRANSCRIPT_CAVEAT)).toBeTruthy();
  machineOnly.unmount();
  const ineligible = render(<HistoricalSourceView source={retainedSource({ machine: { ...machine, text: "[BLANK_AUDIO]", eligibility: "ineligible" }, human_correction: null })} onClose={() => {}} />);
  expect(screen.queryByText("[BLANK_AUDIO]")).toBeNull(); expect(screen.getByText(/No usable transcript had been saved/)).toBeTruthy();
  ineligible.unmount();
});
