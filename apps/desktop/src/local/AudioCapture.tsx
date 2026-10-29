import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AudioOperationStatus, LocalVault, VaultMemory, VaultStatus } from "../platform/local-vault";
import { AUDIO_LIVE, AUDIO_OBSERVE_MS, audioFinal, audioHeadline, audioPollDelay, audioProblem, clock, limitText, transcriptProblem } from "./audio";

type Selected = VaultStatus & { root: string; vault_id: string; vault_identity: string };
type Intent = { operationId: string; kind: "record" | "import"; startedAt: number | null };
type Busy = null | "starting" | "stopping" | "recovering" | "importing" | "checking";
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const key = (s: Selected) => `recall.local.audio:${JSON.stringify([s.root, s.vault_identity])}`;
function loadIntent(s: Selected): Intent | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key(s)) ?? "null");
    if (v && typeof v === "object" && "operationId" in v && typeof v.operationId === "string" && /^[0-9a-f-]{36}$/.test(v.operationId) && "kind" in v && (v.kind === "record" || v.kind === "import")) return { operationId: v.operationId, kind: v.kind, startedAt: "startedAt" in v && typeof v.startedAt === "number" ? v.startedAt : null };
  } catch { /* an unreadable intent is treated as none; the native receipt stays authoritative */ }
  return null;
}
function storeIntent(s: Selected, intent: Intent | null) { try { if (intent) localStorage.setItem(key(s), JSON.stringify(intent)); else localStorage.removeItem(key(s)); } catch { /* storage is a convenience; native receipts are the record */ } }
function rate(hz: number | null, channels: number | null) { return hz ? `${hz / 1000} kHz${channels ? channels === 1 ? " · mono" : " · stereo" : ""}` : ""; }

export function AudioCapture(props: { vault: LocalVault; selected: Selected; active: boolean; onChanged: () => void; onOpen: (m: VaultMemory) => void }) {
  return props.vault.audioStart && props.vault.audioStop && props.vault.audioStatus ? <AudioCaptureInner {...props} /> : null;
}

