import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { effectiveReading, effectiveTranscript, isAudioMemory, type AskCitation, type LocalVault, type RelatedMemoryLink, type VaultMemory, type VaultRevision, type VaultStatus } from "../platform/local-vault";
import { AskPanel } from "./AskPanel";
import { AudioCapture } from "./AudioCapture";
import { AudioMemory, TranscriptText } from "./AudioMemory";
import { PhotoReading, ReadingText } from "./PhotoReading";
import { AudioOrganizationSettings, AudioProposals, operationLabel, organizationEffective, organizationPollDelay, organizationSearchText, OrganizationContent, OrganizationMemory, OrganizationSettings } from "./Organization";
import "./local.css";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type Selected = VaultStatus & { root: string; vault_id: string; vault_identity: string };
function isSelected(s: VaultStatus): s is Selected { return Boolean(s.root && s.vault_id && s.vault_identity); }
type Intent = { operationId: string; note: string; kind?: "photo" | "text" | "file" };
type CorrectionIntent = Intent & { expectedRevision: number };
type HomeView = { q: string; removed: boolean; resetQuery: boolean };
type Decision = { kind: "remove" | "restore"; operationId: string; expectedRevision: number; expectedState: "active" | "missing" };
function eligible(m: VaultMemory) { return m.revision > 0 && m.state === "active" && !m.conflict; }
function decidable(m: VaultMemory) { return m.revision > 0 && (m.state === "missing" || eligible(m)); }
function stateLabel(m: VaultMemory, operation?: import("../platform/local-vault").OrganizationOperation) {
  if (m.state === "deleted") return "Removed from Recall · files retained";
  if (m.state === "missing") return "Markdown note missing · decision needed";
  if (isAudioMemory(m)) return eligible(m) ? m.audio_transcript ? m.audio_transcript.human_correction ? "Voice recording · saved on this computer · your corrected transcript" : "Voice recording · saved on this computer · machine transcript, unreviewed" : "Voice recording · saved on this computer · no transcript yet" : "Needs attention · evidence unavailable";
  return eligible(m) ? organizationEffective(m.organization) ? "AI suggestion · not confirmed" : m.reading ? "Saved in vault · Photo processed with Claude" : operationLabel(operation, m) : "Needs attention · evidence unavailable";
}
function receipt(m: VaultMemory, action: "capture" | "correct" | "restore" | "remove") {
  if (m.state === "deleted") return action === "remove" ? stateLabel(m) : "This memory is already removed · files retained";
  if (m.state === "missing") return "Current memory has a missing Markdown note · decision needed";
  if (!eligible(m)) return "Current memory needs attention · evidence unavailable";
  return action === "restore" ? "Note restored in vault · Stored on this device" : action === "remove" ? "Current memory remains active · review before removing" : action === "correct" ? "Correction saved in vault · Stored on this device" : stateLabel(m);
}
function project(rows: VaultMemory[], removed: boolean, q: string) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(m => removed ? m.state === "deleted" : m.state !== "deleted" && (!terms.length || eligible(m) && terms.every(term => [m.note, effectiveReading(m), effectiveTranscript(m) ?? "", m.reading?.human_correction === null ? machineSearchText(m) : "", organizationSearchText(m.organization), organizationSearchText(m.audio_organization), m.source_name, m.note_path ?? ""].some(text => text.toLowerCase().includes(term)))));
}
function machineSearchText(memory: VaultMemory) {
  const extraction = memory.reading?.machine.result.extraction;
  if (!extraction) return "";
  const supportedSummary = extraction.summary?.trim() && extraction.summary_evidence.some(e => e.quote.trim().length > 0) ? extraction.summary : "";
  const words = [supportedSummary];
  const fields = ["raw_text", "text", "description", "quote", "attribution_text", "temporal_text", "value_text", "due_text"];
  for (const group of [extraction.mentions, extraction.statements, extraction.action_suggestions, extraction.uncertainties, extraction.summary_evidence]) {
    for (const item of group) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      for (const key of fields) {
        const value = record[key];
        if (typeof value === "string") words.push(value);
      }
      if (Array.isArray(record.evidence)) for (const evidence of record.evidence) {
        if (!evidence || typeof evidence !== "object") continue;
        const quote = (evidence as Record<string, unknown>).quote;
        if (typeof quote === "string") words.push(quote);
      }
    }
  }
  return words.join(" ");
}
function sameRelatedLink(a: RelatedMemoryLink | undefined, b: RelatedMemoryLink) {
  return Boolean(a && a.target_memory_id === b.target_memory_id && a.label === b.label && a.source_quote === b.source_quote && a.target_quote === b.target_quote && a.note_basename === b.note_basename);
}
function textMemoryHeading(note: string) {
  const firstLine = note.split(/\r\n|\r|\n/).map(line => line.trim()).find(Boolean);
  if (!firstLine) return "Text note";
  const characters = Array.from(firstLine);
  return characters.length > 100 ? `${characters.slice(0, 99).join("")}…` : firstLine;
}
function RelatedMemories({ links, onOpen, disabled }: { links: RelatedMemoryLink[]; onOpen: (link: RelatedMemoryLink) => void; disabled: boolean }) {
  return <section className="local-related" aria-label="Related memories">
    <h2>Related memory</h2>
    <ul>{links.map((link, index) => <li key={`${link.target_memory_id}-${index}`}>
      <p className="local-muted">{link.label}</p>
      <p><strong>From this memory</strong></p><blockquote>{link.source_quote}</blockquote>
      <p><strong>From the related memory</strong></p><blockquote>{link.target_quote}</blockquote>
      <button disabled={disabled} onClick={() => onOpen(link)}>Open related memory</button>
    </li>)}</ul>
  </section>;
}
function intentKey(s: Selected) { return `recall.local.capture:${JSON.stringify([s.root, s.vault_identity])}`; }
function restore(s: Selected): Intent | null {
  const raw = localStorage.getItem(intentKey(s));
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error("Pending import could not be read. Your vault has not been changed. Capture is blocked; retain this app’s local storage for recovery."); }
  if (!data || typeof data !== "object" || !("operationId" in data) || !("note" in data) || typeof data.operationId !== "string" || !/^[a-f0-9-]{36}$/i.test(data.operationId) || typeof data.note !== "string") throw new Error("Pending import could not be read. Your vault has not been changed.");
  return { operationId: data.operationId, note: data.note, kind: "kind" in data && (data.kind === "text" || data.kind === "file") ? data.kind : "photo" };
}
function textSource(memory: VaultMemory) { return Boolean(memory.imported_text) || memory.source_name.toLowerCase().endsWith(".txt"); }
function sourceName(memory: VaultMemory) { return memory.imported_text?.original_name ?? memory.audio_source?.original_name ?? memory.source_name; }
function wavName(name: string) { return name.toLowerCase().endsWith(".wav") ? name : `${name}.wav`; }
function audioTitle(memory: VaultMemory) { return memory.audio_source?.original_name ?? "Voice recording"; }

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
    <header className="local-header"><a className="local-wordmark" href="/">recall<span aria-hidden="true">.</span></a><span>Vault on this device</span>{status && isSelected(status) && <button disabled={selecting} onClick={() => void select()}>Switch vault</button>}</header>
    {error && <p role="alert" className="local-error">{error}</p>}
    {!vault.available ? <section className="local-glass local-welcome"><p className="local-eyebrow">Your memory, close at hand</p><h1>A place for what matters.</h1><p>Open the Recall desktop app to choose a vault and save original photos on this device.</p><p>This browser preview cannot read or save a native vault. No memories are stored here.</p></section>
      : status && isSelected(status) ? <VaultSurface key={status.vault_id} vault={vault} selected={status} generation={generation} active={!selecting} />
      : <section className="local-glass local-welcome"><p className="local-eyebrow">Your memory, close at hand</p><h1>A place for what matters.</h1><p>Keep your original photos and notes in a folder you own. Open it in Obsidian whenever you like.</p><p>Choose an existing vault, or create an empty folder in the native folder picker. Recall adds its own Recall folder inside.</p><button className="local-primary" disabled={selecting} onClick={() => void select()}>Choose vault</button>{!status && !error && <p role="status">Checking this device…</p>}<p className="local-muted">No account needed. No cloud connection.</p></section>}
    {selecting && <p role="status">Choose a vault in the native folder picker…</p>}
  </main>;
}

