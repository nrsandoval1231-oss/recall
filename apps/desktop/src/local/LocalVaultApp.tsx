import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LocalVault, VaultMemory, VaultRevision, VaultStatus } from "../platform/local-vault";
import "./local.css";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type Selected = VaultStatus & { root: string; vault_id: string; vault_identity: string };
function isSelected(s: VaultStatus): s is Selected { return Boolean(s.root && s.vault_id && s.vault_identity); }
type Intent = { operationId: string; note: string };
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<VaultMemory | null>(null);
  const [intentReady, setIntentReady] = useState(false);
  const [intentError, setIntentError] = useState("");
  const epoch = useRef(0);
  const listRequest = useRef(0);
  const homeFocus = useRef<HTMLInputElement>(null);
  // Ref is updated during render so late work cannot land between a switch and effect cleanup.
  const context = useRef({ generation, active }); context.current = { generation, active };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  function guard() { const e = epoch.current; const g = generation; return () => alive.current && context.current.active && context.current.generation === g && epoch.current === e; }
  async function refresh(q: string) {
    const valid = guard(); const request = ++listRequest.current; setLoading(true); setError("");
    try { const rows = await vault.list(selected.vault_id, q); if (valid() && request === listRequest.current) { setItems(rows); setSearched(q); } }
    catch (e) { if (valid() && request === listRequest.current) { setItems([]); setError(message(e)); } }
    finally { if (valid() && request === listRequest.current) setLoading(false); }
  }
  useEffect(() => {
    try { const restored = restore(selected); setPending(restored); if (restored) { setDraft(restored.note); setCaptureOpen(true); } setIntentReady(true); }
    catch (e) { setIntentError(message(e)); }
  }, [selected]);
  useEffect(() => {
    epoch.current++; setBusy(false);
    if (active) void refresh("");
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
      if (saved) { setDraft(""); setCaptureOpen(false); setNotice("Saved in vault · This device only"); setQuery(""); await refresh(""); }
      else setNotice("Photo selection cancelled. Your note is still here.");
    } catch (e) { if (valid()) setError(message(e)); }
    finally { if (valid()) setBusy(false); }
  }
  function abandon() {
    try { localStorage.removeItem(intentKey(selected)); setPending(null); setError(""); setNotice("Previous import intent abandoned. Any committed memory remains in your vault. Review all memories before importing again."); }
    catch (e) { setError(message(e)); }
  }
  function back() { setFocus(null); requestAnimationFrame(() => homeFocus.current?.focus()); }
  if (focus) return <MemoryFocus active={active} generation={generation} key={focus.id} vault={vault} selected={selected} initial={focus} onBack={back} onSaved={m => { setFocus(m); setItems(rows => rows.map(r => r.id === m.id ? m : r)); }} />;
  return <div className="local-home" hidden={!active}>
    <section className="local-intro"><p className="local-eyebrow">Your Memory Surface</p><h1>What would you like to remember?</h1><p>Find your way back to a note, and the original behind it.</p></section>
    <form className="local-search local-glass" onSubmit={e => { e.preventDefault(); void refresh(query); }}><label htmlFor="local-search">Search notes and filenames</label><div className="local-row"><input ref={homeFocus} id="local-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="A word you remember…" /><button type="submit">Search</button></div><p className="local-muted">Local keyword search of your notes and filenames. Handwriting in photos is not searched.</p></form>
    <div className="local-actions"><button className="local-primary" onClick={() => setCaptureOpen(true)}>Capture</button><button onClick={() => { setQuery(""); void refresh(""); }}>All memories / refresh</button></div>
    {intentError && <p role="alert" className="local-error">{intentError}</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="local-error">{error}</p>}
    {captureOpen && <section className="local-glass local-capture" aria-label="Capture a photo"><h2>{pending ? "Pending import" : "Keep an original"}</h2><p>Import one PNG, JPEG or WebP photo. Add your own context if you like.</p><label htmlFor="capture-note">Context or note (optional)</label><textarea id="capture-note" value={draft} readOnly={Boolean(pending)} onChange={e => setDraft(e.target.value)} /><p className="local-muted">A human annotation linked to the photo; not OCR or a verified source fact.</p>{pending && <p>The submitted note is held unchanged for a safe retry. A retry first checks whether this import already committed.</p>}<div className="local-actions"><button className="local-primary" disabled={busy || !intentReady} onClick={() => void capture()}>{busy ? "Saving…" : pending ? "Retry pending import" : "Choose photo & save"}</button>{pending && <button disabled={busy} onClick={abandon}>Abandon pending intent & edit note</button>}<button disabled={busy} onClick={() => setCaptureOpen(false)}>Close capture</button></div></section>}
    {!captureOpen && pending && <button onClick={() => { setCaptureOpen(true); void capture(); }} disabled={busy}>Retry pending import</button>}
    <section className="local-recent" aria-label="Memories"><h2>{searched ? "Matching memories" : "Recent memory"}</h2>{loading ? <p role="status">Reading your vault…</p> : !items.length ? <p>{searched ? "No matching notes or filenames. Try another word, or return to all memories." : error ? "Your vault could not be read. Try refreshing or choose another vault." : "Nothing captured yet"}</p> : <ul>{items.map(m => <li key={m.id}><button className="local-memory" onClick={() => setFocus(m)}><span className="local-paper" aria-hidden="true">▤</span><span><strong>{m.revision === 0 ? "Memory needs attention" : m.note || m.source_name}</strong><small>{m.conflict ? "Needs attention · evidence unavailable" : "Saved in vault · This device only"}</small></span><span aria-hidden="true">›</span></button></li>)}</ul>}</section>
    <footer className="local-vault-location">Vault <span>{selected.root}</span></footer>
  </div>;
}

