// @vitest-environment jsdom
// Synthetic fixtures only: no real recording, transcript or provider output.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopEntry } from "../entry";
import { HistoricalSourceView } from "./AskPanel";
import { audioOrganizationText } from "./audio";
import type { AudioMachineTranscript, AudioOrganizationCapability, AudioSource, HistoryCitation, LocalVault, OrganizationOperation, OrganizationProposal, VaultMemory, VaultStatus } from "../platform/local-vault";

const selected: VaultStatus = { root: "/synthetic/vault", vault_id: "session-a", vault_identity: "manifest-a" };
const UUID = "00000000-0000-4000-8000-0000000000a1";
const OP = "00000000-0000-4000-8000-0000000000b1";
const source: AudioSource = { capture_origin: "recorded", original_name: null, media_type: "audio/wav", source_sha256: "hash", source_bytes: 64044, sample_rate_hz: 16000, channels: 1, pcm_bits: 16, duration_ms: 2000 };
const machine: AudioMachineTranscript = { operation_id: "00000000-0000-4000-8000-000000000002", source_sha256: "hash", source_revision: 1, runtime_source_commit: "d1be6fde11ac6e0407606b4e42fe72d34add8037", runtime_binary_sha256: "b".repeat(64), model_sha256: "c".repeat(64), derivative_sha256: "d".repeat(64), transform_version: "pcm16-mono-16khz-rubato-fft-v1", output_sha256: "e".repeat(64), text: "SYNTHETIC remember to call the dentist tomorrow.", segments: null, input_rms_pcm16: 2810.4, quality_flags: [], eligibility: "eligible", quality_state: "machine_unreviewed" };
function proposal(over: { suppressed?: boolean; kind?: "machine_unreviewed" | "human_corrected" } = {}): OrganizationProposal {
  const evidence = [{ page_id: UUID, quote: "call the dentist" }];
  return { binding: { schema_version: "3.0", operation_id: OP, vault_id: "manifest-a", memory_id: UUID, source_kind: "audio_transcript", source_sha256: "hash", expected_revision: 2, input_sha256: "i".repeat(64), derivative_sha256: "d".repeat(64), transcript_revision: 2, transcript_evidence_kind: over.kind ?? "machine_unreviewed", consent_epoch: 1, captured_at: "2026-10-22T12:00:00Z" }, media_type: "text/plain; charset=utf-8", payload_sha256: "p".repeat(64),
    result: { provider: "anthropic", model_id: "synthetic-model", input_manifest_sha256: "m".repeat(64), extraction: { summary: "SYNTHETIC reminder to phone the dentist", summary_evidence: evidence, pages: [{ page_id: UUID, ordinal: 1, transcription: machine.text, legibility: "mixed" }], mentions: [{ kind: "person", raw_text: "SYNTHETIC the dentist", evidence }], statements: [{ epistemic_state: "reported", text: "SYNTHETIC call tomorrow at three", evidence }], action_suggestions: [{ kind: "reminder", text: "SYNTHETIC call the dentist", evidence }], uncertainties: [{ kind: "unknown", description: "SYNTHETIC which dentist is unclear", evidence }] }, validation_notes: [], review_state: "unreviewed" }, review_state: "unreviewed", suppressed: over.suppressed ?? false };
}
const base: VaultMemory = { id: UUID, revision: 2, note: "", source_name: "recording.wav", source_sha256: "hash", captured_at: "2026-10-22T12:00:00Z", updated_at: "2026-10-22T12:00:00Z", conflict: null, state: "active", note_path: "recording.md", audio_source: source, audio_transcript: { machine, human_correction: null }, audio_organization: null };
const cap = (over: Partial<AudioOrganizationCapability> = {}): AudioOrganizationCapability => ({ schema_version: "1.0", scope: "vault_intelligence", purpose: "organize_audio", vault_id: "manifest-a", policy_version: "organize-audio-v1|synthetic", provider: "anthropic", consent: "missing", enabled: false, consent_epoch: 0, decided_at: null, local_readiness: "off", automatic_enabled: false, ...over });
const operation = (state: OrganizationOperation["state"], error_code: string | null = null): OrganizationOperation => ({ operation_id: OP, memory_id: UUID, state, error_code });
function vault(over: Partial<LocalVault> = {}): LocalVault {
  return {
    available: true, status: vi.fn(async () => selected), select: vi.fn(async () => selected), capture: vi.fn(async () => base), list: vi.fn(async () => [base]), rebuild: vi.fn(async () => [base]),
    restoreNote: vi.fn(async () => base), remove: vi.fn(async () => base), correct: vi.fn(async () => base),
    source: vi.fn(async () => ({ bytes: [82, 73, 70, 70], mime_type: "audio/wav", sha256: "hash" })),
    history: vi.fn(async () => []), readingCapability: vi.fn(async () => ({ enabled: false, explanation: "Not connected" })), readingOperations: vi.fn(async () => []),
    readPhoto: vi.fn(async () => { throw new Error("Not connected"); }), recoverReading: vi.fn(async () => { throw new Error("Not connected"); }), cancelReading: vi.fn(async () => { throw new Error("No operation"); }), correctReading: vi.fn(async () => base),
    organizationCapability: vi.fn(async () => ({ schema_version: "1.0" as const, scope: "vault_intelligence" as const, purpose: "organize" as const, vault_id: "manifest-a", policy_version: "organize-v1|synthetic", provider: "anthropic" as const, consent: "missing" as const, enabled: false, consent_epoch: 0, decided_at: null, local_readiness: "off" as const, automatic_enabled: false })),
    setOrganizationConsent: vi.fn(), reconcileOrganizationConsent: vi.fn(),
    ...over,
  };
}
const mount = (v: LocalVault) => render(<DesktopEntry vault={v} search="" />);
async function press(name: string | RegExp) { const button = await screen.findByRole("button", { name }) as HTMLButtonElement; await waitFor(() => expect(button.disabled).toBe(false)); await userEvent.click(button); }
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const openAudioSettings = async () => { const summary = await screen.findByText("Organize voice notes automatically", { exact: true }); await userEvent.click(summary); return summary.closest("details") as HTMLDetailsElement; };
async function openMemory(v: LocalVault) { mount(v); await press(/Voice recording/); await screen.findByRole("heading", { level: 1, name: "Voice recording" }); }

