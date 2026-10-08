import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LocalVault, VaultMemory, VaultRevision, VaultStatus } from "../platform/local-vault";
import "./local.css";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type Selected = VaultStatus & { root: string; vault_id: string; vault_identity: string };
function isSelected(s: VaultStatus): s is Selected { return Boolean(s.root && s.vault_id && s.vault_identity); }
type Intent = { operationId: string; note: string };
type CorrectionIntent = Intent & { expectedRevision: number };
type HomeView = { q: string; removed: boolean; resetQuery: boolean };
type Decision = { kind: "remove" | "restore"; operationId: string; expectedRevision: number; expectedState: "active" | "missing" };
function eligible(m: VaultMemory) { return m.revision > 0 && m.state === "active" && !m.conflict; }
function decidable(m: VaultMemory) { return m.revision > 0 && (m.state === "missing" || eligible(m)); }
function stateLabel(m: VaultMemory) {
  if (m.state === "deleted") return "Removed from Recall · files retained";
  if (m.state === "missing") return "Markdown note missing · decision needed";
  return eligible(m) ? "Saved in vault · This device only" : "Needs attention · evidence unavailable";
}
function receipt(m: VaultMemory, action: "capture" | "correct" | "restore" | "remove") {
  if (m.state === "deleted") return action === "remove" ? stateLabel(m) : "This memory is already removed · files retained";
  if (m.state === "missing") return "Current memory has a missing Markdown note · decision needed";
  if (!eligible(m)) return "Current memory needs attention · evidence unavailable";
  return action === "restore" ? "Note restored in vault · This device only" : action === "remove" ? "Current memory remains active · review before removing" : action === "correct" ? "Correction saved in vault · This device only" : stateLabel(m);
}
function project(rows: VaultMemory[], removed: boolean, q: string) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(m => removed ? m.state === "deleted" : m.state !== "deleted" && (!terms.length || eligible(m) && terms.every(term => [m.note, m.source_name, m.note_path ?? ""].some(text => text.toLowerCase().includes(term)))));
}
function intentKey(s: Selected) { return `recall.local.capture:${JSON.stringify([s.root, s.vault_identity])}`; }
function restore(s: Selected): Intent | null {
  const raw = localStorage.getItem(intentKey(s));
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error("Pending import could not be read. Your vault has not been changed. Capture is blocked; retain this app’s local storage for recovery."); }
  if (!data || typeof data !== "object" || !("operationId" in data) || !("note" in data) || typeof data.operationId !== "string" || !/^[a-f0-9-]{36}$/i.test(data.operationId) || typeof data.note !== "string") throw new Error("Pending import could not be read. Your vault has not been changed.");
  return { operationId: data.operationId, note: data.note };
}

export function LocalVaultApp({ vault }: { vault: LocalVault }) {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [error, setError] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(0);
  useEffect(() => {
    if (!vault.available) return;
    let alive = true;
    const g = generationRef.current;
    vault.status().then(s => { if (alive && g === generationRef.current) setStatus(s); }, e => { if (alive && g === generationRef.current) setError(message(e)); });
    return () => { alive = false; };
  }, [vault]);
  async function select() {
    const g = ++generationRef.current; setGeneration(g); setSelecting(true); setError("");
    try { const next = await vault.select(); if (g === generationRef.current && next) setStatus(next); }
    catch (e) { if (g === generationRef.current) setError(message(e)); }
    finally { if (g === generationRef.current) setSelecting(false); }
  }
  return <main className="local-surface">
    <header className="local-header"><a className="local-wordmark" href="/">recall<span aria-hidden="true">.</span></a><span>This device only</span>{status && isSelected(status) && <button disabled={selecting} onClick={() => void select()}>Switch vault</button>}</header>
    {error && <p role="alert" className="local-error">{error}</p>}
    {!vault.available ? <section className="local-glass local-welcome"><p className="local-eyebrow">Your memory, close at hand</p><h1>A place for what matters.</h1><p>Open the Recall desktop app to choose a vault and save original photos on this device.</p><p>This browser preview cannot read or save a native vault. No memories are stored here.</p></section>
      : status && isSelected(status) ? <VaultSurface key={status.vault_id} vault={vault} selected={status} generation={generation} active={!selecting} />
      : <section className="local-glass local-welcome"><p className="local-eyebrow">Your memory, close at hand</p><h1>A place for what matters.</h1><p>Keep your original photos and notes in a folder you own. Open it in Obsidian whenever you like.</p><p>Choose an existing vault, or create an empty folder in the native folder picker. Recall adds its own Recall folder inside.</p><button className="local-primary" disabled={selecting} onClick={() => void select()}>Choose vault</button>{!status && !error && <p role="status">Checking this device…</p>}<p className="local-muted">No account needed. No cloud connection.</p></section>}
    {selecting && <p role="status">Choose a vault in the native folder picker…</p>}
  </main>;
}

