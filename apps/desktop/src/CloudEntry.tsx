import { CloudControls } from "./CloudControls";
import { useEffect, useState } from "react";
import { MemorySurface } from "./surface/MemorySurface";
import { unavailableLibrarian } from "./surface/librarian";
import { invoke } from "@tauri-apps/api/core";
import { NativeLocalVault, type VaultMemory, type VaultSource, type VaultRevision } from "./platform/local-vault";
import { NativeCloudStore } from "./platform/cloud-store";
import { CloudVault, CloudError, cloudRequest } from "./platform/cloud-vault";

async function nativeRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const result = await invoke<{status: number; body: T & {error?: {message?: string; code?: string; details?: unknown}}}>("cloud_request", {path, method: init.method || "GET", body: typeof init.body === "string" ? init.body : null});
  if (result.status >= 400) throw new CloudError(result.body.error?.message || "Cloud request failed", result.status, result.body.error?.code || "REQUEST_FAILED", result.body.error?.details);
  return result.body;
}

export function CloudEntry({native = false, onLocal}: {native?: boolean; onLocal?: () => void}) {
  const [vault] = useState(() => native ? new CloudVault(new NativeCloudStore(), nativeRequest) : new CloudVault());
  const [url, setUrl] = useState("");
  const [migration, setMigration] = useState("");
  const [importing, setImporting] = useState(false);
  async function importLocal() {
    setImporting(true);
    setMigration("Backing up your local library before import…");
    try {
      const local = new NativeLocalVault();
      const status = await local.status();
      if (!status.vault_id) throw new Error("Open your existing local library first.");
      const backup = await local.exportLibrary(status.vault_id);
      if (!backup) {setMigration("Import cancelled. Your local library is unchanged."); return;}
      const rows = await local.list(status.vault_id, "", true);
      let imported = 0;
      const failed: string[] = [];
      for (const row of rows) {
        try {
          const item = await invoke<{memory: VaultMemory; source: VaultSource; history: VaultRevision[]}>("vault_sync_export", {expectedVaultId: status.vault_id, memoryId: row.id});
          await vault.importMemory(item.memory, item.source, item.history);
          imported++;
        } catch {failed.push(row.id);}
        setMigration(`${imported} imported; ${failed.length} require review. The local backup and library are retained.`);
      }
      await vault.synchronize();
      setMigration(`${imported} memories imported. ${failed.length} require review${failed.length ? ": " + failed.join(", ") : "."} Reload to view the cloud library. Use cloud mode for synchronized editing; the original local library remains unchanged.`);
    } catch (failure) {setMigration(failure instanceof Error ? failure.message : "Import paused; local data is unchanged.");}
    finally {setImporting(false);}
  }
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState(vault.syncMessage);
  useEffect(() => vault.subscribe(() => setSyncMessage(vault.syncMessage)), [vault]);
  useEffect(() => {
    if (!ready) return;
    const sync = () => { void vault.synchronize(); };
    window.addEventListener("online", sync);
    const timer = window.setInterval(sync, 15000);
    return () => {window.removeEventListener("online", sync); window.clearInterval(timer);};
  }, [ready, vault]);
  useEffect(() => { void vault.status().then(() => setReady(true)).catch(() => {}).finally(() => setChecking(false)); }, [vault]);
  if (ready) return <>
    <MemorySurface cloudControls={<CloudControls vault={vault} request={native ? nativeRequest : cloudRequest} />} vault={vault} librarian={unavailableLibrarian} />
    {native && <button className="cloud-import" disabled={importing} onClick={() => void importLocal()}>Import local library</button>}
    {migration && <p className="cloud-migration" role="status">{migration}</p>}
    <p className="cloud-sync-status" role="status">{syncMessage}</p>
    <button className="cloud-signout" onClick={() => void (native ? invoke("cloud_disconnect") : cloudRequest("/session", {method: "DELETE"})).then(() => {localStorage.removeItem("megraph.cloud.last-scope"); setReady(false); setToken("");}).catch(() => setError("Sign-out could not finish. Try again."))}>Sign out</button>
    {onLocal && <button className="cloud-local" onClick={onLocal}>Local library</button>}
    {error && <p className="cloud-session-error" role="alert">{error}</p>}
  </>;
  return <main className="ms cloud-access"><section className="ms-context">
    <p className="ms-kicker">MONOLITH</p><h1>Your world. Connected.</h1>
    <p>Your private memory, available wherever you are.</p>
    {checking ? <p role="status">Checking your session…</p> : <form onSubmit={event => {
      event.preventDefault(); setBusy(true); setError("");
      void (native ? invoke("cloud_connect", {url, enrollment: token}) : cloudRequest("/session", {method: "POST", body: JSON.stringify({enrollment_token: token})}))
        .then(() => vault.status()).then(() => {setToken(""); setReady(true);})
        .catch(failure => setError(failure instanceof Error ? failure.message : "Sign-in failed."))
        .finally(() => setBusy(false));
    }}>
      {native && <label>MONOLITH server<input type="url" placeholder="https://your-monolith-host" value={url} onChange={event => setUrl(event.target.value)} required /></label>}
      <label>Owner access code<input type="password" autoComplete="one-time-code" value={token} onChange={event => setToken(event.target.value)} required /></label>
      <p>Use the one-time enrollment code issued by your server administrator.</p>
      <button disabled={busy}>{busy ? "Signing in…" : "Open MONOLITH"}</button>
    </form>}
    {onLocal && <button onClick={onLocal}>Return to local library</button>}
    {error && <p role="alert">{error}</p>}
  </section></main>;
}
