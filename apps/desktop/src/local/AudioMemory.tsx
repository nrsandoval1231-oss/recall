import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { effectiveTranscript, type AudioOperationStatus, type LocalVault, type OrganizationOperation, type VaultMemory } from "../platform/local-vault";
import { AUDIO_LIVE, AUDIO_OBSERVE_MS, ORG_LIVE, TRANSCRIPT_CAVEAT, audioOrganizationText, audioPollDelay, clock, transcriptProblem } from "./audio";
import { AudioProposals, organizationPollDelay } from "./Organization";

const message = (e: unknown) => e instanceof Error ? e.message : String(e);
function readable(iso: string) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }); }
const eligible = (m: VaultMemory) => m.revision > 0 && m.state === "active" && !m.conflict;

// Shared by the memory view and its history: the machine reading is always retained, a human correction is current.
export function TranscriptText({ memory }: { memory: VaultMemory }) {
  const t = memory.audio_transcript; if (!t) return null;
  const { machine, human_correction: human } = t;
  const usable = machine.eligibility === "eligible" && machine.text.trim().length > 0;
  return <>
    {human !== null && <section className="local-human-reading"><h3>Your corrected transcript</h3><p className="local-reading-text">{human.text || "Your transcript is intentionally empty."}</p><p className="local-muted">Your wording is current · corrected <time dateTime={human.corrected_at} title={human.corrected_at}>{readable(human.corrected_at)}</time>. It is what you typed after listening, not a verified fact.</p></section>}
    <section className="local-machine-reading">
      {human !== null ? <details className="local-tools"><summary>Machine transcript kept in history · unreviewed</summary>{usable ? <p className="local-reading-text">{machine.text}</p> : <p className="local-muted">The machine transcript was not usable.</p>}</details>
        : usable ? <><h3>Machine transcript · unreviewed</h3><p className="local-reading-text">{machine.text}</p><p className="local-muted">Written by software, not checked by you. It is not a verified record of what was said.</p></>
          : <><h3>No usable transcript</h3><p>Monolith didn’t get a reliable transcript from this recording. It may be silent, very quiet or unclear. Listen to it, and type what you hear if you like.</p></>}
      <details className="local-provenance"><summary>Transcript details</summary><p>{TRANSCRIPT_CAVEAT}</p><p>Made on this computer · {machine.transform_version}</p><p>Recording SHA-256: {machine.source_sha256}</p><p>Model SHA-256: {machine.model_sha256}</p><p>Recognizer build: {machine.runtime_source_commit} · {machine.runtime_binary_sha256}</p>{machine.quality_flags.length > 0 && <p>Quality notes: {machine.quality_flags.join(", ")}</p>}</details>
    </section>
  </>;
}