function MemoryFocus({ vault, selected, initial, onBack, onSaved, active, generation }: { active: boolean; generation: number; vault: LocalVault; selected: Selected; initial: VaultMemory; onBack: () => void; onSaved: (m: VaultMemory) => void }) {
  const [memory, setMemory] = useState(initial);
  const [view, setView] = useState<"note" | "original" | "history" | "correct">("note");
  const [error, setError] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [decoded, setDecoded] = useState(false);
  const [history, setHistory] = useState<VaultRevision[]>([]);
  const [draft, setDraft] = useState(initial.note);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Intent | null>(null);
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
    catch (err) { if (valid()) { const conflict = `Original unavailable: ${message(err)}`; setError(conflict); const damaged = { ...memory, conflict }; setMemory(damaged); onSaved(damaged); } }
    finally { if (valid()) setBusy(false); }
  }
  async function showHistory() {
    navigate("history"); const valid = guard(); setHistory([]); setBusy(true);
    try { const result = await vault.history(selected.vault_id, memory.id); if (valid()) setHistory(result); }
    catch (err) { if (valid()) setError(message(err)); }
    finally { if (valid()) setBusy(false); }
  }
  async function correct() {
    const valid = guard(); const intent = pending ?? { operationId: crypto.randomUUID(), note: draft }; setPending(intent); setBusy(true); setError("");
    try { const result = await vault.correct(selected.vault_id, memory.id, memory.revision, intent.operationId, intent.note); if (!valid()) return; setMemory(result); setPending(null); setNeedsReview(false); setRefreshed(false); setAcknowledged(false); onSaved(result); navigate("note"); }
    catch (err) { if (valid()) { setError(message(err)); setNeedsReview(true); setRefreshed(false); setAcknowledged(false); } }
    finally { if (valid()) setBusy(false); }
  }
  async function reload() {
    const valid = guard(); setBusy(true); setError(""); setRefreshed(false); setAcknowledged(false);
    try { const result = await vault.list(selected.vault_id, ""); if (!valid()) return; const latest = result.find(m => m.id === memory.id); if (!latest || latest.conflict || latest.revision === 0) throw new Error(latest?.conflict || "This memory is unavailable. Your correction is retained."); setMemory(latest); setRefreshed(true); }
    catch (err) { if (valid()) setError(message(err)); }
    finally { if (valid()) setBusy(false); }
  }
  return <section hidden={!active} className={`local-focus local-glass local-${view}`}><button className="local-back" onClick={() => view === "note" ? onBack() : navigate("note")}>{view === "note" ? "Back to memories" : "Back to note"}</button><p className="local-eyebrow">{view === "original" ? "Original evidence" : view === "history" ? "Memory over time" : view === "correct" ? "Human correction" : "A moment, kept"}</p><h1 ref={heading} tabIndex={-1}>{view === "original" ? memory.source_name : view === "history" ? "Note history" : view === "correct" ? "Correct your note" : memory.revision === 0 ? "Memory needs attention" : memory.source_name}</h1>
    {error && <p role="alert" className="local-error">{error}</p>}{busy && <p role="status">{view === "correct" ? "Working in your vault…" : "Reading your vault…"}</p>}
    {view === "note" && <>{memory.conflict ? <p role="alert" className="local-error">{memory.conflict}</p> : <p className="local-muted">Saved in vault · This device only</p>}{memory.revision > 0 && <><p className="local-note">{memory.note || "No note added."}</p><p className="local-muted">Your human annotation, not a verified claim from the photo.</p><p className="local-muted">Captured {memory.captured_at} · Revision {memory.revision}</p></>}<div className="local-actions"><button disabled={Boolean(memory.conflict) || memory.revision === 0} onClick={() => void original()}>View original</button><button disabled={Boolean(memory.conflict) || memory.revision === 0} onClick={() => void showHistory()}>History</button><button disabled={Boolean(memory.conflict) || memory.revision === 0} onClick={() => navigate("correct")}>Correct note</button></div></>}
    {view === "original" && <>{url && <figure className="local-artifact"><img src={url} alt="Original photo" onLoad={() => setDecoded(true)} onError={() => { clearOriginal(); setError("Original unavailable: this image could not be decoded. Its bytes are not proof of a readable photo."); }} />{decoded && <figcaption>Original bytes unchanged · hash checked by this device. This does not verify the note’s claims.</figcaption>}</figure>}</>}
    {view === "history" && <><p className="local-muted">Recorded revisions of human notes. These times record edits, not the events described.</p><ol className="local-history">{history.map(h => <li key={h.revision}><h2>Revision {h.revision}</h2><p className="local-note">{h.note || "No note added."}</p><small>{h.origin} · {h.recorded_at}</small></li>)}</ol></>}
    {view === "correct" && <><p>Your original photo and earlier notes remain in the vault.</p>{needsReview && <section className="local-review"><h2>Review the latest note</h2><p>Your draft is retained. Reload the current vault note before choosing how to resolve this attempt.</p><button disabled={busy} onClick={() => void reload()}>Reload latest note</button>{refreshed && <><h3>Current note · revision {memory.revision}</h3><p className="local-note">{memory.note || "No note added."}</p><label><input type="checkbox" checked={acknowledged} onChange={e => { setAcknowledged(e.target.checked); if (e.target.checked) setPending(null); }} />I reviewed the latest note</label></>}</section>}<label htmlFor="correction">Your correction</label><textarea id="correction" value={draft} readOnly={Boolean(pending)} onChange={e => setDraft(e.target.value)} /><div className="local-actions"><button className="local-primary" disabled={busy || (needsReview && (!refreshed || !acknowledged))} onClick={() => void correct()}>Save correction</button></div></>}
  </section>;
}