function VaultSurface({ vault, selected, generation, active }: { vault: LocalVault; selected: Selected; generation: number; active: boolean }) {
  const [items, setItems] = useState<VaultMemory[]>([]);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [removed, setRemoved] = useState(false);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<VaultMemory | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision | null>>({});
  const [intentReady, setIntentReady] = useState(false);
  const [intentError, setIntentError] = useState("");
  const epoch = useRef(0);
  const listRequest = useRef(0);
  const hasLoaded = useRef(false);
  const renderedView = useRef<HomeView>({ q: "", removed: false, resetQuery: false });
  const requestedView = useRef<HomeView>(renderedView.current);
  const homeFocus = useRef<HTMLInputElement>(null);
  // Ref is updated during render so late work cannot land between a switch and effect cleanup.
  const context = useRef({ generation, active }); context.current = { generation, active };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  function guard() { const e = epoch.current; const g = generation; return () => alive.current && context.current.active && context.current.generation === g && epoch.current === e; }
  async function refresh(q: string, showRemoved = removed, rebuild = false, resetQuery = false) {
    requestedView.current = { q, removed: showRemoved, resetQuery };
    const valid = guard(); const request = ++listRequest.current; setLoading(true); setError(""); if (rebuild) setNotice("");
    try {
      const rows = rebuild ? await vault.rebuild(selected.vault_id, true) : await vault.list(selected.vault_id, showRemoved ? "" : q, showRemoved);
      if (valid() && request === listRequest.current) { renderedView.current = requestedView.current = { q, removed: showRemoved, resetQuery: false }; hasLoaded.current = true; setItems(project(rows, showRemoved, q)); setRemoved(showRemoved); setSearched(q); if (resetQuery) setQuery(q); setStale(false); if (rebuild) setNotice("Local keyword search rebuilt from validated vault records."); }
    }
    catch (e) { if (valid() && request === listRequest.current) { setStale(hasLoaded.current); setError(message(e)); } }
    finally { if (valid() && request === listRequest.current) setLoading(false); }
  }
  function publishMemory(m: VaultMemory) {
    // An accepted current state supersedes every list snapshot requested before it.
    listRequest.current++; setLoading(false); setNotice("");
    const view = renderedView.current;
    setItems(rows => project(rows.map(r => r.id === m.id ? m : r), view.removed, view.q));
  }
  useEffect(() => {
    try { const restored = restore(selected); setPending(restored); if (restored) { setDraft(restored.note); setCaptureOpen(true); } setIntentReady(true); }
    catch (e) { setIntentError(message(e)); }
  }, [selected]);
  useEffect(() => {
    epoch.current++; setBusy(false);
    if (active) { const view = requestedView.current; void refresh(view.q, view.removed, false, view.resetQuery); }
    // Selection changes invalidate every in-flight operation; vault and selected are fixed by the keyed session.
  }, [generation, active]);
  async function capture() {
    const valid = guard(); setBusy(true); setError(""); setNotice("");
    const intent = pending ?? { operationId: crypto.randomUUID(), note: draft };
    try {
      localStorage.setItem(intentKey(selected), JSON.stringify(intent)); setPending(intent);
      const saved = await vault.capture(selected.vault_id, intent.operationId, intent.note);
      if (!valid()) return;
      localStorage.removeItem(intentKey(selected)); setPending(null);
      if (saved) { setDraft(""); setCaptureOpen(false); publishMemory(saved); setNotice(receipt(saved, "capture")); const view = requestedView.current; await refresh(view.q, view.removed, false, view.resetQuery); }
      else setNotice("Photo selection cancelled. Your note is still here.");
    } catch (e) { if (valid()) setError(message(e)); }
    finally { if (valid()) setBusy(false); }
  }
  function abandon() {
    try { localStorage.removeItem(intentKey(selected)); setPending(null); setError(""); setNotice("Previous import intent abandoned. Any committed memory remains in your vault. Review all memories before importing again."); }
    catch (e) { setError(message(e)); }
  }
  function back() { setFocus(null); requestAnimationFrame(() => homeFocus.current?.focus()); }
  if (focus) return <MemoryFocus active={active} generation={generation} key={focus.id} vault={vault} selected={selected} initial={focus} snapshotStale={stale} decision={decisions[focus.id] ?? null} setDecision={d => setDecisions(previous => ({ ...previous, [focus.id]: d }))} onBack={back} onSaved={m => { publishMemory(m); setFocus(m); }} />;
  return <div className="local-home" hidden={!active}>
    <section className="local-intro"><p className="local-eyebrow">Your Memory Surface</p><h1>What would you like to remember?</h1><p>Find your way back to a note, and the original behind it.</p></section>
    <form hidden={removed} className="local-search local-glass" onSubmit={e => { e.preventDefault(); void refresh(query); }}><label htmlFor="local-search">Search notes and filenames</label><div className="local-row"><input ref={homeFocus} id="local-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="A word you remember…" /><button type="submit">Search</button></div><p className="local-muted">Local keyword search of your notes and filenames. Handwriting in photos is not searched.</p></form>
    <div className="local-actions"><button className="local-primary" onClick={() => setCaptureOpen(true)}>Capture</button><button onClick={() => { void refresh("", false, false, true); }}>All memories / refresh</button><button aria-pressed={removed} onClick={() => void refresh(searched, true)}>Removed items</button><button disabled={loading} onClick={() => void refresh(searched, removed, true)}>Rebuild local search</button></div>
    {intentError && <p role="alert" className="local-error">{intentError}</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="local-error">{error}</p>}
    {captureOpen && <section className="local-glass local-capture" aria-label="Capture a photo"><h2>{pending ? "Pending import" : "Keep an original"}</h2><p>Import one PNG, JPEG or WebP photo. Add your own context if you like.</p><label htmlFor="capture-note">Context or note (optional)</label><textarea id="capture-note" value={draft} readOnly={Boolean(pending)} onChange={e => setDraft(e.target.value)} /><p className="local-muted">A human annotation linked to the photo; not OCR or a verified source fact.</p>{pending && <p>The submitted note is held unchanged for a safe retry. A retry first checks whether this import already committed.</p>}<div className="local-actions"><button className="local-primary" disabled={busy || !intentReady} onClick={() => void capture()}>{busy ? "Saving…" : pending ? "Retry pending import" : "Choose photo & save"}</button>{pending && <button disabled={busy} onClick={abandon}>Abandon pending intent & edit note</button>}<button disabled={busy} onClick={() => setCaptureOpen(false)}>Close capture</button></div></section>}
    {!captureOpen && pending && <button onClick={() => { setCaptureOpen(true); void capture(); }} disabled={busy}>Retry pending import</button>}
    <section className="local-recent" aria-label="Memories"><h2>{removed ? "Removed items" : searched ? "Matching memories" : "Recent memory"}</h2>{stale && <p className="local-error" role="status">Previously loaded results · not currently verified. Opened evidence and changes require fresh vault validation.</p>}{removed && <p className="local-muted">Removed from active recall. Original photos, Markdown files and history are retained. There is no in-app undo.</p>}{loading ? <p role="status">Reading your vault…</p> : !items.length ? <p>{removed ? "No removed items." : searched ? "No matching notes or filenames. Try another word, or return to all memories." : error ? "Your vault could not be read. Try refreshing or choose another vault." : "Nothing captured yet"}</p> : <ul>{items.map(m => <li key={m.id}><button className="local-memory" onClick={() => setFocus(m)}><span className="local-paper" aria-hidden="true">▤</span><span><strong>{m.revision === 0 ? "Memory needs attention" : m.note || m.source_name}</strong><small>{stateLabel(m)}</small></span><span aria-hidden="true">›</span></button></li>)}</ul>}</section>
    <footer className="local-vault-location">Vault <span>{selected.root}</span></footer>
  </div>;
}