type Props = { vault: LocalVault; session: string; memory: VaultMemory; active: boolean; generation: number; blocked: boolean; onMemory: (m: VaultMemory) => void };
type Correction = { operationId: string; revision: number; text: string };
export function AudioMemory({ vault, session, memory, active, generation, blocked, onMemory }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [playError, setPlayError] = useState(false);
  const [wait, setWait] = useState<AudioOperationStatus | null>(null);
  const [waitPaused, setWaitPaused] = useState(false);
  const [panel, setPanel] = useState<"view" | "correct">("view");
  const [draft, setDraft] = useState("");
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [op, setOp] = useState<OrganizationOperation | null>(null);
  const [opError, setOpError] = useState("");
  const [opPaused, setOpPaused] = useState(false);
  const [opTick, setOpTick] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const orgRequest = useRef(0);
  const orgPolls = useRef(0);
  const orgSince = useRef(Date.now());
  const alive = useRef(true);
  const epoch = useRef(0);
  const sourceRequest = useRef(0);
  const statusRequest = useRef(0);
  const polls = useRef(0);
  const since = useRef(Date.now());
  const artifact = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const onMemoryRef = useRef(onMemory); onMemoryRef.current = onMemory;
  const context = useRef({ active, generation, id: memory.id }); context.current = { active, generation, id: memory.id };
  function guard() { const e = epoch.current; const g = generation; const id = memory.id; return () => alive.current && context.current.active && context.current.generation === g && context.current.id === id && epoch.current === e; }
  function release() { sourceRequest.current++; if (artifact.current) URL.revokeObjectURL(artifact.current); artifact.current = null; setUrl(null); }
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; sourceRequest.current++; statusRequest.current++; if (artifact.current) URL.revokeObjectURL(artifact.current); }; }, []);
  useLayoutEffect(() => {
    epoch.current++;
    if (!active) { setWorking(false); if (correction) { setNeedsReview(true); setReviewReady(false); setReviewed(false); } }
  }, [active, generation]);
  const playable = eligible(memory);
  // The recording is played from native-verified bytes; the Blob URL never outlives this view.
  useEffect(() => {
    if (!active || !playable) { release(); return; }
    const request = ++sourceRequest.current; setSourceError(""); setPlayError(false);
    void vault.source(session, memory.id).then(s => {
      if (!alive.current || request !== sourceRequest.current) return;
      if (s.sha256 !== memory.source_sha256) throw new Error("The recording’s hash no longer matches this memory.");
      if (s.mime_type !== "audio/wav") throw new Error("The original is not a WAV recording.");
      const next = URL.createObjectURL(new Blob([new Uint8Array(s.bytes)], { type: "audio/wav" }));
      if (artifact.current) URL.revokeObjectURL(artifact.current); artifact.current = next; setUrl(next);
    }).catch(e => {
      if (!alive.current || request !== sourceRequest.current) return;
      release(); const conflict = `Original recording unavailable: ${message(e)}`; setSourceError(conflict); onMemoryRef.current({ ...memory, state: "conflict", conflict });
    });
    return () => { sourceRequest.current++; };
  }, [active, playable, session, memory.id, memory.source_sha256, generation]);
  // Until a transcript exists, read the (read-only) operation status; this never starts or retries recognition.
  const awaiting = playable && active && !memory.audio_transcript && Boolean(vault.audioStatus);
  useEffect(() => { polls.current = 0; since.current = Date.now(); setWait(null); setWaitPaused(false); }, [memory.id]);
  useEffect(() => {
    if (!awaiting || waitPaused || (wait && !AUDIO_LIVE.includes(wait.state))) return;
    if (Date.now() - since.current >= AUDIO_OBSERVE_MS) { setWaitPaused(true); return; }
    const request = ++statusRequest.current;
    const timer = window.setTimeout(() => {
      vault.audioStatus!(session, memory.id).then(s => {
        if (!alive.current || request !== statusRequest.current) return;
        polls.current++; setWait(s);
        if (s.memory && s.memory.id === memory.id && s.memory.audio_transcript) onMemoryRef.current(s.memory);
      }, () => { if (alive.current && request === statusRequest.current) setWaitPaused(true); });
    }, wait ? audioPollDelay(polls.current) : 0);
    return () => { window.clearTimeout(timer); statusRequest.current++; };
  }, [awaiting, waitPaused, wait, session, memory.id]);
  useLayoutEffect(() => { if (active && panel === "correct") heading.current?.focus(); }, [panel, active]);
  // Organization is automatic. This only reads the one operation's status (never sends or retries) and refreshes the memory once it is organized.
  async function refreshMemory(id: number) {
    const rows = await vault.list(session, "", true);
    const latest = rows.find(m => m.id === memory.id);
    if (alive.current && id === orgRequest.current && latest) onMemoryRef.current(latest);
  }
  async function loadOperation() {
    const id = ++orgRequest.current;
    try {
      const rows = await vault.audioOrganizationOperations!(session, memory.id);
      if (!alive.current || id !== orgRequest.current) return;
      const current = rows.at(-1) ?? null; setOp(current); setOpError("");
      if (current?.state === "organized" && !memory.audio_organization) await refreshMemory(id);
    } catch (e) { if (alive.current && id === orgRequest.current) { setOpError(`Voice organization status could not be read: ${message(e)}`); setOpPaused(true); } }
  }
  useEffect(() => {
    if (!active || !vault.audioOrganizationOperations) return;
    orgPolls.current = 0; orgSince.current = Date.now(); setOpPaused(false); void loadOperation();
    return () => { orgRequest.current++; };
  }, [active, session, memory.id, memory.revision]);
  const orgLive = Boolean(op && ORG_LIVE.includes(op.state));
  useEffect(() => {
    if (!active || !orgLive || opPaused) return;
    if (Date.now() - orgSince.current >= 600_000) { setOpPaused(true); return; }
    const timer = window.setTimeout(() => { orgPolls.current++; void loadOperation().finally(() => setOpTick(t => t + 1)); }, organizationPollDelay(orgPolls.current));
    return () => window.clearTimeout(timer);
  }, [active, orgLive, op?.state, opTick, opPaused]);
  async function recoverOperation() {
    if (!op || !vault.recoverAudioOrganization || recovering) return;
    const id = ++orgRequest.current; setRecovering(true); setOpError("");
    try {
      const result = await vault.recoverAudioOrganization(session, op.operation_id);
      if (!alive.current || id !== orgRequest.current) return;
      setOp(result); orgPolls.current = 0; orgSince.current = Date.now(); setOpPaused(false);
      if (result.state === "organized") await refreshMemory(id);
    } catch (e) { if (alive.current && id === orgRequest.current) setOpError(`The result could not be checked yet: ${message(e)}`); }
    finally { if (alive.current) setRecovering(false); }
  }
  const t = memory.audio_transcript;
  function startCorrection() { setDraft(effectiveTranscript(memory) ?? ""); setCorrection(null); setNeedsReview(false); setReviewReady(false); setReviewed(false); setError(""); setNotice(""); setPanel("correct"); }
  async function saveCorrection() {
    if (working || blocked || !playable || !t || !vault.audioCorrect || (needsReview && (!reviewReady || !reviewed))) return;
    const valid = guard(); const intent = correction ?? { operationId: crypto.randomUUID().toLowerCase(), revision: memory.revision, text: draft }; setCorrection(intent); setWorking(true); setError("");
    try {
      const result = await vault.audioCorrect(session, memory.id, intent.revision, intent.operationId, intent.text);
      if (valid()) { onMemoryRef.current(result); setCorrection(null); setNeedsReview(false); setPanel("view"); setNotice("Your transcript correction is saved. The machine transcript stays in history."); }
    } catch (e) { if (valid()) { setError(message(e)); setNeedsReview(true); setReviewReady(false); setReviewed(false); } }
    finally { if (valid()) setWorking(false); }
  }
  async function reloadLatest() {
    const valid = guard(); setWorking(true); setError(""); setReviewReady(false); setReviewed(false);
    try {
      const rows = await vault.list(session, "", true); if (!valid()) return;
      const latest = rows.find(m => m.id === memory.id); if (!latest) throw new Error("This recording is unavailable. Your correction is kept here.");
      onMemoryRef.current(latest);
      if (!eligible(latest) || !latest.audio_transcript) throw new Error(latest.conflict || "This recording can’t accept a correction right now. Your correction is kept here.");
      setReviewReady(true);
    } catch (e) { if (valid()) setError(message(e)); }
    finally { if (valid()) setWorking(false); }
  }
  const source = memory.audio_source;
  const ended = wait && (wait.state === "transcription_unavailable" || wait.state === "unknown") ? wait : null;
  return <section className="local-audio-memory" aria-label="Voice recording">
    {notice && panel === "view" && <p role="status">{notice}</p>}
    <div className="local-audio-player">
      <h2>Original recording</h2>
      {sourceError && <p role="alert" className="local-error">{sourceError}</p>}
      {url && !playError ? <audio controls src={url} aria-label="Original recording" onError={() => setPlayError(true)} /> : playable && !sourceError && !playError ? <p role="status">Loading the original recording…</p> : null}
      {playError && <p role="alert" className="local-error">This recording couldn’t be played here, but the original file is saved. Use “View original” to download it.</p>}
      {source && <p className="local-muted">{clock(source.duration_ms)} · {source.sample_rate_hz / 1000} kHz · {source.channels === 1 ? "mono" : "stereo"} · {source.capture_origin === "recorded" ? "recorded in Monolith" : `imported${source.original_name ? ` · ${source.original_name}` : ""}`} · bytes unchanged, hash checked by this device</p>}
    </div>
    {memory.note.trim() && <section className="local-audio-annotation" aria-label="Your annotation"><h2>Your annotation</h2><p className="local-note">{memory.note}</p><p className="local-muted">Text you added to this memory outside the recording. It is searchable and Ask can use it; it is not part of the transcript and not a verified claim.</p></section>}
    <div className="local-audio-transcript">
      <h2>Transcript</h2>
      {t ? <TranscriptText memory={memory} />
        : !vault.audioStatus ? <p className="local-muted">No transcript is available for this recording.</p>
          : ended ? <p role="status">{ended.state === "unknown" ? "Monolith can’t confirm whether transcription finished, and it won’t start it again automatically." : transcriptProblem(ended.error_code) || "Monolith couldn’t produce a transcript."} Your original recording is saved and playable above.</p>
            : waitPaused ? <><p className="local-muted">No transcript yet. Automatic checks are paused; the recording is saved and playable.</p><button disabled={!active} onClick={() => { polls.current = 0; since.current = Date.now(); setWait(null); setWaitPaused(false); }}>Check for a transcript</button></>
              : <p role="status">Transcribing on this computer…</p>}
      {t && panel === "view" && vault.audioCorrect && <div className="local-actions"><button disabled={!playable || blocked || working} onClick={startCorrection}>Correct transcript</button></div>}
      {t && panel === "correct" && <section className="local-review" aria-label="Correct the transcript"><h2 ref={heading} tabIndex={-1}>Correct the transcript</h2><p>Listen, then type what was said. Your wording becomes current; the recording and the machine transcript stay in history.</p>
        {error && <p role="alert" className="local-error">{error}</p>}
        {needsReview && <><p>Your correction is kept. Reload the latest transcript before saving, in case the recording changed.</p><button disabled={working} onClick={() => void reloadLatest()}>Reload latest transcript</button>{reviewReady && <><h3>Current transcript · revision {memory.revision}</h3><p className="local-reading-text">{effectiveTranscript(memory) ?? "No usable transcript."}</p><label><input type="checkbox" checked={reviewed} onChange={e => { setReviewed(e.target.checked); if (e.target.checked) setCorrection(null); }} />I reviewed the latest transcript</label></>}</>}
        <label htmlFor="transcript-correction">Your transcript correction</label><textarea id="transcript-correction" value={draft} readOnly={Boolean(correction)} onChange={e => setDraft(e.target.value)} />
        <div className="local-actions"><button className="local-primary" disabled={working || blocked || !playable || (needsReview && (!reviewReady || !reviewed))} onClick={() => void saveCorrection()}>{working ? "Saving…" : "Save correction"}</button><button disabled={working} onClick={() => setPanel("view")}>Back to transcript</button></div></section>}
    </div>
    {(op || opError || memory.audio_organization) && <div className="local-audio-organization" aria-label="Voice organization">
      {op && <section className="local-organization-operation" aria-label="Voice organization status" aria-live="polite">{(() => { const text = audioOrganizationText(op); const suppressed = op.state === "organized" && memory.audio_organization?.suppressed; return <><p><strong>{text.headline}</strong></p><p className="local-muted">{suppressed ? "The earlier proposals were suppressed after your correction and are kept in history." : text.detail}</p></>; })()}
        {op.error_code && <details className="local-tools"><summary>Technical details</summary><code>{op.state} · {op.error_code}</code></details>}
        {op.state === "unknown" && <button disabled={recovering || !active || !vault.recoverAudioOrganization} onClick={() => void recoverOperation()}>{recovering ? "Checking…" : "Check result"}</button>}
        {opPaused && orgLive && <><p className="local-muted">Automatic status checks are paused.</p><button disabled={!active} onClick={() => { orgPolls.current = 0; orgSince.current = Date.now(); setOpPaused(false); void loadOperation(); }}>Check status again</button></>}</section>}
      {opError && <p role="alert" className="local-error">{opError}</p>}
      {memory.audio_organization && <AudioProposals proposal={memory.audio_organization} />}
    </div>}
  </section>;
}
