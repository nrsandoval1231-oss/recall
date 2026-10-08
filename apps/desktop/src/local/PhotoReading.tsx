import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { effectiveReading, type LocalVault, type ReadingCapability, type ReadingOperation, type VaultMemory, type VaultReading } from "../platform/local-vault";

const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const eligible = (m: VaultMemory) => m.revision > 0 && m.state === "active" && !m.conflict;
const unfinished = (op: ReadingOperation) => !["committed", "cancelled", "failed", "expired"].includes(op.state);

export function ReadingText({ reading }: { reading: VaultReading }) {
  const { machine, human_correction: human } = reading;
  return <>
    {human !== null && <section className="local-human-reading"><h2>Your corrected reading</h2><p className="local-reading-text">{human || "Your reading is intentionally empty."}</p><p className="local-muted">Your correction takes precedence over later machine readings. It is not a verified claim.</p></section>}
    <section className="local-machine-reading"><h2>Unreviewed machine reading</h2><p className="local-reading-text">{machine.result.extraction.pages[0]?.transcription || "No readable text returned."}</p>
      <p className="local-muted">Claude · {machine.result.provider} · {machine.result.model_id}. A machine proposal, not a verified source fact.</p>
      {machine.result.extraction.uncertainties.length > 0 && <><h3>Uncertainty in this reading</h3><ul className="local-uncertainties">{machine.result.extraction.uncertainties.map((u, i) => <li key={i}>{u.description}</li>)}</ul></>}
      <details className="local-provenance"><summary>Reading provenance</summary><p>Source SHA-256: {machine.request.binding.source_sha256}</p><p>Photo captured: {machine.request.binding.captured_at}</p><p>Input SHA-256: {machine.result.input_manifest_sha256}</p><p>Prepared image: {machine.result.derivative.transform_version} · {machine.result.derivative.sha256}</p>{machine.result.validation_notes.map((n, i) => <p key={i}>{n.code}: {n.detail}</p>)}</details>
    </section>
  </>;
}