function VaultSurface({ vault, selected, generation, active }: { vault: LocalVault; selected: Selected; generation: number; active: boolean }) {
  const [items, setItems] = useState<VaultMemory[]>([]);
  const [organizationOps, setOrganizationOps] = useState<Record<string, import("../platform/local-vault").OrganizationOperation>>({});
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [removed, setRemoved] = useState(false);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureKind, setCaptureKind] = useState<"photo" | "text">("photo");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<VaultMemory | null>(null);
  const [askCitation, setAskCitation] = useState<AskCitation | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision | null>>({});
  const [intentReady, setIntentReady] = useState(false);
  const [intentError, setIntentError] = useState("");
  const epoch = useRef(0);
  const listRequest = useRef(0);
  const hasLoaded = useRef(false);
  const renderedView = useRef<HomeView>({ q: "", removed: false, resetQuery: false });
  const requestedView = useRef<HomeView>(renderedView.current);
  const homeFocus = useRef<HTMLInputElement>(null);
  const organizationPolls = useRef(0);
  const organizationPendingSince = useRef(0);
  const [organizationObservationExpired, setOrganizationObservationExpired] = useState(false);
  // Ref is updated during render so late work cannot land between a switch and effect cleanup.
  const context = useRef({ generation, active }); context.current = { generation, active };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  function guard() { const e = epoch.current; const g = generation; return () => alive.current && context.current.active && context.current.generation === g && epoch.current === e; }
  async function refresh(q: string, showRemoved = removed, rebuild = false, resetQuery = false, processOrganization = true) {
    requestedView.current = { q, removed: showRemoved, resetQuery };
    const valid = guard(); const request = ++listRequest.current; setLoading(true); setError(""); if (rebuild) setNotice("");
    if (processOrganization && vault.processPendingOrganization) void vault.processPendingOrganization(selected.vault_id).catch(e => { if (valid()) setError(`Organization runner unavailable: ${message(e)}`); });
    try {
      const rows = rebuild ? await vault.rebuild(selected.vault_id, true) : await vault.list(selected.vault_id, showRemoved ? "" : q, showRemoved);
      if (valid() && request === listRequest.current) {
        renderedView.current = requestedView.current = { q, removed: showRemoved, resetQuery: false }; hasLoaded.current = true; setItems(project(rows, showRemoved, q)); setRemoved(showRemoved); setSearched(q); if (resetQuery) setQuery(q); setStale(false); if (rebuild) setNotice("Local keyword search rebuilt from validated vault records.");
        if (vault.organizationOperations) {
          const pairs = await Promise.all(rows.filter(m => m.state === "active" && !isAudioMemory(m)).slice(0, 30).map(async m => [m.id, await vault.organizationOperations!(selected.vault_id, m.id).catch(() => [])] as const));
          if (valid() && request === listRequest.current) setOrganizationOps(Object.fromEntries(pairs.flatMap(([id, operations]) => operations.length ? [[id, operations.at(-1)!]] : [])));
        }
      }
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
    try { const restored = restore(selected); setPending(restored); if (restored) { setDraft(restored.note); if (restored.kind !== "file") setCaptureKind(restored.kind ?? "photo"); setCaptureOpen(restored.kind !== "file"); } setIntentReady(true); }
    catch (e) { setIntentError(message(e)); }
  }, [selected]);
  useEffect(() => {
    epoch.current++; setBusy(false);
    if (active) { const view = requestedView.current; void refresh(view.q, view.removed, false, view.resetQuery); }
    // Selection changes invalidate every in-flight operation; vault and selected are fixed by the keyed session.
  }, [generation, active]);
  const pendingOrganization = Object.values(organizationOps).some(op => ["prepared", "queued", "processing"].includes(op.state));
  useEffect(() => {
    if (!pendingOrganization) { organizationPolls.current = 0; organizationPendingSince.current = 0; setOrganizationObservationExpired(false); return; }
    if (!organizationPendingSince.current) organizationPendingSince.current = Date.now();
    if (!active) return;
    if (Date.now() - organizationPendingSince.current >= 600_000) { setOrganizationObservationExpired(true); return; }
    const timer = window.setTimeout(() => {
      organizationPolls.current++;
      const view = requestedView.current; void refresh(view.q, view.removed, false, view.resetQuery, false);
    }, organizationPollDelay(organizationPolls.current));
    return () => window.clearTimeout(timer);
  }, [pendingOrganization, active, organizationOps]);
  async function capture() {
    const valid = guard(); setBusy(true); setError(""); setNotice("");
    const intent = pending ?? { operationId: crypto.randomUUID(), note: draft, kind: captureKind };
    try {
      localStorage.setItem(intentKey(selected), JSON.stringify(intent)); setPending(intent);
      const saved = intent.kind === "text" ? await vault.captureText?.(selected.vault_id, intent.operationId, intent.note) : await vault.capture(selected.vault_id, intent.operationId, intent.note);
      if (intent.kind === "text" && !vault.captureText) throw new Error("Text capture is unavailable in this vault adapter.");
      if (!valid()) return;
      localStorage.removeItem(intentKey(selected)); setPending(null);
      if (saved) { setDraft(""); setCaptureOpen(false); publishMemory(saved); setNotice(receipt(saved, "capture")); const view = requestedView.current; await refresh(view.q, view.removed, false, view.resetQuery); }
      else setNotice("Photo selection cancelled. Your note is still here.");
    } catch (e) { if (valid()) setError(message(e)); }
    finally { if (valid()) setBusy(false); }
  }
  async function importTextFile() {
    const valid = guard(); setBusy(true); setError(""); setNotice("");
    const intent = pending ?? { operationId: crypto.randomUUID(), note: "", kind: "file" as const };
    try {
      if (!vault.importTextFile) throw new Error("Text file import is unavailable in this vault adapter.");
      localStorage.setItem(intentKey(selected), JSON.stringify(intent)); setPending(intent);
      const saved = await vault.importTextFile(selected.vault_id, intent.operationId);
      if (!valid()) return;
      if (saved === null) { setNotice("File selection cancelled. The same import can be retried, or its pending intent can be abandoned."); return; }
      localStorage.removeItem(intentKey(selected)); setPending(null); setDraft(""); setCaptureOpen(false); publishMemory(saved);
      const imported = saved.imported_text;
      if (imported && (imported.semantic_characters > 30_000 || imported.semantic_bytes > 120_000)) {
        setNotice(`Saved ${sourceName(saved)} in this vault. Automatic organization was skipped because the file exceeds the 30,000-character or 120,000-byte limit; the original remains available.`);
        const view = requestedView.current; await refresh(view.q, view.removed, false, view.resetQuery); return;
      }
      let operation: import("../platform/local-vault").OrganizationOperation | undefined; let operationStatusUnknown = false;
      try { operation = (await vault.organizationOperations?.(selected.vault_id, saved.id))?.at(-1); }
      catch { operationStatusUnknown = true; }
      if (operationStatusUnknown) setNotice(`Saved ${sourceName(saved)} in this vault. Automatic organization status could not be verified; the original remains available.`);
      else if (!operation) setNotice(organizationEffective(saved.organization) ? `Saved ${sourceName(saved)} in this vault. Its organization is an unreviewed suggestion.` : `Saved ${sourceName(saved)} in this vault. Automatic organization is off; the original remains available.`);
      else if (operation.error_code === "INPUT_LIMIT_EXCEEDED") setNotice(`Saved ${sourceName(saved)} in this vault. Automatic organization was skipped because the file exceeds the 30,000-character or 120,000-byte limit; the original remains available.`);
      else if (operation.state === "queued" || operation.state === "prepared" || operation.state === "processing") setNotice(`Saved ${sourceName(saved)} in this vault. Automatic organization is ${operation.state}; the original remains available.`);
      else if (operation.state === "failed") setNotice(`Saved ${sourceName(saved)} in this vault. Automatic organization failed; the original remains available.`);
      else if (operation.state === "organized") setNotice(`Saved ${sourceName(saved)} in this vault. Organization is available as an unreviewed suggestion.`);
      else setNotice(`Saved ${sourceName(saved)} in this vault. Automatic organization status is ${operation.state}; the original remains available.`);
      const view = requestedView.current; await refresh(view.q, view.removed, false, view.resetQuery);
    } catch (e) { if (valid()) setError(message(e)); }
    finally { if (valid()) setBusy(false); }
  }
  function abandon() {
    try { localStorage.removeItem(intentKey(selected)); setPending(null); setError(""); setNotice("Previous import intent abandoned. Any committed memory remains in your vault. Review all memories before importing again."); }
    catch (e) { setError(message(e)); }
  }
  function back() { setFocus(null); requestAnimationFrame(() => homeFocus.current?.focus()); }
  async function openAskCitation(citation: AskCitation) {
    const valid = guard(); setError("");
    const rows = await vault.list(selected.vault_id, "", false); if (!valid()) return;
    const current = rows.find(m => m.id === citation.memory_id);
    if (!current || !eligible(current) || current.revision !== citation.memory_revision || current.source_sha256 !== citation.source_sha256) throw new Error("This cited source has changed or is no longer eligible. Ask again from current vault evidence.");
    const source = await vault.source(selected.vault_id, current.id); if (!valid()) return;
    if (source.sha256 !== citation.source_sha256) throw new Error("This cited original has changed. The stale answer cannot be opened.");
    setAskCitation(citation); setFocus(current);
  }
  if (focus) return <MemoryFocus active={active} generation={generation} key={`${focus.id}:${askCitation?.citation_id ?? ""}`} vault={vault} selected={selected} initial={focus} askCitation={askCitation} snapshotStale={stale} decision={decisions[focus.id] ?? null} setDecision={d => setDecisions(previous => ({ ...previous, [focus.id]: d }))} onBack={() => { setAskCitation(null); back(); }} onSaved={m => { publishMemory(m); setFocus(m); }} />;
  return <div className="local-home" hidden={!active}>
    <section className="local-intro"><p className="local-eyebrow">Your Memory Surface</p><h1>What would you like to remember?</h1><p>Find your way back to a note, and the original behind it.</p></section>
    <div className="local-actions"><button className="local-primary" disabled={Boolean(pending)} onClick={() => { setCaptureKind("photo"); setDraft(""); setCaptureOpen(true); }}>Capture</button><button disabled={Boolean(pending)} onClick={() => { setCaptureKind("text"); setDraft(""); setCaptureOpen(true); }}>Write a note</button><button disabled={busy || !intentReady || Boolean(pending && pending.kind !== "file")} onClick={() => void importTextFile()}>{pending?.kind === "file" ? "Retry text file import" : "Import text file"}</button><button onClick={() => { void refresh("", false, false, true); }}>Refresh memories</button></div>
    {pending?.kind === "file" && !captureOpen && <section className="local-review" aria-label="Pending text file import"><h2>Pending text file import</h2><p>The operation ID is retained for this vault. Retrying can recover a completed import or reopen the native picker to select the same file.</p><div className="local-actions"><button disabled={busy} onClick={abandon}>Abandon pending import</button></div></section>}
    {!removed && <AudioCapture vault={vault} selected={selected} active={active} onChanged={() => { const view = requestedView.current; void refresh(view.q, view.removed, false, view.resetQuery, false); }} onOpen={m => setFocus(m)} />}
    <OrganizationSettings vault={vault} sessionId={selected.vault_id} vaultIdentity={selected.vault_identity} onChanged={() => { const view = requestedView.current; void refresh(view.q, view.removed, false, view.resetQuery); }} />
    <AudioOrganizationSettings vault={vault} sessionId={selected.vault_id} vaultIdentity={selected.vault_identity} onChanged={() => { const view = requestedView.current; void refresh(view.q, view.removed, false, view.resetQuery); }} />
    {captureOpen && <section className="local-glass local-capture" aria-label={captureKind === "text" ? "Write a note" : "Capture a photo"}><h2>{pending ? "Pending capture" : captureKind === "text" ? "Keep a thought" : "Keep an original"}</h2><p>{captureKind === "text" ? "Write or paste anything you want to remember." : "Import one PNG, JPEG or WebP photo. Add your own context if you like."}</p><label htmlFor="capture-note">{captureKind === "text" ? "Your note" : "Context or note (optional)"}</label><textarea id="capture-note" value={draft} readOnly={Boolean(pending)} onChange={e => setDraft(e.target.value)} />{captureKind === "photo" && <p className="local-muted">A human annotation linked to the photo; not OCR or a verified source fact.</p>}{pending && <p>The submitted content is held unchanged for a safe retry.</p>}<div className="local-actions"><button className="local-primary" disabled={busy || !intentReady || (captureKind === "text" && !draft.trim())} onClick={() => void capture()}>{busy ? "Saving…" : pending ? captureKind === "text" ? "Retry pending capture" : "Retry pending import" : captureKind === "text" ? "Save note" : "Choose photo & save"}</button>{pending && <button disabled={busy} onClick={abandon}>{captureKind === "text" ? "Abandon pending capture & edit" : "Abandon pending intent & edit note"}</button>}<button disabled={busy} onClick={() => setCaptureOpen(false)}>Close capture</button></div></section>}
    {!captureOpen && pending && pending.kind !== "file" && <button onClick={() => { setCaptureOpen(true); void capture(); }} disabled={busy}>{pending.kind === "text" ? "Retry pending capture" : "Retry pending import"}</button>}
    {intentError && <p role="alert" className="local-error">{intentError}</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="local-error">{error}</p>}
    {organizationObservationExpired && <p role="status">Organization is still waiting for an update. Automatic checks paused after ten minutes. <button type="button" onClick={() => { const view = requestedView.current; void refresh(view.q, view.removed, false, view.resetQuery, false); }}>Check processing status</button></p>}
    {!removed && <AskPanel vault={vault} selected={selected} active={active} onOpenCitation={openAskCitation} />}
    <form hidden={removed} className="local-search local-glass" onSubmit={e => { e.preventDefault(); void refresh(query); }}><label htmlFor="local-search">Search notes and filenames</label><div className="local-row"><input ref={homeFocus} id="local-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="A word you remember…" /><button type="submit">Search</button></div><p className="local-muted">Keyword search only · local notes, annotations, saved readings, voice transcripts and filenames.</p></form>
    <details className="local-tools"><summary>Memory tools</summary><div className="local-actions"><button aria-pressed={removed} onClick={() => void refresh(searched, true)}>Removed items</button><button disabled={loading} onClick={() => void refresh(searched, removed, true)}>Rebuild local search</button></div><p className="local-muted">Removed items retain their original files and history. Rebuild refreshes local keyword search from validated vault records.</p></details>
    <section className="local-recent" aria-label="Memories"><h2>{removed ? "Removed items" : searched ? "Matching memories" : "Recent memory"}</h2>{stale && <p className="local-error" role="status">Previously loaded results · not currently verified. Opened evidence and changes require fresh vault validation.</p>}{removed && <p className="local-muted">Removed items retain their original files and history. There is no in-app undo.</p>}{loading ? <p role="status">Reading your vault…</p> : !items.length ? <p>{removed ? "No removed items." : searched ? "No matching notes or filenames. Try another word, or return to all memories." : error ? "Your vault could not be read. Try refreshing or choose another vault." : "Nothing captured yet"}</p> : <ul>{items.map(m => <li key={m.id}><button className="local-memory" onClick={() => setFocus(m)}><span className="local-paper" aria-hidden="true">▤</span><span><strong>{m.revision === 0 ? "Memory needs attention" : isAudioMemory(m) ? audioTitle(m) : m.note || m.source_name}</strong><small>{stateLabel(m, organizationOps[m.id])}</small></span><span aria-hidden="true">›</span></button></li>)}</ul>}</section>
    <footer className="local-vault-location">Vault <span>{selected.root}</span></footer>
  </div>;
}