beforeEach(() => { localStorage.clear(); URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("renders no voice control when the adapter lacks the audio organization commands", async () => {
  mount(vault());
  await screen.findByText("Automatically organize new notes and photos", { exact: true });
  expect(screen.queryByText("Organize voice notes automatically")).toBeNull();
});

it("discloses that only future transcript text is sent, never the recording, and that the choice is remembered and revocable", async () => {
  mount(vault({ audioOrganizationCapability: vi.fn(async () => cap()), setAudioOrganizationConsent: vi.fn(), reconcileAudioOrganizationConsent: vi.fn() }));
  const details = await openAudioSettings();
  const copy = details.textContent ?? "";
  expect(copy).toMatch(/transcript text of voice notes you record or import from then on is sent, via your private Recall service, to Anthropic Claude/);
  expect(copy).toMatch(/The recording or audio file itself is never sent/);
  expect(copy).toMatch(/Recordings and imported audio you already have are not affected/);
  expect(copy).toMatch(/remembered until you turn it off/);
  expect(copy).toMatch(/needs the private service connection/);
  expect(copy).toMatch(/unreviewed machine proposals, not facts/);
});

it.each([
  ["off", { consent: "missing", local_readiness: "off" }, /Voice-note organization is off\. New voice notes stay local\./, { on: true, off: false }],
  ["off without a provider", { provider: null }, /No organization provider is configured, so voice notes stay local\./, { on: false, off: false }],
  ["needs setup", { consent: "active", enabled: true, consent_epoch: 1, local_readiness: "needs_setup" }, /Finish setup on this device before new voice notes can be organized/, { on: false, off: true, extra: "Finish voice setup" }],
  ["ready", { consent: "active", enabled: true, consent_epoch: 1, local_readiness: "ready", automatic_enabled: true }, /Voice-note organization is on with Anthropic Claude\. Only the transcript text of voice notes you record or import from now on is sent\./, { on: false, off: true }],
  ["unknown", { consent: "active", enabled: true, consent_epoch: 1, local_readiness: "unknown" }, /setup status is unknown\. New voice notes stay local until you check again/, { on: false, off: true, extra: "Check voice setup again" }],
  ["unavailable", { consent: "active", enabled: false, consent_epoch: 1, local_readiness: "ready" }, /voice organization is unavailable right now.*private service connection is missing.*You can still turn it off/, { on: false, off: true }],
  ["outdated", { consent: "outdated", enabled: false, consent_epoch: 2 }, /previous permission no longer applies/, { on: true, off: false }],
] as const)("shows the %s voice-organization state with matching actions", async (_name, over, text, expected) => {
  mount(vault({ audioOrganizationCapability: vi.fn(async () => cap(over as Partial<AudioOrganizationCapability>)), setAudioOrganizationConsent: vi.fn(), reconcileAudioOrganizationConsent: vi.fn() }));
  const details = await openAudioSettings();
  await waitFor(() => expect(details.textContent).toMatch(text));
  expect((screen.getByRole("button", { name: "Turn on voice organization" }) as HTMLButtonElement).disabled).toBe(!expected.on);
  expect((screen.getByRole("button", { name: "Turn off voice organization" }) as HTMLButtonElement).disabled).toBe(!expected.off);
  if ("extra" in expected) expect(screen.getByRole("button", { name: expected.extra })).toBeTruthy();
});

it("keeps voice consent independent: turning it on and off sends the audio epoch and never touches the text/photo control", async () => {
  const set = vi.fn(async (_v: string, enabled: boolean, epoch: number) => cap(enabled ? { consent: "active", enabled: true, consent_epoch: epoch + 1, local_readiness: "ready", automatic_enabled: true } : { consent_epoch: epoch + 1 }));
  const v = vault({ audioOrganizationCapability: vi.fn(async () => cap()), setAudioOrganizationConsent: set, reconcileAudioOrganizationConsent: vi.fn() });
  mount(v);
  const details = await openAudioSettings();
  await press("Turn on voice organization");
  await waitFor(() => expect(details.textContent).toMatch(/Voice-note organization is on/));
  expect(set).toHaveBeenLastCalledWith("session-a", true, 0);
  await press("Turn off voice organization");
  await waitFor(() => expect(details.textContent).toMatch(/Voice-note organization is off/));
  expect(set).toHaveBeenLastCalledWith("session-a", false, 1);
  expect(v.setOrganizationConsent).not.toHaveBeenCalled();
  const text = (await screen.findByText("Automatically organize new notes and photos", { exact: true })).closest("details")!;
  expect(text.textContent).toMatch(/Automatic organization is off/);
});

it("treats a stale epoch or ambiguous consent write as unknown: no auto-retry, state cleared, explicit refresh restores truth", async () => {
  const set = vi.fn().mockRejectedValueOnce(new Error("Voice organization consent changed; refresh the setting"));
  const capability = vi.fn().mockResolvedValueOnce(cap()).mockResolvedValue(cap({ consent: "active", enabled: true, consent_epoch: 3, local_readiness: "ready", automatic_enabled: true }));
  mount(vault({ audioOrganizationCapability: capability, setAudioOrganizationConsent: set, reconcileAudioOrganizationConsent: vi.fn() }));
  const details = await openAudioSettings();
  await press("Turn on voice organization");
  await waitFor(() => expect(screen.getAllByRole("alert").some(a => /consent changed; refresh the setting Check the current setting before trying again\./.test(a.textContent ?? ""))).toBe(true));
  await tick(5_000);
  expect(set).toHaveBeenCalledTimes(1);
  expect(details.textContent).not.toMatch(/Voice-note organization is (on|off)/);
  expect((screen.getByRole("button", { name: "Turn on voice organization" }) as HTMLButtonElement).disabled).toBe(true);
  await press("Refresh voice setting");
  await waitFor(() => expect(details.textContent).toMatch(/Voice-note organization is on/));
  expect(set).toHaveBeenCalledTimes(1);
});

it("reconciles a needs-setup voice marker once and shows the refreshed state", async () => {
  const reconcile = vi.fn(async () => cap({ consent: "active", enabled: true, consent_epoch: 1, local_readiness: "ready", automatic_enabled: true }));
  mount(vault({ audioOrganizationCapability: vi.fn(async () => cap({ consent: "active", enabled: true, consent_epoch: 1, local_readiness: "needs_setup" })), setAudioOrganizationConsent: vi.fn(), reconcileAudioOrganizationConsent: reconcile }));
  const details = await openAudioSettings();
  await press("Finish voice setup");
  await waitFor(() => expect(details.textContent).toMatch(/Voice-note organization is on/));
  expect(reconcile).toHaveBeenCalledTimes(1); expect(reconcile).toHaveBeenCalledWith("session-a");
});

it("refuses a capability that is not the voice purpose for this vault", async () => {
  mount(vault({ audioOrganizationCapability: vi.fn(async () => ({ ...cap(), purpose: "organize" }) as unknown as AudioOrganizationCapability), setAudioOrganizationConsent: vi.fn(), reconcileAudioOrganizationConsent: vi.fn() }));
  await openAudioSettings();
  await waitFor(() => expect(screen.getAllByRole("alert").some(a => /Voice organization status does not match this vault/.test(a.textContent ?? ""))).toBe(true));
});

it.each([
  ["awaiting_transcript", null, /Waiting for a usable transcript/],
  ["queued", null, /Queued for organization/],
  ["processing", null, /Organizing the transcript/],
  ["organized", null, /^Organized/],
  ["unknown", "NOT_DISPATCHED", /Organization result uncertain — Recall could not confirm whether the transcript text was sent/],
  ["unknown", "RECEIPT_UNAVAILABLE", /no receipt for it yet/],
  ["unknown", "PROVIDER_OUTCOME_UNKNOWN", /did not confirm the outcome/],
  ["failed", "INVALID_EXTRACTION", /service could not produce a valid result/],
  ["failed", "PROVIDER_FAILED", /AI service could not finish/],
  ["failed", "RECEIPT_EXPIRED", /expired before it could be saved/],
  ["stale", "CONSENT_REVOKED", /you turned voice-note organization off/],
  ["stale", "CONSENT_EPOCH_CHANGED", /choice changed/],
  ["stale", "CONNECTION_CHANGED", /private service connection changed/],
  ["stale", "CONSENT_CHANGED", /permission changed/],
  ["stale", "SOURCE_OR_REVISION_CHANGED", /the recording changed/],
  ["stale", "TRANSCRIPT_CHANGED", /the transcript changed/],
  ["stale", "HUMAN_CORRECTION", /you corrected the transcript/],
  ["stale", "INPUT_CHANGED", /text to organize changed/],
  ["stale", "REQUEST_CHANGED", /prepared request no longer matched/],
  ["stale", "NOT_QUEUED", /never queued/],
  ["stale", "SOURCE_OR_CONNECTION_CHANGED", /recording or the private service connection changed/],
  ["saved_local", "TRANSCRIPT_INELIGIBLE", /no clear speech to organize, so nothing was sent/],
  ["saved_local", "TRANSCRIPTION_FAILED", /transcription did not complete/],
  ["saved_local", "INPUT_LIMIT_EXCEEDED", /too long to organize/],
  ["saved_local", "EMPTY_CORRECTION", /your correction is empty/],
  ["unknown", "RECEIPT_INVALID", /Organization result uncertain — the service’s answer could not be trusted, so nothing was added to the note/],
  ["unknown", "PROMOTION_FAILED", /Organization result uncertain — the result could not be saved to the note/],
  ["saved_local", "REQUEST_INVALID", /Saved locally, not organized — the transcript could not be prepared for organization/],
  ["stale", "STATE_CHANGED", /something changed while it was being prepared, so Recall retired it/],
  ["failed", "BRAND_NEW_CODE", /\(BRAND_NEW_CODE\)/],
  ["stale", "BRAND_NEW_CODE", /\(BRAND_NEW_CODE\)/],
] as const)("describes a %s operation (%s) in plain words", (state, code, text) => {
  expect(audioOrganizationText(operation(state, code)).headline).toMatch(text);
  for (const t of ["verified", "confirmed fact"]) expect(JSON.stringify(audioOrganizationText(operation(state, code))).toLowerCase()).not.toContain(` ${t}`);
});

it("shows the operation under the transcript, polls read-only with backoff, and stops at a terminal state", async () => {
  let current = operation("awaiting_transcript");
  const audioOrganizationOperations = vi.fn(async () => [current]);
  const recover = vi.fn();
  await openMemory(vault({ audioOrganizationOperations, recoverAudioOrganization: recover }));
  expect(await screen.findByText("Waiting for a usable transcript")).toBeTruthy();
  current = operation("queued"); await tick(1_700);
  expect(await screen.findByText("Queued for organization")).toBeTruthy();
  current = operation("processing"); await tick(3_100);
  expect(await screen.findByText(/Organizing the transcript…/)).toBeTruthy();
  current = operation("saved_local", "TRANSCRIPT_INELIGIBLE");
  await tick(6_100);
  expect(await screen.findByText(/Saved locally, not organized/)).toBeTruthy();
  const calls = audioOrganizationOperations.mock.calls.length;
  await tick(60_000);
  expect(audioOrganizationOperations.mock.calls.length).toBe(calls);
  expect(recover).not.toHaveBeenCalled();
});

it("checks an uncertain result with recover for the same operation and refreshes the memory when it becomes organized", async () => {
  const organized: VaultMemory = { ...base, revision: 3, audio_organization: proposal() };
  const list = vi.fn(async () => [base]);
  let current = operation("unknown", "PROVIDER_OUTCOME_UNKNOWN");
  const recover = vi.fn(async () => { list.mockImplementation(async () => [organized]); current = operation("organized"); return current; });
  await openMemory(vault({ list, audioOrganizationOperations: vi.fn(async () => [current]), recoverAudioOrganization: recover }));
  expect(await screen.findByText(/Organization result uncertain/)).toBeTruthy();
  expect(screen.getByText(/will not send it again blindly/)).toBeTruthy();
  await press("Check result");
  expect(recover).toHaveBeenCalledTimes(1); expect(recover).toHaveBeenCalledWith("session-a", OP);
  expect(await screen.findByRole("heading", { name: "Unreviewed machine proposals derived from an unreviewed machine transcript" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Check result" })).toBeNull();
});

it("refreshes the memory once the polled operation becomes organized", async () => {
  let current = operation("processing");
  const organized: VaultMemory = { ...base, revision: 3, audio_organization: proposal() };
  const list = vi.fn(async () => (current.state === "organized" ? [organized] : [base]));
  await openMemory(vault({ list, audioOrganizationOperations: vi.fn(async () => [current]) }));
  await screen.findByText(/Organizing the transcript…/);
  current = operation("organized"); await tick(1_700);
  expect(await screen.findByRole("heading", { name: /^Unreviewed machine proposals derived from an unreviewed machine transcript$/ })).toBeTruthy();
});

it("renders proposals under the transcript as unreviewed, with no approve or verify control", async () => {
  await openMemory(vault({ list: vi.fn(async () => [{ ...base, audio_organization: proposal() }]), audioOrganizationOperations: vi.fn(async () => [operation("organized")]) }));
  const section = await screen.findByLabelText("Machine proposals from the transcript");
  const text = section.textContent ?? "";
  for (const expected of ["SYNTHETIC reminder to phone the dentist", "call the dentist", "SYNTHETIC the dentist", "SYNTHETIC call tomorrow at three", "SYNTHETIC call the dentist", "SYNTHETIC which dentist is unclear"]) expect(text).toContain(expected);
  expect(text).toMatch(/What the transcript may say/);
  expect(text).toMatch(/proposals, not verified facts/);
  expect(screen.queryByRole("button", { name: /approve|verify|confirm|accept/i })).toBeNull();
  expect(screen.queryByText(/AI suggestion/)).toBeNull();
  // The proposals follow the transcript in document order.
  const transcript = screen.getByRole("heading", { name: "Transcript" });
  expect(transcript.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("titles proposals derived from a human-corrected transcript accordingly", async () => {
  await openMemory(vault({ list: vi.fn(async () => [{ ...base, audio_organization: proposal({ kind: "human_corrected" }) }]), audioOrganizationOperations: vi.fn(async () => [operation("organized")]) }));
  expect(await screen.findByRole("heading", { name: "Unreviewed machine proposals derived from a human-corrected transcript" })).toBeTruthy();
});

it("does not present suppressed proposals as current", async () => {
  await openMemory(vault({ list: vi.fn(async () => [{ ...base, audio_organization: proposal({ suppressed: true }) }]), audioOrganizationOperations: vi.fn(async () => [operation("organized")]) }));
  expect(await screen.findByText("Suppressed after your correction; kept in history.")).toBeTruthy();
  expect(screen.queryByText("SYNTHETIC reminder to phone the dentist")).toBeNull();
  expect(screen.queryByRole("heading", { name: /Unreviewed machine proposals/ })).toBeNull();
});

it("shows retained proposals per revision in the memory history, labeled suppressed when retired", async () => {
  const history = vi.fn(async () => [
    { revision: 2, note: "", recorded_at: "2026-10-22T12:00:00Z", origin: "machine:anthropic", kind: "audio_organization", audio_organization: proposal({ suppressed: true }) },
  ]);
  await openMemory(vault({ history, list: vi.fn(async () => [{ ...base, audio_organization: proposal({ suppressed: true }) }]) }));
  await press("History");
  expect(await screen.findByRole("heading", { name: "Retained machine proposals · suppressed after your correction" })).toBeTruthy();
  expect(screen.getByText("SYNTHETIC reminder to phone the dentist")).toBeTruthy();
});

function retained(audio_organization: OrganizationProposal): HistoryCitation {
  return { memory_id: UUID, revision: 2, event_sha256: "a".repeat(64), source_sha256: "hash", current_revision: 3, current: false, quote: "SYNTHETIC dentist", retained_revision: { revision: 2, note: "", recorded_at: "2026-10-22T12:00:00Z", origin: "machine:anthropic", kind: "audio_organization", audio_transcript: { machine, human_correction: null }, audio_organization }, original: { bytes: [82, 73, 70, 70], mime_type: "audio/wav", sha256: "hash" } };
}
it("shows retained audio proposals in the historical source view, as unreviewed or suppressed", () => {
  const live = render(<HistoricalSourceView source={retained(proposal())} onClose={() => {}} />);
  expect(screen.getByRole("heading", { name: "Unreviewed machine proposals derived from an unreviewed machine transcript" })).toBeTruthy();
  expect(screen.getByText("SYNTHETIC reminder to phone the dentist")).toBeTruthy();
  expect(live.container.textContent).not.toMatch(/AI suggestion/);
  live.unmount();
  const corrected = render(<HistoricalSourceView source={retained(proposal({ kind: "human_corrected" }))} onClose={() => {}} />);
  expect(screen.getByRole("heading", { name: "Unreviewed machine proposals derived from a human-corrected transcript" })).toBeTruthy();
  corrected.unmount();
  const suppressed = render(<HistoricalSourceView source={retained(proposal({ suppressed: true }))} onClose={() => {}} />);
  expect(screen.getByRole("heading", { name: "Retained machine proposals · suppressed after your correction" })).toBeTruthy();
  expect(suppressed.container.textContent).toMatch(/Historical only/);
  suppressed.unmount();
});

it("describes processing in the present tense and never claims an unconfirmed send", () => {
  const processing = audioOrganizationText(operation("processing")).detail;
  expect(processing).toBe("Only the transcript text is sent to Claude; the recording never is.");
  expect(processing).not.toMatch(/was sent|were sent|has been sent/);
  for (const code of [null, "NOT_DISPATCHED", "RECEIPT_UNAVAILABLE", "PROVIDER_OUTCOME_UNKNOWN"]) {
    const text = audioOrganizationText(operation("unknown", code));
    expect(`${text.headline} ${text.detail}`).not.toMatch(/was sent\b(?! *$)(?<!whether the transcript text was sent)/);
    expect(text.detail).toMatch(/will not send it again blindly/);
  }
  expect(audioOrganizationText(operation("unknown", "NOT_DISPATCHED")).headline).toMatch(/could not confirm whether the transcript text was sent/);
});

it.each([
  ["unknown", "RECEIPT_INVALID", true], ["unknown", "PROMOTION_FAILED", true],
  ["saved_local", "REQUEST_INVALID", false], ["stale", "STATE_CHANGED", false],
] as const)("offers Check result only for the non-terminal %s state (%s)", async (state, code, offered) => {
  await openMemory(vault({ audioOrganizationOperations: vi.fn(async () => [operation(state, code)]), recoverAudioOrganization: vi.fn() }));
  await screen.findByText(new RegExp(state === "unknown" ? "Organization result uncertain" : state === "stale" ? "Not organized" : "Saved locally"));
  expect(screen.queryByRole("button", { name: "Check result" }) !== null).toBe(offered);
});
