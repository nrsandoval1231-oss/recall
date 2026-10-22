import { useEffect, useRef, useState } from "react";
import type { AskAnswer, AskCapability, AskCitation, AskOutcome, HistoryAskOutcome, HistoryCapability, HistoryCitation, HistoryEvidence, AskTemporal, IntelligencePairingStatus, LocalVault, VaultStatus } from "../platform/local-vault";
import { resolveHistoryQuestion } from "./history-question";
import { TRANSCRIPT_CAVEAT } from "./audio";

type Selected = VaultStatus & { root: string; vault_id: string; vault_identity: string };
type Intent = { operationId: string; question: string; kind?: "current" | "history"; temporal?: AskTemporal };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const key = (selected: Selected) => `recall.local.ask:${JSON.stringify([selected.root, selected.vault_identity])}`;
function readIntent(selected: Selected): Intent | null {
  const raw = localStorage.getItem(key(selected)); if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("operationId" in value) || !("question" in value) || typeof value.operationId !== "string" || !/^[a-f0-9-]{36}$/i.test(value.operationId) || typeof value.question !== "string") throw new Error("A pending Ask could not be read. Keep this app data for recovery.");
  const kind = "kind" in value && value.kind === "history" ? "history" : "current";
  const temporal = "temporal" in value && value.temporal && typeof value.temporal === "object" ? value.temporal as AskTemporal : undefined;
  if (kind === "history" && (!temporal || !["as_of", "compare_to_current"].includes(temporal.mode))) throw new Error("A historical Ask interval could not be read. Keep this app data for recovery.");
  return { operationId: value.operationId, question: value.question, kind, ...(temporal ? { temporal } : {}) };
}
function stateText(outcome: AskOutcome | null) {
  if (!outcome) return "";
  if (outcome.operation.state === "failed" && outcome.operation.error_code === "STALE_EVIDENCE") return "A source changed while Recall was answering. Your question is still here, but this answer has no sources. Review current memories, then choose a new Ask to try again.";
  if (outcome.operation.state === "unknown" || outcome.operation.state === "in_flight" || outcome.operation.state === "prepared") return "Recall has not confirmed whether this request finished. Check its status before asking again; your question is saved.";
  if (outcome.operation.state === "expired") return "This request expired and its answer is no longer available. You can start a new Ask.";
  if (outcome.operation.state === "failed") return "Recall could not finish this request. Your question is saved; start a new Ask when you’re ready.";
  return "";
}
function evidenceLabel(kind: AskCitation["evidence_kind"]) {
  return kind === "text_source" ? "Original text" : kind === "human_note" ? "Your note" : kind === "human_reading_correction" ? "Your reading correction" : kind === "machine_audio_transcript" ? "Machine transcript · unreviewed" : kind === "human_audio_correction" ? "Your transcript correction · reported" : "Machine reading · unreviewed";
}
function answerMessage(answer: AskAnswer) {
  if (answer.status === "insufficient_evidence") return "Recall could not answer confidently from the sources considered.";
  if (answer.status === "ambiguous") return "The available evidence is ambiguous.";
  if (answer.status === "stale_evidence") return "A source changed while Recall was answering. The answer was cleared; review current memory and ask again.";
  if (answer.status === "unavailable") return "Grounded Ask is unavailable. Your local keyword search remains available.";
  return "";
}
function capabilityText(capability: AskCapability | null) {
  if (!capability) return "Checking whether Ask is available for this vault…";
  if (capability.enabled) return "Ask is ready for this vault.";
  if (capability.consent === "missing") return "Ask needs a separate approval before it can send selected text for an answer. Local keyword search is still available.";
  if (capability.consent === "unknown") return "Ask availability could not be confirmed. Local keyword search is still available.";
  return "Ask is set up but unavailable right now. Local keyword search is still available.";
}
function historyCapabilityText(capability: AskCapability | null) {
  if (!capability) return "Historical Ask availability is being checked.";
  if (capability.history_consent === "active" && capability.history_enabled) return "Historical Ask is enabled for this workspace.";
  if (capability.history_consent === "active") return "Historical Ask permission is saved but the service is unavailable right now.";
  if (capability.history_consent === "missing") return "Historical Ask is off. You can keep using current Ask.";
  if (capability.history_consent === "outdated") return "Historical Ask needs a fresh workspace decision. Current Ask remains available.";
  return "Historical Ask availability could not be confirmed. Current Ask remains available.";
}
function historyLabel(item: HistoryEvidence) {
  if (item.history_status === "current_counterpart") return "Current";
  if (item.history_status === "as_of_later_corrected") return "Later corrected";
  return "Recorded then";
}
function readableDate(value: string, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date unavailable";
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "long", ...(timeZone ? { timeZone } : {}) }).format(date); }
  catch { return new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" }).format(date); }
}
function readableCalendarDate(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "date unavailable";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone }).format(date); }
  catch { return new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" }).format(date); }
}
export function HistoricalSourceView({ source, onClose }: { source: HistoryCitation; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const mime = source.original.mime_type || "application/octet-stream";
  const bytes = new Uint8Array(source.original.bytes);
  const text = mime.startsWith("text/") ? new TextDecoder().decode(bytes) : null;
  const retained = source.retained_revision; const transcript = retained.audio_transcript ?? null; const audio = mime.startsWith("audio/") || Boolean(transcript);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([bytes], { type: mime })); setUrl(next);
    return () => { URL.revokeObjectURL(next); };
  }, [source]);
  return <section className="local-history-source" aria-label="Retained historical source">
    <h3>{audio ? "Saved recording" : "Saved note"} · {readableDate(retained.recorded_at)}</h3>
    <p role="status">{source.current ? audio ? "This saved recording is still current in the vault." : "This saved note is still current in the vault." : audio ? "The vault has a newer version. This view preserves the transcript wording used for the answer." : "The vault has a newer version. This view preserves the wording used for the answer."}</p>
    <p className="local-muted">{audio ? "This is the recording and transcript saved then. The quoted excerpt below is only the passage used for the answer." : "This is the saved note or photo reading from then. The quoted excerpt below is only the passage used for the answer."}</p>
    {source.retained_revision.note && <><h4>{audio ? "Saved annotation" : "Saved human note"}</h4><pre>{source.retained_revision.note}</pre></>}
    {audio && (transcript ? transcript.human_correction ? <><h4>Your transcript correction · reported</h4><pre>{transcript.human_correction.text || "(The human correction is intentionally blank.)"}</pre><p className="local-muted">Typed by you after listening; not a verified fact.</p></> : transcript.machine.eligibility === "eligible" && transcript.machine.text.trim() ? <><h4>Machine transcript · unreviewed</h4><pre>{transcript.machine.text}</pre><p className="local-muted">{TRANSCRIPT_CAVEAT}</p></> : <p className="local-muted">No usable transcript had been saved at that point.</p> : <p className="local-muted">No transcript had been saved at that point.</p>)}
    {source.retained_revision.reading && <><h4>Saved photo reading</h4>{source.retained_revision.reading.human_correction !== null ? <><p><strong>Human reading correction</strong></p><pre>{source.retained_revision.reading.human_correction || "(The human correction is intentionally blank.)"}</pre></> : <><p><strong>Unreviewed machine transcription</strong></p>{source.retained_revision.reading.machine.result.extraction.pages.map(page => <div key={`${page.ordinal}:${page.page_id}`}><p><strong>Page {page.ordinal} · {page.legibility}</strong></p><pre>{page.transcription || "No readable transcription was retained."}</pre></div>)}</>}</>}
    {source.retained_revision.organization && <><h4>{source.retained_revision.organization.suppressed ? "Retained photo proposal · superseded" : "Retained photo interpretation · unreviewed"}</h4>{source.retained_revision.organization.suppressed && <p className="local-muted">This earlier machine proposal was later suppressed and is shown for history, not as current guidance.</p>}{source.retained_revision.organization.result.extraction.summary && <><p><strong>Summary · unreviewed</strong></p><p>{source.retained_revision.organization.result.extraction.summary}</p></>}{(source.retained_revision.organization.result.extraction.pages ?? []).map(page => <div key={`${page.ordinal}:${page.page_id}`}><p><strong>Full transcription · {page.legibility}</strong></p><pre>{page.transcription}</pre></div>)}</>}
    <h4>Quoted excerpt</h4><blockquote>{source.quote}</blockquote>
    <h4>Original file</h4>
    {text !== null ? <pre>{text}</pre> : mime.startsWith("image/") && url ? <img src={url} alt="Verified original source" /> : mime.startsWith("audio/") && url ? <audio controls src={url} aria-label="Verified original recording" /> : null}
    {url && <a href={url} download={`recall-original-${source.memory_id}${audio ? ".wav" : ""}`}>Open or download original</a>}
    <button type="button" onClick={onClose}>Close retained source</button>
  </section>;
}