function MemoryFocus({ vault, selected, initial, onBack, onSaved, active, generation, decision, setDecision, snapshotStale }:  { active: boolean; generation: number; vault: LocalVault; selected: Selected; initial: VaultMemory; snapshotStale: boolean; decision: Decision | null; setDecision: (d: Decision | null) => void; onBack: () => void; onSaved: (m: VaultMemory) => void }) {
  const [memory, setMemory] = useState(initial);
  const [view, setView] = useState<"note" | "original" | "history" | "correct" | "remove">("note");
  const [error, setError] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [decoded, setDecoded] = useState(false);
  const [history, setHistory] = useState<VaultRevision[]>([]);
  const [draft, setDraft] = useState(initial.note);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CorrectionIntent | null>(null);
  const [unverified, setUnverified] = useState(snapshotStale);
  const [decisionReviewed, setDecisionReviewed] = useState(false);
  const [notice, setNotice] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const epoch = useRef(0);
  const context = useRef({ generation, active }); context.current = { generation, active };
  function guard() {
    const e = epoch.current; const g = generation;
    return () => e === epoch.current && context.current.generation === g && context.current.active;
  }
  const artifact = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  function clearOriginal() { if (artifact.current) URL.revokeObjectURL(artifact.current); artifact.current = null; setUrl(null); setDecoded(false); }
  useEffect(() => { heading.current?.focus(); return () => { epoch.current++; if (artifact.current) URL.revokeObjectURL(artifact.current); }; }, []);
  useLayoutEffect(() => { if (active) heading.current?.focus(); }, [view, active]);
  useLayoutEffect(() => {
    epoch.current++;
    if (!active) {
      clearOriginal(); setHistory([]); setBusy(false);
      if (view === "original" || view === "history") setView("note");
      if (busy && decision) { setDecisionReviewed(false); setError("Vault selection interrupted this attempt. The decision is retained; retry the same operation or reload current state before a new decision."); }
      if (busy && view === "correct") {
        setNeedsReview(true); setRefreshed(false); setAcknowledged(false);
        setError("Vault selection interrupted this attempt. Your draft is retained; reload the latest note to check whether it committed.");
      }
    }
    // Preserve drafts and completed review state until selection actually changes the keyed vault session.
  }, [generation, active]);
  function navigate(next: typeof view) { epoch.current++; clearOriginal(); setError(""); setBusy(false); setView(next); }
  async function original() {
    navigate("original"); const valid = guard(); setBusy(true);
    try { const source = await vault.source(selected.vault_id, memory.id); if (!valid()) return; const object = URL.createObjectURL(new Blob([new Uint8Array(source.bytes)], { type: source.mime_type })); artifact.current = object; setUrl(object); }
    catch (err) { if (valid()) { const conflict = `Original unavailable: ${message(err)}`; setError(conflict); const damaged: VaultMemory = { ...memory, state: "conflict", conflict }; setMemory(damaged); onSaved(damaged); } }
    finally { if (valid()) setBusy(false); }
  }
  async function showHistory() {
    navigate("history"); const valid = guard(); setHistory([]); setBusy(true);
    try { const result = await vault.history(selected.vault_id, memory.id); if (valid()) setHistory(result); }
    catch (err) { if (valid()) setError(message(err)); }
    finally { if (valid()) setBusy(false); }
  }
  async function correct() {
    const valid = guard(); const intent = pending ?? { operationId: crypto.randomUUID(), note: draft, expectedRevision: memory.revision }; setPending(intent); setBusy(true); setError("");
    try { const result = await vault.correct(selected.vault_id, memory.id, intent.expectedRevision, intent.operationId, intent.note); if (!valid()) return; setMemory(result); setUnverified(false); setPending(null); setNeedsReview(false); setRefreshed(false); setAcknowledged(false); onSaved(result); navigate("note"); setNotice(receipt(result, "correct")); }
    catch (err) { if (valid()) { setError(message(err)); setNeedsReview(true); setRefreshed(false); setAcknowledged(false); } }
    finally { if (valid()) setBusy(false); }
  }
  async function reload() {
    const valid = guard(); setBusy(true); setError(""); setRefreshed(false); setAcknowledged(false);
    try { const result = await vault.list(selected.vault_id, "", true); if (!valid()) return; const latest = result.find(m => m.id === memory.id); if (!latest) throw new Error("This memory is unavailable. Your correction is retained."); setMemory(latest); setUnverified(false); onSaved(latest); if (!eligible(latest)) throw new Error(latest.conflict || "This memory is unavailable. Your correction is retained."); setRefreshed(true); }
    catch (err) { if (valid()) setError(message(err)); }
    finally { if (valid()) setBusy(false); }
  }
  async function lifecycle(kind: Decision["kind"]) {
    if (!decision && !decidable(memory)) return;
    const intent = decision ?? { kind, operationId: crypto.randomUUID(), expectedRevision: memory.revision, expectedState: memory.state as "active" | "missing" };
    setDecision(intent); setDecisionReviewed(false); const valid = guard(); setBusy(true); setError(""); setNotice("");
    try {
      const result = intent.kind === "remove" ? await vault.remove(selected.vault_id, memory.id, intent.expectedRevision, intent.operationId, intent.expectedState) : await vault.restoreNote(selected.vault_id, memory.id, intent.expectedRevision, intent.operationId);
      if (!valid()) return;
      setMemory(result); setUnverified(false); onSaved(result); setDecision(null); navigate("note"); setNotice(receipt(result, intent.kind));
    } catch (err) { if (valid()) setError(message(err)); }
    finally { if (valid()) setBusy(false); }
  }
  async function reloadDecision() {
    const valid = guard(); setBusy(true); setError(""); setDecisionReviewed(false);
    try {
      const rows = await vault.list(selected.vault_id, "", true); if (!valid()) return;
      const latest = rows.find(m => m.id === memory.id);
      if (!latest) throw new Error("Current state could not be validated. The previous decision is retained.");
      setMemory(latest); setUnverified(false); onSaved(latest);
      if (latest.revision === 0) throw new Error("Current state could not be validated. The previous decision is retained.");
      setDecisionReviewed(true);
    } catch (err) { if (valid()) setError(message(err)); }
    finally { if (valid()) setBusy(false); }
  }
  function newDecision() { setDecision(null); setDecisionReviewed(false); setError(""); setNotice(""); }
  return <section hidden={!active} className={`local-focus local-glass local-${view}`}><button className="local-back" onClick={() => view === "note" ? onBack() : navigate("note")}>{view === "note" ? "Back to memories" : "Back to note"}</button><p className="local-eyebrow">{view === "original" ? "Original evidence" : view === "history" ? "Memory over time" : view === "correct" ? "Human correction" : "A moment, kept"}</p><h1 ref={heading} tabIndex={-1}>{view === "original" ? memory.source_name : view === "history" ? "Note history" : view === "correct" ? "Correct your note" : memory.revision === 0 ? "Memory needs attention" : memory.source_name}</h1>
    {notice && notice !== stateLabel(memory) && <p role="status">{notice}</p>}{error && <p role="alert" className="local-error">{error}</p>}{busy && <p role="status">{view === "correct" ? "Working in your vault…" : "Reading your vault…"}</p>}
    {view === "note" && <>{unverified && <p className="local-error" role="status">Previously loaded memory · current state not verified</p>}<p className="local-muted">{stateLabel(memory)}</p>{memory.conflict && <p role="alert" className="local-error">{memory.conflict}</p>}{memory.revision > 0 && <><p className="local-note">{memory.note || "No note added."}</p><p className="local-muted">Your human annotation, not a verified claim from the photo.</p><p className="local-muted">Captured {memory.captured_at} · Revision {memory.revision}</p>{memory.note_path && <p className="local-muted">{memory.note_path}</p>}</>}
      {decision ? <section className="local-review"><h2>Pending {decision.kind === "remove" ? "removal" : "restore"} decision</h2><p>The revision, state and operation are held unchanged for a safe retry.</p><button disabled={busy} onClick={() => void lifecycle(decision.kind)}>Retry same {decision.kind === "remove" ? "removal" : "restore"}</button><button disabled={busy} onClick={() => void reloadDecision()}>Reload current state</button>{decisionReviewed && <><p>Current state · {memory.state} · revision {memory.revision}</p><button disabled={busy || !decidable(memory)} onClick={() => { newDecision(); if (decision.kind === "remove") navigate("remove"); }}>Review a new {decision.kind === "remove" ? "removal" : "restore"} decision</button><button disabled={busy} onClick={newDecision}>Keep current state &amp; close decision</button></>}</section> : null}
      <div className="local-actions"><button disabled={!eligible(memory) || busy || Boolean(decision)} onClick={() => void original()}>View original</button><button disabled={memory.revision === 0 || (memory.state === "conflict") || busy || Boolean(decision)} onClick={() => void showHistory()}>History</button><button disabled={!eligible(memory) || busy || Boolean(decision)} onClick={() => navigate("correct")}>Correct note</button>{memory.state === "missing" && memory.revision > 0 && <button disabled={busy || Boolean(decision)} onClick={() => void lifecycle("restore")}>Restore missing note</button>}<button disabled={!decidable(memory) || busy || Boolean(decision)} onClick={() => navigate("remove")}>Remove from Recall</button></div></>}
    {view === "remove" && <section className="local-review" aria-label="Confirm removal"><h2>Remove this memory from Recall?</h2>{memory.state === "conflict" && memory.conflict && <p role="alert" className="local-error">{memory.conflict}</p>}<p>Your original photo, Markdown files and history remain in the vault. This removes the memory from active recall and search. There is no in-app undo.</p>{decision && <p>The submitted removal uses revision {decision.expectedRevision} and {decision.expectedState} state. Retry keeps the same operation.</p>}<div className="local-actions"><button disabled={busy || (!decision && !decidable(memory))} onClick={() => void lifecycle("remove")}>{decision ? "Retry same removal" : "Confirm removal"}</button><button disabled={busy} onClick={() => navigate("note")}>Cancel removal</button>{decision && <button disabled={busy} onClick={() => void reloadDecision()}>Reload current state</button>}</div>{decisionReviewed && <><p>Current state · {memory.state} · revision {memory.revision}</p><button disabled={busy || !decidable(memory)} onClick={newDecision}>Review a new removal decision</button><button disabled={busy} onClick={() => { newDecision(); navigate("note"); }}>Keep current state &amp; close decision</button></>}</section>}
    {view === "original" && <>{url && <figure className="local-artifact"><img src={url} alt="Original photo" onLoad={() => setDecoded(true)} onError={() => { clearOriginal(); setError("Original unavailable: this image could not be decoded. Its bytes are not proof of a readable photo."); }} />{decoded && <figcaption>Original bytes unchanged · hash checked by this device. This does not verify the note’s claims.</figcaption>}</figure>}</>}
    {view === "history" && <><p className="local-muted">Recorded revisions of human notes. These times record edits, not the events described.</p><ol className="local-history">{history.map(h => <li key={h.revision}><h2>Revision {h.revision}</h2><p className="local-note">{h.note || "No note added."}</p><small>{h.kind} · {h.origin} · {h.recorded_at}</small></li>)}</ol></>}
    {view === "correct" && <><p>Your original photo and earlier notes remain in the vault.</p>{needsReview && <section className="local-review"><h2>Review the latest note</h2><p>Your draft is retained. Reload the current vault note before choosing how to resolve this attempt.</p><p className="local-muted">{stateLabel(memory)}</p><button disabled={busy} onClick={() => void reload()}>Reload latest note</button>{refreshed && <><h3>Current note · revision {memory.revision}</h3><p className="local-note">{memory.note || "No note added."}</p><label><input type="checkbox" checked={acknowledged} onChange={e => { setAcknowledged(e.target.checked); if (e.target.checked) setPending(null); }} />I reviewed the latest note</label></>}</section>}<label htmlFor="correction">Your correction</label><textarea id="correction" value={draft} readOnly={Boolean(pending)} onChange={e => setDraft(e.target.value)} /><div className="local-actions"><button className="local-primary" disabled={busy || !eligible(memory) || (needsReview && (!refreshed || !acknowledged))} onClick={() => void correct()}>Save correction</button></div></>}
  </section>;
}