function AudioCaptureInner({ vault, selected, active, onChanged, onOpen }: { vault: LocalVault; selected: Selected; active: boolean; onChanged: () => void; onOpen: (m: VaultMemory) => void }) {
  const [status, setStatus] = useState<AudioOperationStatus | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [paused, setPaused] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Only a stored recording needs a status check before new actions are offered.
  // The intent present when the panel mounted is the only one to restore; one written later by a user action is never mistaken for it.
  const [mountIntent] = useState(() => loadIntent(selected));
  const firstRun = useRef(true);
  const [ready, setReady] = useState(mountIntent?.kind !== "record");
  const [now, setNow] = useState(() => Date.now());
  const epoch = useRef(0);
  const alive = useRef(true);
  const inflight = useRef(false);
  const intentRef = useRef<Intent | null>(null);
  const lastState = useRef("");
  const seen = useRef("");
  const polls = useRef(0);
  const since = useRef(Date.now());
  const wasRecording = useRef(false);
  const focusedStop = useRef(false);
  const stopButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const context = useRef({ active }); context.current = { active };
  const onChangedRef = useRef(onChanged); onChangedRef.current = onChanged;
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  // A guard captured before a user action is invalidated by that action, so a slow status read cannot regress a newer state.
  function guard() { const e = epoch.current; return () => alive.current && context.current.active && epoch.current === e; }
  function setIntentBoth(next: Intent | null) { intentRef.current = next; setIntent(next); storeIntent(selected, next); }
  function accept(s: AudioOperationStatus) {
    if (s.vault_id !== selected.vault_identity) throw new Error("This recording status belongs to a different vault, so Monolith ignored it.");
    if (s.state !== lastState.current) { lastState.current = s.state; polls.current = 0; since.current = Date.now(); setPaused(false); }
    setStatus(s);
    const base = intentRef.current;
    if (audioFinal(s.state)) setIntentBoth(null);
    else if (base && s.state === "recording" && base.startedAt === null) setIntentBoth({ ...base, startedAt: Date.now() });
    const signature = `${s.state}:${s.memory?.id ?? ""}:${Boolean(s.memory?.audio_transcript)}`;
    if (signature !== seen.current) { seen.current = signature; if (s.memory) onChangedRef.current(); }
  }
  useEffect(() => {
    if (!active) return;
    const first = firstRun.current; firstRun.current = false;
    const restored = first ? mountIntent : loadIntent(selected);
    if (first && !restored) { setReady(true); return; }
    intentRef.current = restored; setIntent(restored); setBusy(null);
    if (!restored || restored.kind === "import") { setReady(true); return () => { epoch.current++; }; }
    // A recording or recovery decision can outlive this view; status is read-only and resumes it.
    const valid = guard(); setBusy("checking");
    vault.audioStatus!(selected.vault_id, restored.operationId).then(s => { if (valid()) accept(s); }).catch(e => {
      if (!valid()) return;
      if (/unknown audio operation/i.test(message(e))) setIntentBoth(null);
      else { setError(`Monolith couldn’t check your earlier recording: ${message(e)}`); setPaused(true); }
    }).finally(() => { if (valid()) { setBusy(null); setReady(true); } });
    return () => { epoch.current++; };
  }, [vault, selected.vault_id, selected.vault_identity, active]);
  const live = Boolean(status && AUDIO_LIVE.includes(status.state));
  const recording = status?.state === "recording";
  useEffect(() => {
    if (!live || !status || busy || paused || !active) return;
    if (!recording && Date.now() - since.current >= AUDIO_OBSERVE_MS) { setPaused(true); return; }
    const timer = window.setTimeout(() => { polls.current++; void check(false); }, recording ? 1_000 : audioPollDelay(polls.current));
    return () => window.clearTimeout(timer);
  }, [live, status, busy, paused, active]);
  useEffect(() => {
    if (!recording || !active) return;
    setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [recording, active]);
  // Focus follows the one gesture: Record hands focus to Stop (once it is enabled), and Stop hands it back to the heading.
  useLayoutEffect(() => {
    if (recording && !busy && !focusedStop.current) { stopButton.current?.focus(); focusedStop.current = true; }
    else if (!recording) { if (wasRecording.current) heading.current?.focus(); focusedStop.current = false; }
    wasRecording.current = recording;
  }, [recording, busy]);
  async function check(manual: boolean) {
    const op = intentRef.current?.operationId ?? status?.operation_id; if (!op || !vault.audioStatus || (manual && inflight.current)) return;
    // Background polls never clear an error the user has not seen resolved; only a manual check or a new action does.
    const valid = guard();
    if (manual) { setError(""); setBusy("checking"); setPaused(false); polls.current = 0; since.current = Date.now(); }
    try { const s = await vault.audioStatus(selected.vault_id, op); if (valid()) accept(s); }
    catch (e) {
      if (!valid()) return;
      // An operation that never began has nothing to resume; drop its stored ID.
      if (!status && /unknown audio operation/i.test(message(e))) { setIntentBoth(null); setNotice("That recording never started. You can record again."); return; }
      setError(`Monolith couldn’t read the recording status: ${message(e)}`); setPaused(true);
    }
    finally { if (valid() && manual) setBusy(null); }
  }
  async function act(kind: Exclude<Busy, null | "checking">, run: (valid: () => boolean) => Promise<void>, failure: (e: unknown) => string) {
    if (inflight.current) return;
    inflight.current = true; epoch.current++; const valid = guard(); setBusy(kind); setError(""); setNotice(""); setConfirmDiscard(false);
    try { await run(valid); }
    catch (e) { if (valid()) setError(failure(e)); }
    finally { inflight.current = false; if (valid()) setBusy(null); }
  }
  // Only a start that was never confirmed (no status yet) retries under its stored operation ID; native start is idempotent for it.
  // Once a status exists for an operation, the next Record is a new recording with a fresh ID.
  function record() {
    if (busy || recording || status?.state === "recovery_required" || inflight.current) return;
    const next: Intent = intentRef.current?.kind === "record" && !status ? intentRef.current : { operationId: crypto.randomUUID().toLowerCase(), kind: "record", startedAt: null };
    void act("starting", async valid => {
      if (next !== intentRef.current) { setStatus(null); lastState.current = ""; seen.current = ""; }
      setIntentBoth(next);
      const s = await vault.audioStart!(selected.vault_id, next.operationId); if (valid()) accept(s);
    }, e => `Recording didn’t start: ${message(e)} Choose Record again to retry the same recording safely.`);
  }
  function stop() {
    const op = intentRef.current?.operationId; if (!op || !recording || busy || inflight.current) return;
    void act("stopping", async valid => { const s = await vault.audioStop!(selected.vault_id, op); if (valid()) accept(s); },
      e => `Stop couldn’t be confirmed: ${message(e)} The recording may still be running or already saved. Try Stop again, or check the status.`);
  }
  function recover(action: "save" | "discard") {
    const op = intentRef.current?.operationId ?? status?.operation_id; if (!op || status?.state !== "recovery_required" || !vault.audioRecover || busy || inflight.current) return;
    void act("recovering", async valid => { const s = await vault.audioRecover!(selected.vault_id, op, action); if (valid()) accept(s); },
      e => `Monolith couldn’t ${action} this recording: ${message(e)} Nothing was changed that you can’t retry.`);
  }
  function importWav() {
    if (busy || recording || status?.state === "recovery_required" || inflight.current || !vault.importWav) return;
    const next: Intent = intentRef.current?.kind === "import" ? intentRef.current : { operationId: crypto.randomUUID().toLowerCase(), kind: "import", startedAt: null };
    void act("importing", async valid => {
      setIntentBoth(next);
      const saved = await vault.importWav!(selected.vault_id, next.operationId); if (!valid()) return;
      setIntentBoth(null);
      if (saved === null) { setNotice("WAV selection cancelled. Nothing was saved."); return; }
      let s: AudioOperationStatus;
      try { s = await vault.audioStatus!(selected.vault_id, next.operationId); }
      catch { s = { schema_version: "1.0", operation_id: next.operationId, vault_id: selected.vault_identity, state: "saved_local", memory: saved, error_code: null, limit_reason: null, source_sample_rate_hz: saved.audio_source?.sample_rate_hz ?? null, source_channels: saved.audio_source?.channels ?? null }; }
      if (valid()) { lastState.current = ""; seen.current = ""; accept(s); }
    }, e => `WAV import couldn’t be confirmed: ${message(e)} Retrying uses the same import, so it can’t create a duplicate.`);
  }
  // Escape hatch for a stored recording whose status cannot be read: forget its ID here (native evidence is untouched) and record anew.
  function startNew() {
    if (busy || inflight.current) return;
    setIntentBoth(null); setStatus(null); lastState.current = ""; seen.current = ""; setPaused(false); setError(""); setNotice("");
    record();
  }
  function abandonImport() { setIntentBoth(null); setError(""); setNotice("Pending WAV import abandoned. Any recording it saved is already in your memories."); }
  const state = status?.state;
  const headline = busy === "starting" ? "Starting the microphone…" : busy === "stopping" ? "Stopping and saving…" : busy === "importing" ? "Choose a WAV file in the native picker…" : busy === "recovering" ? "Working on your recording…" : status ? audioHeadline(status) : "";
  const startedAt = intent?.startedAt ?? since.current;
  const limit = limitText(status?.limit_reason);
  const format = rate(status?.source_sample_rate_hz ?? null, status?.source_channels ?? null);
  const stable = busy !== "starting" && busy !== "stopping";
  return <section className="local-glass local-audio" aria-labelledby="local-audio-title">
    <h2 id="local-audio-title" ref={heading} tabIndex={-1}>Record a voice note</h2>
    <p className="local-muted">One tap to record and one to stop, up to 2 minutes. The original recording is saved on this computer, and its transcript is made on this computer.</p>
    {headline && <p role="status" className="local-audio-status"><strong>{headline}</strong></p>}
    {recording && stable && <p className="local-audio-live"><span aria-hidden="true">● </span>Recording · <span role="timer" aria-label="Elapsed recording time">{clock(now - startedAt)}</span> of 2:00{format && <span className="local-muted"> · {format}</span>}</p>}
    {recording && <p className="local-muted">{limit ? `${limit} Finishing the save…` : "Choose Stop & save when you’re done. Recording stops by itself at 2 minutes."}</p>}
    {limit && !recording && state !== "failed" && <p>{limit}</p>}
    {(state === "saved_local" || state === "transcription_processing") && <p className="local-muted">Your original recording is saved. A transcript will appear here when it’s ready, and you can keep using Monolith meanwhile.</p>}
    {state === "transcribed" && <p className="local-muted">The transcript is machine-written and unreviewed. Open the recording to listen and check it.</p>}
    {state === "transcription_unavailable" && <p>{transcriptProblem(status?.error_code) || "Monolith couldn’t produce a transcript."} Your original recording is saved and you can still play it.</p>}
    {state === "unknown" && <p>Monolith can’t confirm whether transcription finished, and it won’t start it again automatically. Your original recording is saved and playable.</p>}
    {state === "recovery_required" && <section className="local-review" aria-label="Recording decision"><p>{audioProblem(status?.error_code) || "A recording was left unfinished."}</p><p>You can save what was captured as a recording, or discard it. Discarding permanently removes this unsaved audio.</p>
      <div className="local-actions"><button className="local-primary" disabled={Boolean(busy)} onClick={() => recover("save")}>Save recording</button>{confirmDiscard ? <><button disabled={Boolean(busy)} onClick={() => recover("discard")}>Yes, discard this audio</button><button disabled={Boolean(busy)} onClick={() => setConfirmDiscard(false)}>Keep it for now</button></> : <button disabled={Boolean(busy)} onClick={() => setConfirmDiscard(true)}>Discard recording</button>}</div></section>}
    {state === "failed" && <p>{audioProblem(status?.error_code) || "Monolith couldn’t record."} {status?.memory ? "Your original recording was saved before this problem." : "Nothing was saved."}</p>}
    {state === "discarded" && <p>The unsaved audio was removed. Nothing was added to your vault.</p>}
    {paused && live && <p className="local-muted">Automatic status checks are paused.</p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="local-error">{error}</p>}
    <div className="local-actions">
      {recording ? <button ref={stopButton} className="local-primary" disabled={Boolean(busy)} onClick={stop}>{busy === "stopping" ? "Saving…" : "Stop & save"}</button> : <button className="local-primary" disabled={!ready || Boolean(busy) || state === "recovery_required"} onClick={record}>{busy === "starting" ? "Starting…" : state === "recovery_required" ? "Record" : intent?.kind === "record" && !status ? "Record again" : "Record"}</button>}
      {vault.importWav && !recording && <button disabled={!ready || Boolean(busy) || state === "recovery_required"} onClick={importWav}>{intent?.kind === "import" ? "Retry WAV import" : "Import WAV"}</button>}
      {intent?.kind === "import" && !busy && <button onClick={abandonImport}>Abandon pending import</button>}
      {status?.memory && !recording && state !== "failed" && <button onClick={() => onOpen(status.memory!)}>Open recording</button>}
      {!recording && (status ? paused || state === "unknown" || state === "transcription_processing" || state === "saved_local" : intent?.kind === "record" && Boolean(error)) && <button disabled={Boolean(busy)} onClick={() => void check(true)}>Check status</button>}
      {!recording && !status && intent?.kind === "record" && Boolean(error) && !busy && <button onClick={startNew}>Start a new recording</button>}
      {state && audioFinal(state) && !busy && <button onClick={() => { setStatus(null); lastState.current = ""; setError(""); setNotice(""); }}>Done</button>}
    </div>
  </section>;
}