export function AskPanel({ vault, selected, active, onOpenCitation }: { vault: LocalVault; selected: Selected; active: boolean; onOpenCitation: (citation: AskCitation) => Promise<void> }) {
  const [question, setQuestion] = useState("");
  const [capability, setCapability] = useState<AskCapability | null>(null);
  const [pairing, setPairing] = useState<IntelligencePairingStatus | null>(null);
  const [invitation, setInvitation] = useState("");
  const [pending, setPending] = useState<Intent | null>(null);
  const [outcome, setOutcome] = useState<AskOutcome | HistoryAskOutcome | null>(null);
  const [clarification, setClarification] = useState<{ original: string; prompt: string } | null>(null);
  const [historicalSource, setHistoricalSource] = useState<HistoryCitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const context = useRef({ selected, active }); context.current = { selected, active };
  const guards = () => { const e = epoch.current; const id = selected.vault_id; return () => e === epoch.current && context.current.active && context.current.selected.vault_id === id; };
  useEffect(() => {
    epoch.current++; setCapability(null); setPairing(null); setOutcome(null); setClarification(null); setHistoricalSource(null); setError(""); setBusy(false);
    try { const restored = readIntent(selected); setPending(restored); if (restored) setQuestion(restored.question); }
    catch (e) { setPending(null); setError(message(e)); }
    const valid = guards();
    if (vault.askCapability) vault.askCapability(selected.vault_id).then(value => { if (valid()) setCapability(value); }, e => { if (valid()) setCapability({ enabled: false, scope: "vault_intelligence", consent: "unknown", explanation: message(e) }); });
    else setCapability({ enabled: false, scope: "vault_intelligence", consent: "unknown", explanation: "This vault adapter does not support grounded Ask." });
    return () => { epoch.current++; };
  }, [vault, selected.vault_id, selected.root, selected.vault_identity]);
  function saveIntent(intent: Intent | null) {
    if (intent) localStorage.setItem(key(selected), JSON.stringify(intent)); else localStorage.removeItem(key(selected));
    setPending(intent);
  }
  async function dispatchHistory(intent: Intent, valid: () => boolean) {
    if (!intent.temporal || !vault.askHistory) throw new Error("Historical Ask is unavailable in this desktop version. Your question was not sent.");
    const value = await vault.askHistory(selected.vault_id, intent.operationId, intent.question, intent.temporal);
    if (!valid()) return;
    setOutcome(value); if (value.operation.state === "complete") saveIntent(null);
  }
  async function ask() {
    if (!capability?.enabled || !question.trim() || pending || (!vault.ask && !vault.askHistory)) return;
    const submitted = question.trim();
    const original = clarification?.original ?? submitted;
    const parsed = resolveHistoryQuestion(original, clarification ? submitted : "");
    if (parsed.kind === "clarify") {
      setClarification({ original, prompt: parsed.reason }); setQuestion(""); setOutcome(null); setHistoricalSource(null); return;
    }
    if (parsed.kind === "history" && capability.history_consent !== "active") {
      setClarification(null); setError("Historical Ask is off for this workspace. Review and enable it below, then ask again."); return;
    }
    if (parsed.kind === "history" && !capability.history_enabled) {
      setClarification(null); setError("Historical Ask is unavailable right now. Your question was not sent; current Ask remains available."); return;
    }
    if (parsed.kind === "history" && !vault.askHistory) {
      setClarification(null); setError("Historical Ask is unavailable in this desktop version. Your question was not sent."); return;
    }
    if (parsed.kind === "current" && !vault.ask) { setError("Current Ask is unavailable in this desktop version. Your question was not sent."); return; }
    const intent: Intent = { operationId: crypto.randomUUID(), question: original, kind: parsed.kind, ...(parsed.kind === "history" ? { temporal: parsed.temporal } : {}) };
    const valid = guards(); setError(""); setClarification(null); setQuestion(original); setOutcome(null); setHistoricalSource(null); saveIntent(intent); setBusy(true);
    try {
      if (intent.kind === "history") await dispatchHistory(intent, valid);
      else { if (!vault.ask) throw new Error("Current Ask is unavailable in this desktop version."); const value = await vault.ask(selected.vault_id, intent.operationId, intent.question); if (!valid()) return; setOutcome(value); if (value.operation.state === "complete") saveIntent(null); }
    }
    catch { if (valid()) { setError("Recall could not confirm whether this request finished. Your question is saved; check its status before trying again."); setOutcome({ operation: { operation_id: intent.operationId, state: "unknown", error_code: "PROVIDER_OUTCOME_UNKNOWN" }, answer: null } as AskOutcome); } }
    finally { if (valid()) setBusy(false); }
  }
  async function recover() {
    if (!pending || (pending.kind === "history" ? !vault.recoverHistoryAsk : !vault.recoverAsk)) return;
    const intent = pending; const valid = guards(); setError(""); setBusy(true);
    try { const value = intent.kind === "history" ? await vault.recoverHistoryAsk!(selected.vault_id, intent.operationId) : await vault.recoverAsk!(selected.vault_id, intent.operationId); if (!valid()) return; setOutcome(value); if (value.operation.state === "complete") saveIntent(null); }
    catch { if (valid()) { setError("Recall could not check this request yet. Your question is saved; try checking its status again."); setOutcome({ operation: { operation_id: intent.operationId, state: "unknown", error_code: "RECEIPT_RECOVERY_UNKNOWN" }, answer: null } as AskOutcome); } }
    finally { if (valid()) setBusy(false); }
  }
  async function refreshCapability() {
    if (!vault.askCapability) { setOutcome(null); setCapability({ enabled: false, scope: "vault_intelligence", consent: "unknown", explanation: "This vault adapter does not support grounded Ask." }); return; }
    const valid = guards(); setCapability(null); setOutcome(null);
    try { const value = await vault.askCapability(selected.vault_id); if (valid()) setCapability(value); }
    catch (e) { if (valid()) setCapability({ enabled: false, scope: "vault_intelligence", consent: "unknown", explanation: message(e) }); }
  }
  async function setHistoryConsent(enable: boolean) {
    if (!vault.setHistoryConsent || !capability || capability.consent !== "active" || capability.history_consent === "unknown" || capability.history_consent === undefined) return;
    const valid = guards(); setError(""); setOutcome(null); setHistoricalSource(null); setBusy(true);
    try {
      const result: HistoryCapability = await vault.setHistoryConsent(selected.vault_id, enable, capability.consent_version ?? 0);
      if (valid()) setCapability({ ...capability, history_consent: result.history_consent, history_enabled: result.history_enabled, consent_version: result.consent_version, history_policy_version: result.history_policy_version });
    } catch { if (valid()) { setError("Recall could not confirm the history decision. Refresh Ask availability before trying again."); await refreshCapability(); } }
    finally { if (valid()) setBusy(false); }
  }
  async function runPairing(action: "prepare" | "status" | "disconnect" | "claim") {
    const supported = action === "prepare" ? vault.intelligencePairingPrepare : action === "status" ? vault.intelligencePairingStatus : action === "disconnect" ? vault.intelligencePairingDisconnect : vault.intelligencePairingClaim;
    if (!supported || (action === "claim" && !invitation.trim())) return;
    const valid = guards(); setError(""); setOutcome(null); setBusy(true);
    try {
      const result = action === "prepare" ? await vault.intelligencePairingPrepare!(selected.vault_id) : action === "status" ? await vault.intelligencePairingStatus!(selected.vault_id) : action === "disconnect" ? await vault.intelligencePairingDisconnect!(selected.vault_id) : await vault.intelligencePairingClaim!(selected.vault_id, invitation.trim());
      if (valid()) { setPairing(result); if (action === "claim") setInvitation(""); await refreshCapability(); }
    } catch (e) { if (valid()) setError(message(e)); }
    finally { if (valid()) setBusy(false); }
  }
  async function openCitation(citation: AskCitation) {
    setOutcome(null); setBusy(true); setError("");
    try { await onOpenCitation(citation); }
    catch { setError("This source could not be verified, so Recall cleared the answer. Refresh current memories before asking again."); }
    finally { setBusy(false); }
  }
  async function openHistoryCitation(citationId: string) {
    if (!pending && !outcome) return;
    const operationId = outcome?.operation.operation_id ?? pending?.operationId;
    if (!operationId || !vault.askHistoryCitation) return;
    const valid = guards(); setHistoricalSource(null); setBusy(true); setError("");
    try { const value = await vault.askHistoryCitation(selected.vault_id, operationId, citationId); if (valid()) setHistoricalSource(value); }
    catch { if (valid()) { setOutcome(null); setError("This retained source or its current status changed. Recall cleared the answer; refresh the vault before asking again."); } }
    finally { if (valid()) setBusy(false); }
  }
  const answer = outcome?.answer ?? null;
  const historical = Boolean(outcome && "history_evidence" in outcome);
  const historyEvidence = outcome && "history_evidence" in outcome ? outcome.history_evidence : [];
  const retryable = Boolean(pending && ["prepared", "in_flight", "unknown"].includes(outcome?.operation.state ?? "unknown"));
  return <section className="local-glass local-ask" aria-labelledby="local-ask-title">
    <p className="local-eyebrow">Grounded recall</p><h2 id="local-ask-title">Ask your memories</h2>
    <p className="local-muted">{capabilityText(capability)}</p>
    <form onSubmit={e => { e.preventDefault(); void ask(); }}><label htmlFor="local-ask-question">Your question</label><textarea id="local-ask-question" rows={3} value={question} readOnly={Boolean(pending)} onChange={e => { setQuestion(e.target.value); setOutcome(null); setHistoricalSource(null); }} placeholder={clarification ? "Add a full date, such as October 1, 2026" : "What do you remember about…?"} />{clarification && <p role="status">{clarification.prompt} The original question is retained: “{clarification.original}”</p>}<div className="local-actions"><button className="local-primary" type="submit" disabled={busy || !capability?.enabled || !question.trim() || Boolean(pending)}>{busy ? "Asking…" : clarification ? "Continue" : "Ask"}</button>{retryable && <button type="button" disabled={busy} onClick={() => void recover()}>Check Ask status</button>}{pending && outcome && !retryable && <button type="button" disabled={busy} onClick={() => { saveIntent(null); setOutcome(null); setHistoricalSource(null); setError(""); }}>Ask a new question</button>}</div></form>
    {pending && !outcome && <p role="status">Your question is saved while Recall checks whether it finished.</p>}{outcome && stateText(outcome) && <p role="status" className="local-error">{stateText(outcome)}</p>}
    {answer && <div className="local-ask-answer" aria-label="Ask answer">{historical && outcome && "temporal" in outcome && <h3>{outcome.temporal.mode === "compare_to_current" ? "Recorded changes since" : "What was recorded on"} {readableCalendarDate(outcome.temporal.display_date, outcome.temporal.display_timezone)}</h3>}<h3>{answer.status === "answered" ? "Answer · with sources" : answer.status === "ambiguous" ? "Ambiguous evidence" : "Evidence result"}</h3>{answerMessage(answer) && <p role="status">{answerMessage(answer)}</p>}{answer.sentences.map((sentence, index) => <p key={`${index}:${sentence.text}`}>{sentence.text}{sentence.citation_ids.map(id => { const citation = answer.citations.find(item => item.citation_id === id); const historyItem = historyEvidence.find(item => item.citation_id === id); return historyItem ? <span className="local-ask-inline-source" key={id}> <button type="button" disabled={busy} onClick={() => void openHistoryCitation(id)} title={historyItem.excerpt}>Source {id.slice(1)} · {historyLabel(historyItem)}</button></span> : citation ? <span className="local-ask-inline-source" key={id}> <button type="button" disabled={busy} onClick={() => void openCitation(citation)} title={citation.quote}>Source {id.slice(1)} · {evidenceLabel(citation.evidence_kind)}</button></span> : null; })}</p>)}{historical && <ul aria-label="Historical evidence">{historyEvidence.map(item => <li key={item.citation_id}><strong>{historyLabel(item)} · {readableDate(item.recorded_at, outcome && "temporal" in outcome ? outcome.temporal.display_timezone : undefined)}</strong>{item.current_revision !== item.memory_revision && item.history_status !== "current_counterpart" && <p className="local-muted">A newer version is in the vault now.</p>}{(item.evidence_kind === "machine_audio_transcript" || item.evidence_kind === "human_audio_correction") && <p className="local-muted">{evidenceLabel(item.evidence_kind)}</p>}<p>{item.excerpt}</p><button type="button" disabled={busy} onClick={() => void openHistoryCitation(item.citation_id)}>Open saved note and original</button></li>)}</ul>}{answer.limitations.map((limitation, index) => <p className="local-muted" key={`${index}:${limitation}`}>{limitation}</p>)}{answer.coverage && <p className="local-muted">{historical ? "Historical evidence coverage" : "Current coverage"}: {answer.coverage.selected_count} of {answer.coverage.eligible_count} eligible {historical ? "items" : "records"}{answer.coverage.truncated_count ? ` · ${answer.coverage.truncated_count} excerpt${answer.coverage.truncated_count === 1 ? " was" : "s were"} shortened` : ""}.</p>}</div>}
    {historicalSource && <HistoricalSourceView source={historicalSource} onClose={() => setHistoricalSource(null)} />}
    <details className="local-tools local-ask-settings"><summary>How Ask works and sends data</summary><p className="local-muted">Current Ask uses current eligible memories. When you ask about the past, Recall can send relevant saved versions of your notes to your connected AI service. This applies to vaults you already connected in this workspace. You can turn history off anytime. Your originals stay in the vault; an answer describes what was saved then, not necessarily what was true in the world.</p>{pending && <p className="local-muted">A pending Ask is saved. Check its status or clear its terminal result before changing this setting, since changing it can make the saved receipt unavailable.</p>}{capability?.consent === "active" && capability.history_consent !== "active" && <><p className="local-muted">{historyCapabilityText(capability)}</p><button type="button" disabled={busy || Boolean(pending) || !vault.setHistoryConsent || !capability.history_consent || capability.history_consent === "unknown"} onClick={() => void setHistoryConsent(true)}>Allow questions about the past</button></>}{capability?.history_consent === "active" && <><p className="local-muted">{historyCapabilityText(capability)}</p><button type="button" disabled={busy || Boolean(pending) || !vault.setHistoryConsent} onClick={() => void setHistoryConsent(false)}>Turn off history</button></>}</details>
    <details className="local-tools local-ask-settings"><summary>Ask connection settings</summary><p className="local-muted">Ask has its own connection and owner approval. Prepare only when an owner-issued invitation is expected, then enter that invitation here.</p>{pairing && <><p role="status">Ask connection · {pairing.state}</p><dl className="local-ask-pairing"><dt>Device ID</dt><dd>{pairing.device_id ?? "Not available"}</dd><dt>Vault ID</dt><dd>{pairing.vault_id}</dd><dt>Connection fingerprint</dt><dd>{pairing.fingerprint ?? "Available after connection"}</dd></dl></>}<div className="local-actions"><button type="button" disabled={busy || !vault.intelligencePairingPrepare} onClick={() => void runPairing("prepare")}>Prepare Ask connection</button><button type="button" disabled={busy || !vault.intelligencePairingStatus} onClick={() => void runPairing("status")}>Check Ask connection</button><button type="button" disabled={busy || !vault.intelligencePairingDisconnect} onClick={() => void runPairing("disconnect")}>Disconnect Ask</button></div><label htmlFor="ask-invitation">Owner-issued Ask invitation</label><div className="local-row"><input id="ask-invitation" value={invitation} onChange={e => setInvitation(e.target.value)} autoComplete="off" /><button type="button" disabled={busy || !invitation.trim() || !vault.intelligencePairingClaim} onClick={() => void runPairing("claim")}>Claim Ask invitation</button></div><button type="button" disabled={busy} onClick={() => void refreshCapability()}>Refresh Ask availability</button></details>
    {error && <p role="alert" className="local-error">{error}</p>}
  </section>;
}
