import { CloudIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { CloudVault, ConflictChoice, ConflictReview, cloudRequest } from "./platform/cloud-vault";

interface AiSettings { enabled: boolean; configured: boolean; version: number; explanation: string }
function ConflictCard({review, busy, onResolve}: {review: ConflictReview; busy: boolean; onResolve: (choice: ConflictChoice) => void}) {
  const [merged, setMerged] = useState(review.local.note);
  const title = (review.local.note.split("\n")[0] ?? "").slice(0, 80) || review.memory;
  const removed = review.local.state === "deleted";
  return <section className="cloud-conflict" aria-label={`Conflict: ${title}`}>
    <h4>{title}</h4>
    <p>This memory changed on another device before your edit synced. Nothing has been discarded.</p>
    <h5>Your edit on this device{removed ? " (deleted here)" : ""}</h5>
    <pre>{review.local.note}</pre>
    <h5>Cloud version{review.remote ? ` (revision ${review.remote.revision}${review.remote.state === "deleted" ? ", deleted" : ""})` : ""}</h5>
    {review.remote ? <pre>{review.remote.note}</pre> : <p>The cloud version is unavailable while offline. Your edit stays on this device; reopen this review when connected.</p>}
    {review.remote && <>
      <button disabled={busy} onClick={() => onResolve({kind: "mine"})}>Keep my edit</button>
      <button disabled={busy} onClick={() => { if (window.confirm("Use the cloud version? Your edit on this device will be discarded. The cloud history is unchanged.")) onResolve({kind: "cloud"}); }}>Use cloud version</button>
      <label>Combined text
        <textarea value={merged} onChange={event => setMerged(event.target.value)} rows={5} />
      </label>
      <button disabled={busy || !merged.trim()} onClick={() => onResolve({kind: "merged", note: merged})}>Save combined text</button>
    </>}
  </section>;
}

/** Account operations stay outside the approved memory-field components. */
export function CloudControls({vault, request}: {vault: CloudVault; request: typeof cloudRequest}) {
  const [open, setOpen] = useState(false);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictReview[]>([]);
  async function loadConflicts() { try {setConflicts(await vault.conflictReviews());} catch {setConflicts([]);} }
  async function resolve(memory: string, choice: ConflictChoice) {
    setBusy(true);
    try {
      await vault.resolveConflict(memory, choice);
      setMessage(choice.kind === "cloud" ? "Using the cloud version." : "Your resolution is saved and will sync.");
    } catch (error) {setMessage(error instanceof Error ? error.message : "The conflict could not be resolved.");}
    finally {setBusy(false); await loadConflicts();}
  }
  async function show() {
    setOpen(true);
    void loadConflicts();
    try {setAi(await request<AiSettings>("/settings/ai"));}
    catch {setMessage("Settings are unavailable offline. Saved changes remain on this device.");}
  }
  async function exportData() {
    setBusy(true);
    try {
      const data = await vault.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], {type: "application/json"}));
      const link = document.createElement("a"); link.href = url; link.download = `megraph-export-${new Date().toISOString().slice(0,10)}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage("Export created. It contains private memories, originals and pending edits; store it securely.");
    } catch (error) {setMessage(error instanceof Error ? error.message : "Export could not finish.");}
    finally {setBusy(false);}
  }
  return <>
    <button aria-label="Cloud settings" onClick={() => void show()}><CloudIcon /><span>Cloud settings</span></button>
    {open && <section className="cloud-settings glass" role="dialog" aria-modal="false" aria-labelledby="cloud-settings-title">
      <h2 id="cloud-settings-title">Cloud settings</h2>
      <button onClick={() => setOpen(false)}>Close settings</button>
      <p>{vault.syncMessage}</p>
      <p>Conflicting edits stay on this device and are included in your export. They are never automatically overwritten.</p>
      {conflicts.length > 0 && <>
        <h3>Edits to review</h3>
        {conflicts.map(review => <ConflictCard key={review.memory} review={review} busy={busy} onResolve={choice => void resolve(review.memory, choice)} />)}
      </>}
      <button disabled={busy} onClick={() => void exportData()}>{busy ? "Exporting…" : "Export memories and pending edits"}</button>
      {ai && <>
        <h3>Remote AI</h3><p>{ai.explanation}</p>
        <p>Answers use source excerpts. Capture organization also requires permission for each source; automatic processing applies only to new captures after you enable it. Configured means key, model, prices and caps are present; connectivity is not verified.</p>
        <button disabled={busy} onClick={() => {
          setBusy(true);
          void request<AiSettings>("/settings/ai", {method: "PUT", body: JSON.stringify({enabled: !ai.enabled, expected_version: ai.version})})
            .then(value => {setAi(value); setMessage(value.enabled ? "Remote AI permission enabled." : "Remote AI permission disabled.");})
            .catch(error => setMessage(error instanceof Error ? error.message : "Settings could not be saved."))
            .finally(() => setBusy(false));
        }}>{ai.enabled ? "Disable remote AI" : "Allow remote AI processing"}</button>
      </>}
      {message && <p role="status">{message}</p>}
    </section>}
  </>;
}