type Props = { vault: LocalVault; session: string; memory: VaultMemory; active: boolean; visible: boolean; generation: number; blocked: boolean; onSaved: (m: VaultMemory) => void };
type Correction = { operationId: string; revision: number; text: string };
export function PhotoReading({ vault, session, memory, active, visible, generation, blocked, onSaved }: Props) {
  const [capability, setCapability] = useState<ReadingCapability | null>(null);
  const [operationsReady, setOperationsReady] = useState(false);
  const [operation, setOperation] = useState<ReadingOperation | null>(null);
  const [panel, setPanel] = useState<"reading" | "consent" | "correct">("reading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [draft, setDraft] = useState("");
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [decoded, setDecoded] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const epoch = useRef(0);
  const localRequest = useRef(0);
  const sourceRequest = useRef(0);
  const alive = useRef(true);
  const currentOperation = useRef<ReadingOperation | null>(null);
  const transport = useRef(false);
  const current = useRef({ active, visible, generation, memoryId: memory.id, revision: memory.revision, sourceHash: memory.source_sha256, state: memory.state }); current.current = { active, visible, generation, memoryId: memory.id, revision: memory.revision, sourceHash: memory.source_sha256, state: memory.state };
  const artifact = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const readingTrigger = useRef<HTMLButtonElement>(null);
  const returnConsentFocus = useRef(false);
  const draftRevision = useRef<number | null>(null);
  function storeOperation(op: ReadingOperation | null) { currentOperation.current = op; setOperation(op); }
  function guard() { const e = epoch.current; const g = generation; return () => alive.current && current.current.active && current.current.visible && current.current.generation === g && epoch.current === e; }
  function releaseSource() { sourceRequest.current++; if (artifact.current) URL.revokeObjectURL(artifact.current); artifact.current = null; setSource(null); setDecoded(false); }
  function cancelOnExit() {
    const op = currentOperation.current;
    if (op && unfinished(op)) {
      // Native cancellation is durable even if its request wins preparation's IPC race.
      void vault.cancelReading(session, op.operation_id).catch(() => {});
    }
    transport.current = false;
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; localRequest.current++; cancelOnExit(); if (artifact.current) URL.revokeObjectURL(artifact.current); }; }, []);
  useLayoutEffect(() => {
    epoch.current++; localRequest.current++; setWorking(false); setCancelling(false);
    if (!active || !visible) {
      cancelOnExit(); releaseSource();
      if (correction) { setNeedsReview(true); setReviewReady(false); setReviewed(false); }
      if (panel === "consent") setPanel("reading");
    }
  }, [active, visible, generation]);
  useEffect(() => {
    if (!active || !visible) return;
    const valid = guard(); const request = ++localRequest.current; setCapability(null); setOperationsReady(false);
    void Promise.all([vault.readingCapability(session), vault.readingOperations(session, memory.id)]).then(([cap, ops]) => {
      if (!valid() || request !== localRequest.current) return;
      setCapability(cap); storeOperation(ops.find(unfinished) ?? ops.at(-1) ?? null); setOperationsReady(true);
    }, e => { if (valid() && request === localRequest.current) { setError(message(e)); setCapability({ enabled: false, explanation: "Reading availability could not be checked. Local capture and search remain available." }); } });
  }, [active, visible, generation, session, memory.id]);
  useEffect(() => {
    if (!active || !visible || !memory.reading || !eligible(memory)) { releaseSource(); return; }
    // Reading transport may change its own epoch while these source bytes remain current.
    const valid = () => alive.current && current.current.active && current.current.visible && current.current.generation === generation && current.current.memoryId === memory.id && current.current.revision === memory.revision && current.current.sourceHash === memory.source_sha256 && current.current.state === memory.state;
    const request = ++sourceRequest.current; setSourceError("");
    void vault.source(session, memory.id).then(s => {
      if (!valid() || request !== sourceRequest.current) return;
      if (s.sha256 !== memory.source_sha256) throw new Error("Source hash changed");
      const url = URL.createObjectURL(new Blob([new Uint8Array(s.bytes)], { type: s.mime_type }));
      if (artifact.current) URL.revokeObjectURL(artifact.current); artifact.current = url; setSource(url); setDecoded(false);
    }).catch(e => { if (valid() && request === sourceRequest.current) { releaseSource(); setSourceError(`Original unavailable: ${message(e)}`); onSaved({ ...memory, state: "conflict", conflict: `Original unavailable: ${message(e)}` }); } });
    return () => { sourceRequest.current++; };
  }, [active, visible, generation, session, memory.id, memory.revision, memory.source_sha256, memory.state, Boolean(memory.reading)]);
  useLayoutEffect(() => { if (active && visible && panel !== "reading") heading.current?.focus(); }, [panel, active, visible]);
  useLayoutEffect(() => {
    if (panel === "reading" && returnConsentFocus.current) {
      returnConsentFocus.current = false;
      if (active && visible) readingTrigger.current?.focus();
    }
  }, [panel, active, visible]);
  function accept(outcome: { operation: ReadingOperation; memory: VaultMemory | null }, id: string) {
    if (outcome.operation.operation_id !== id || outcome.operation.memory_id !== memory.id) throw new Error("Reading response does not match this operation.");
    storeOperation(outcome.operation);
    if (outcome.memory) {
      if (outcome.memory.id !== memory.id) throw new Error("Reading response does not match this memory.");
      onSaved(outcome.memory); setPanel("reading"); setNotice("Reading saved in your vault.");
    }
  }
  async function read(recover = false) {
    if (transport.current || !active || !visible || blocked || !operationsReady || (!recover && (!eligible(memory) || !capability?.enabled))) return;
    if (recover && currentOperation.current?.state !== "ready" && !capability?.enabled) return;
    const op = recover ? currentOperation.current : { operation_id: crypto.randomUUID(), memory_id: memory.id, expected_revision: memory.revision, state: "prepared" as const, may_have_been_sent: false, error_code: null };
    if (!op) return;
    localRequest.current++; epoch.current++; const valid = guard(); storeOperation({ ...op, may_have_been_sent: true }); transport.current = true; setWorking(true); setError(""); setNotice(""); setPanel("reading");
    try {
      const result = recover ? await vault.recoverReading(session, op.operation_id) : await vault.readPhoto(session, memory.id, op.expected_revision, op.operation_id);
      if (valid()) accept(result, op.operation_id);
    } catch (e) {
      if (valid()) { setError(message(e)); storeOperation({ ...op, state: "unknown", may_have_been_sent: true }); }
    } finally { if (valid()) { transport.current = false; setWorking(false); } }
  }
  async function cancel() {
    const op = currentOperation.current; if (!op || cancelling) return;
    epoch.current++; localRequest.current++; const valid = guard(); transport.current = false; setWorking(false); setCancelling(true); setError("");
    try { const result = await vault.cancelReading(session, op.operation_id); if (valid()) { storeOperation(result); setNotice(result.state === "committed" ? "The reading had already committed. Reload this memory to inspect it." : "Reading cancelled locally. Processing or a charge may already have occurred."); } }
    catch (e) { if (valid()) { setError(`Cancellation could not be confirmed: ${message(e)}. Processing or a charge may already have occurred.`); storeOperation({ ...op, state: "unknown", may_have_been_sent: true }); } }
    finally { if (valid()) setCancelling(false); }
  }
  function startCorrection() {
    if (draftRevision.current === null) { setDraft(effectiveReading(memory)); draftRevision.current = memory.revision; setCorrection(null); setNeedsReview(false); setReviewReady(false); setReviewed(false); setError(""); }
    else if (draftRevision.current !== memory.revision) { setNeedsReview(true); setReviewReady(false); setReviewed(false); }
    setNotice(""); setPanel("correct");
  }
  async function saveCorrection() {
    if (working || blocked || !eligible(memory) || !memory.reading || (needsReview && (!reviewReady || !reviewed))) return;
    const valid = guard(); const intent = correction ?? { operationId: crypto.randomUUID(), revision: memory.revision, text: draft }; setCorrection(intent); setWorking(true); setError("");
    try { const result = await vault.correctReading(session, memory.id, intent.revision, intent.operationId, intent.text); if (valid()) { onSaved(result); draftRevision.current = null; setCorrection(null); setNeedsReview(false); setPanel("reading"); setNotice("Your reading correction is saved in the vault."); } }
    catch (e) { if (valid()) { setError(message(e)); setNeedsReview(true); setReviewReady(false); setReviewed(false); } }
    finally { if (valid()) setWorking(false); }
  }
  async function reloadCorrection() {
    const valid = guard(); setWorking(true); setError(""); setReviewReady(false); setReviewed(false);
    try { const rows = await vault.list(session, "", true); if (!valid()) return; const latest = rows.find(m => m.id === memory.id); if (!latest) throw new Error("This memory is unavailable. Your reading draft is retained."); onSaved(latest); if (!eligible(latest) || !latest.reading) throw new Error(latest.conflict || "This memory cannot accept a reading correction. Your draft is retained."); setReviewReady(true); }
    catch (e) { if (valid()) setError(message(e)); }
    finally { if (valid()) setWorking(false); }
  }
  const showCorrection = panel === "correct" || (!memory.reading && draftRevision.current !== null);
  const pending = operation && unfinished(operation);
  const canRead = eligible(memory) && !blocked && capability?.enabled && operationsReady && !working && !cancelling && !pending;
  return <section hidden={!visible || !active} className="local-photo-reading" aria-label="Photo reading">
    {notice && operation?.state !== "committed" && <p role="status">{notice}</p>}{error && <p role="alert" className="local-error">{error}</p>}
    {capability && !capability.enabled && <p className="local-muted">Claude reading is not connected on this device. {capability.explanation} Your photos, notes and local search remain available.</p>}
    {operation && <section className="local-reading-operation" aria-label="Reading status"><p role="status">{working && panel !== "correct" ? "Reading this photo with Claude…" : operation.state === "cancelled" ? "Cancelled locally" : operation.state === "committed" ? notice || "Reading saved in your vault." : `Reading status: ${operation.state}`}</p>{operation.state === "committed" ? <p className="local-muted">This photo was processed with Claude. Your original remains in the local vault.</p> : operation.may_have_been_sent && <p className="local-muted">This photo may already have been sent to the private service and Claude. Cancellation cannot promise to stop processing or a charge.</p>}{operation.error_code && <p className="local-muted">{operation.error_code}</p>}
      {pending && <><p className="local-muted">Retry or recovery may resend this photo if the service has no receipt, using the same operation. In-flight or unknown provider work is not submitted again. A retained complete receipt can be saved locally without another upload.</p><div className="local-actions"><button disabled={working || cancelling || blocked || (operation.state !== "ready" && !capability?.enabled) || !operationsReady} onClick={() => void read(true)}>Retry or recover reading</button><button disabled={cancelling} onClick={() => void cancel()}>{cancelling ? "Cancelling…" : "Cancel reading"}</button></div></>}
    </section>}
    {panel === "consent" ? <section className="local-review" aria-label="Claude reading consent"><h2 ref={heading} tabIndex={-1}>Send this photo for a reading?</h2><p><strong>{memory.source_name}</strong></p><p>Only this selected photo will be sent to your configured private service and Claude for full-page vision reading. Your original stays in the vault. The machine reading may be wrong.</p><p>After sending, cancellation may not stop processing or a charge. Your correction will take precedence over later machine readings.</p><div className="local-actions"><button className="local-primary" disabled={!canRead} onClick={() => void read()}>Send this photo to Claude</button><button onClick={() => { returnConsentFocus.current = true; setPanel("reading"); }}>Keep it local</button></div></section>
      : <div className="local-actions"><button ref={readingTrigger} disabled={!canRead || panel === "correct"} onClick={() => { setError(""); setNotice(""); setPanel("consent"); }}>Read this photo with Claude</button>{memory.reading && <button disabled={!eligible(memory) || blocked || working || Boolean(pending) || panel === "correct"} onClick={startCorrection}>Correct reading</button>}</div>}
    {(memory.reading || showCorrection) && <div className="local-reading-comparison"><div className="local-reading-understanding">{memory.reading ? <ReadingText reading={memory.reading} /> : <p className="local-muted">The current reading is unavailable. Your correction draft remains here for review or copying.</p>}
      {showCorrection && <section className="local-review" aria-label="Correct the photo reading"><h2 ref={heading} tabIndex={-1}>Correct the reading</h2><p>Your original, machine proposal and earlier corrections remain in the vault. Your annotation is separate.</p>{needsReview && <><p>Your reading draft is retained. Reload the current reading before resolving this attempt.</p><button disabled={working} onClick={() => void reloadCorrection()}>Reload latest reading</button>{reviewReady && <><p>Current reading · revision {memory.revision}</p><label><input type="checkbox" checked={reviewed} onChange={e => { setReviewed(e.target.checked); if (e.target.checked) setCorrection(null); }} />I reviewed the latest reading</label></>}</>}<label htmlFor="reading-correction">Your reading correction</label><textarea id="reading-correction" value={draft} readOnly={Boolean(correction) || !eligible(memory) || !memory.reading} onChange={e => setDraft(e.target.value)} /><div className="local-actions"><button className="local-primary" disabled={working || blocked || !eligible(memory) || !memory.reading || (needsReview && (!reviewReady || !reviewed))} onClick={() => void saveCorrection()}>Save reading correction</button><button disabled={working} onClick={() => setPanel("reading")}>Back to reading</button></div></section>}
    </div><div className="local-reading-evidence"><h2>Original photo</h2>{sourceError && <p role="alert" className="local-error">{sourceError}</p>}{source && memory.reading && eligible(memory) && <figure className="local-artifact"><img src={source} alt="Original photo for comparison" onLoad={() => setDecoded(true)} onError={() => { releaseSource(); setSourceError("Original unavailable: this image could not be decoded."); onSaved({ ...memory, state: "conflict", conflict: "Original image could not be decoded" }); }} />{decoded && <figcaption>Original bytes unchanged · hash checked by this device. This does not verify the reading’s claims.</figcaption>}</figure>}{!source && !sourceError && eligible(memory) && memory.reading && <p role="status">Loading the original photo…</p>}{(!eligible(memory) || !memory.reading) && <p className="local-muted">Original evidence is unavailable for the current memory state.</p>}</div></div>}
  </section>;
}