function MemoryFocus({ vault, selected, initial, askCitation, onBack, onSaved, active, generation, decision, setDecision, snapshotStale }:  { active: boolean; generation: number; vault: LocalVault; selected: Selected; initial: VaultMemory; askCitation: AskCitation | null; snapshotStale: boolean; decision: Decision | null; setDecision: (d: Decision | null) => void; onBack: () => void; onSaved: (m: VaultMemory) => void }) {
  const [memory, setMemory] = useState(initial);
  const [view, setView] = useState<"note" | "original" | "history" | "correct" | "remove">(askCitation ? "original" : "note");
  const [error, setError] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [originalText, setOriginalText] = useState<string | null>(null);
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
  function clearOriginal() { if (artifact.current) URL.revokeObjectURL(artifact.current); artifact.current = null; setUrl(null); setOriginalText(null); setDecoded(false); }
  useEffect(() => { heading.current?.focus(); return () => { epoch.current++; if (artifact.current) URL.revokeObjectURL(artifact.current); }; }, []);
  useEffect(() => { if (askCitation) void original(); }, []);
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
    try { const source = await vault.source(selected.vault_id, memory.id); if (!valid()) return; if (source.sha256 !== memory.source_sha256) throw new Error("Original hash does not match the current memory."); const bytes = new Uint8Array(source.bytes); const object = URL.createObjectURL(new Blob([bytes], { type: source.mime_type })); artifact.current = object; setUrl(object); if (textSource(memory)) setOriginalText(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
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
  async function openRelated(link: RelatedMemoryLink) {
    const valid = guard(); setBusy(true); setError(""); setNotice("");
    try {
      if (!vault.relatedMemory) throw new Error("Related memory verification is unavailable in this vault adapter.");
      const verified = await vault.relatedMemory(selected.vault_id, memory.id, link.target_memory_id); if (!valid()) return;
      if (verified.memory_id !== link.target_memory_id || verified.note_basename !== link.note_basename || verified.original.sha256 !== verified.source_sha256) throw new Error("This related memory changed or is no longer available. Refresh memories to check current evidence.");
      const latest = await vault.list(selected.vault_id, "", true); if (!valid()) return;
      const latestSource = latest.find(row => row.id === memory.id);
      const latestTarget = latest.find(row => row.id === verified.memory_id);
      if (!latestSource || !eligible(latestSource) || !organizationEffective(latestSource.organization) || !latestSource.related_context?.some(row => sameRelatedLink(row, link)) || !latestTarget || !eligible(latestTarget) || latestTarget.revision !== verified.revision || latestTarget.source_sha256 !== verified.source_sha256 || latestTarget.source_name !== verified.source_name) throw new Error("This related memory changed while it was opening. Refresh memories to check current evidence.");
      const bytes = new Uint8Array(verified.original.bytes);
      const text = textSource(latestTarget) ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : null;
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: verified.original.mime_type }));
      navigate("original");
      setMemory(latestTarget); setDraft(latestTarget.note); setUnverified(false); setPending(null);
      artifact.current = objectUrl; setUrl(objectUrl);
      setOriginalText(text);
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
  return <section hidden={!active} className={`local-focus local-glass local-${view}`}><button className="local-back" onClick={() => view === "note" ? onBack() : navigate("note")}>{view === "note" ? "Back to memories" : "Back to note"}</button><p className="local-eyebrow">{view === "original" ? "Original evidence" : view === "history" ? "Memory over time" : view === "correct" ? "Human correction" : "A moment, kept"}</p><h1 ref={heading} tabIndex={-1}>{view === "original" ? sourceName(memory) : view === "history" ? "Note history" : view === "correct" ? "Correct your note" : memory.revision === 0 ? "Memory needs attention" : isAudioMemory(memory) ? audioTitle(memory) : textSource(memory) ? textMemoryHeading(memory.note) : memory.source_name}</h1>
    {notice && notice !== stateLabel(memory) && <p role="status">{notice}</p>}{error && <p role="alert" className="local-error">{error}</p>}{busy && <p role="status">{view === "correct" ? "Working in your vault…" : "Reading your vault…"}</p>}
    {view === "note" && <>{unverified && <p className="local-error" role="status">Previously loaded memory · current state not verified</p>}{!organizationEffective(memory.organization) && <p className="local-muted">{stateLabel(memory)}</p>}{memory.context_repair_pending && <p role="status" className="local-muted">A related link changed. Recall could not update the Obsidian note.</p>}{memory.conflict && <p role="alert" className="local-error">{memory.conflict}</p>}</>}
    {view === "note" && !isAudioMemory(memory) && <OrganizationMemory vault={vault} vaultId={selected.vault_id} memory={memory} active={active && !unverified} onMemory={m => { setMemory(m); setUnverified(false); onSaved(m); }} />}
    {view === "note" && !unverified && eligible(memory) && organizationEffective(memory.organization) && Boolean(memory.related_context?.length) && <RelatedMemories links={memory.related_context!} onOpen={link => void openRelated(link)} disabled={busy || Boolean(decision)} />}
    {!textSource(memory) && !isAudioMemory(memory) && (!organizationEffective(memory.organization) || memory.reading) && <PhotoReading vault={vault} session={selected.vault_id} memory={memory} active={active} visible={view === "note"} generation={generation} blocked={busy || Boolean(decision) || unverified} organizationBlocked={organizationEffective(memory.organization)} onSaved={m => { setMemory(m); setUnverified(false); onSaved(m); }} />}
    {view === "note" && <div>{memory.revision > 0 && <div>{isAudioMemory(memory) ? <AudioMemory vault={vault} session={selected.vault_id} memory={memory} active={active && !unverified} generation={generation} blocked={busy || Boolean(decision) || unverified} onMemory={m => { setMemory(m); setUnverified(false); onSaved(m); }} /> : <><p className="local-note">{memory.note || "No note added."}</p><p className="local-muted">{memory.imported_text ? "Imported source shown as inert plain text; Recall does not execute Markdown or frontmatter." : textSource(memory) ? "Your original note, saved as written." : "Your human annotation, not a verified claim from the photo."}</p></>}<p className="local-muted">Captured {memory.captured_at}</p><details className="local-tools"><summary>Note details</summary><p className="local-muted">Revision {memory.revision}</p><p className="local-muted">Original file · {sourceName(memory)}</p>{memory.imported_text && <p className="local-muted">Imported text · {memory.imported_text.semantic_characters.toLocaleString()} characters, {memory.imported_text.semantic_bytes.toLocaleString()} UTF-8 bytes · {memory.imported_text.source_media_type}</p>}{memory.note_path && <p className="local-muted">{memory.note_path}</p>}</details></div>}
      {decision ? <section className="local-review"><h2>Pending {decision.kind === "remove" ? "removal" : "restore"} decision</h2><p>The revision, state and operation are held unchanged for a safe retry.</p><button disabled={busy} onClick={() => void lifecycle(decision.kind)}>Retry same {decision.kind === "remove" ? "removal" : "restore"}</button><button disabled={busy} onClick={() => void reloadDecision()}>Reload current state</button>{decisionReviewed && <><p>Current state · {memory.state} · revision {memory.revision}</p><button disabled={busy || !decidable(memory)} onClick={() => { newDecision(); if (decision.kind === "remove") navigate("remove"); }}>Review a new {decision.kind === "remove" ? "removal" : "restore"} decision</button><button disabled={busy} onClick={newDecision}>Keep current state &amp; close decision</button></>}</section> : null}
      <div className="local-actions"><button disabled={!eligible(memory) || busy || Boolean(decision)} onClick={() => void original()}>View original</button><button disabled={memory.revision === 0 || (memory.state === "conflict") || busy || Boolean(decision)} onClick={() => void showHistory()}>History</button>{!isAudioMemory(memory) && <button disabled={!eligible(memory) || busy || Boolean(decision)} onClick={() => navigate("correct")}>Correct note</button>}{memory.state === "missing" && memory.revision > 0 && <button disabled={busy || Boolean(decision)} onClick={() => void lifecycle("restore")}>Restore missing note</button>}<button disabled={!decidable(memory) || busy || Boolean(decision)} onClick={() => navigate("remove")}>Remove from Recall</button></div></div>}
    {view === "remove" && <section className="local-review" aria-label="Confirm removal"><h2>Remove this memory from Recall?</h2>{memory.state === "conflict" && memory.conflict && <p role="alert" className="local-error">{memory.conflict}</p>}<p>{isAudioMemory(memory) ? "Your original recording, transcripts, Markdown files and history remain in the vault." : textSource(memory) ? "The original text, Markdown files and history remain in the vault." : "Your original photo, Markdown files and history remain in the vault."} This removes the memory from active recall and search. There is no in-app undo.</p>{decision && <p>The submitted removal uses revision {decision.expectedRevision} and {decision.expectedState} state. Retry keeps the same operation.</p>}<div className="local-actions"><button disabled={busy || (!decision && !decidable(memory))} onClick={() => void lifecycle("remove")}>{decision ? "Retry same removal" : "Confirm removal"}</button><button disabled={busy} onClick={() => navigate("note")}>Cancel removal</button>{decision && <button disabled={busy} onClick={() => void reloadDecision()}>Reload current state</button>}</div>{decisionReviewed && <div><p>Current state · {memory.state} · revision {memory.revision}</p><button disabled={busy || !decidable(memory)} onClick={newDecision}>Review a new removal decision</button><button disabled={busy} onClick={() => { newDecision(); navigate("note"); }}>Keep current state &amp; close decision</button></div>}</section>}
    {view === "original" && <>{askCitation && <section className="local-ask-citation" aria-label="Cited source"><p className="local-eyebrow">Cited source · {askCitation.evidence_kind === "text_source" ? "original text" : askCitation.evidence_kind === "human_note" ? "your note" : askCitation.evidence_kind === "human_reading_correction" ? "your reading correction" : askCitation.evidence_kind === "machine_audio_transcript" ? "machine transcript · unreviewed" : askCitation.evidence_kind === "human_audio_correction" ? "your transcript correction · reported" : "machine reading · unreviewed"}</p><blockquote>{askCitation.quote}</blockquote><p className="local-muted">Memory revision {askCitation.memory_revision} · original hash verified against the current vault.</p></section>}{url && <><a className="local-download" href={url} download={isAudioMemory(memory) ? wavName(sourceName(memory)) : sourceName(memory)}>Download original · {isAudioMemory(memory) ? wavName(sourceName(memory)) : sourceName(memory)}</a>{isAudioMemory(memory) ? <figure className="local-artifact"><audio controls src={url} aria-label="Original recording" /><figcaption>Original recording bytes unchanged · hash checked by this device. This does not verify what was said.</figcaption></figure> : textSource(memory) ? <><pre className="local-note" aria-label="Original text">{originalText}</pre><p className="local-muted">Original text bytes unchanged · hash checked by this device. Source content is displayed as plain text.</p></> : <figure className="local-artifact"><img src={url} alt="Original photo" onLoad={() => setDecoded(true)} onError={() => { clearOriginal(); setError("Original unavailable: this image could not be decoded. Its bytes are not proof of a readable photo."); }} />{decoded && <figcaption>Original bytes unchanged · hash checked by this device. This does not verify the note’s claims.</figcaption>}</figure>}</>}</>}
    {view === "history" && <><p className="local-muted">Recorded revisions of notes, readings and organization proposals. These times record changes, not the events described.</p><ol className="local-history">{isAudioMemory(memory) && <li><h2>Transcript</h2><TranscriptText memory={memory} /></li>}{history.map(h => <li key={h.revision}><h2>Revision {h.revision}</h2>{(h.note || !isAudioMemory(memory)) && <><p className="local-muted">Human note</p><p className="local-note">{h.note || "No note added."}</p></>}{h.reading && <ReadingText reading={h.reading} />}{h.audio_organization && <AudioProposals proposal={h.audio_organization} retained />}{h.organization && <OrganizationContent proposal={h.organization} historical={h.organization.suppressed || history.some(later => later.revision > h.revision && ["correct", "external", "reading_correction"].includes(later.kind))} />}<small>{h.kind} · {h.origin} · {h.recorded_at}</small></li>)}</ol></>}
    {view === "correct" && <><p>Your original and earlier notes remain in the vault.</p>{needsReview && <section className="local-review"><h2>Review the latest note</h2><p>Your draft is retained. Reload the current vault note before choosing how to resolve this attempt.</p><p className="local-muted">{stateLabel(memory)}</p><button disabled={busy} onClick={() => void reload()}>Reload latest note</button>{refreshed && <><h3>Current note · revision {memory.revision}</h3><p className="local-note">{memory.note || "No note added."}</p><label><input type="checkbox" checked={acknowledged} onChange={e => { setAcknowledged(e.target.checked); if (e.target.checked) setPending(null); }} />I reviewed the latest note</label></>}</section>}<label htmlFor="correction">Your correction</label><textarea id="correction" value={draft} readOnly={Boolean(pending)} onChange={e => setDraft(e.target.value)} /><div className="local-actions"><button className="local-primary" disabled={busy || !eligible(memory) || (needsReview && (!refreshed || !acknowledged))} onClick={() => void correct()}>Save correction</button></div></>}
  </section>;
}
