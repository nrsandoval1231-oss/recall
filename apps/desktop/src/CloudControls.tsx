import { CloudIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { CloudVault, cloudRequest } from "./platform/cloud-vault";

interface AiSettings { enabled: boolean; configured: boolean; version: number; explanation: string }
/** Account operations stay outside the approved memory-field components. */
export function CloudControls({vault, request}: {vault: CloudVault; request: typeof cloudRequest}) {
  const [open, setOpen] = useState(false);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function show() {
    setOpen(true);
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
      <button disabled={busy} onClick={() => void exportData()}>{busy ? "Exporting…" : "Export memories and pending edits"}</button>
      {ai && <>
        <h3>Remote AI</h3><p>{ai.explanation}</p>
        <p>Answers use source excerpts. Image extraction and semantic indexing for this library are not yet connected.</p>
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
