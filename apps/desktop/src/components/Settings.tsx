import { useEffect, useState } from "react";
import { copy } from "@recall/design-tokens";
import type { AiSettings, RecallApiClient, WorkspaceDeletionPreview } from "@recall/api-client";

export function Settings({ api, onClose }: { api: Pick<RecallApiClient, "getAiSettings" | "setAiEnabled"> & Partial<Pick<RecallApiClient, "workspaceDeletionPreview" | "deleteWorkspaceData">>; onClose: () => void }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<WorkspaceDeletionPreview | null>(null);
  const [eraseNotice, setEraseNotice] = useState<string | null>(null);
  useEffect(() => { api.getAiSettings().then(setSettings, () => setError("Couldn't load settings.")); }, [api]);
  const toggle = async (enabled: boolean) => {
    if (!settings) return;
    setError(null);
    try {
      setSettings(await api.setAiEnabled(enabled, settings.version));
    } catch {
      setError("Couldn't change the setting. Nothing was changed.");
    }
  };
  const loadPreview = async () => { if (!api.workspaceDeletionPreview) return; try { setPreview(await api.workspaceDeletionPreview()); } catch { setError("Couldn't load the workspace deletion preview."); } };
  const eraseWorkspace = async () => {
    if (!preview || !api.deleteWorkspaceData) return;
    const confirmed = window.confirm(`Erase this workspace? This will delete ${preview.captures} captures, ${preview.originals} originals, and ${preview.memories} memories. Pending offline changes will be preserved for review.`);
    if (!confirmed) return;
    try { await api.deleteWorkspaceData(crypto.randomUUID(), preview.version); setEraseNotice("Workspace data deletion completed."); setPreview(null); } catch { setError("The workspace changed or deletion failed. Reload the preview before trying again."); }
  };
  return (
    <main className="settings">
      <header><h1>{copy.settings}</h1><button onClick={onClose}>Done</button></header>
      {error && <p role="alert" className="error">{error}</p>}
      {eraseNotice && <p role="status" className="note">{eraseNotice}</p>}
      {settings && (
        <section>
          <h2>{copy.aiToggle}</h2>
          {!settings.ai_configured ? (
            <p className="note">AI reading isn't set up on this Recall server yet. Your originals are stored and viewable either way.</p>
          ) : (
            <>
              <p>{settings.explanation}</p>
              {settings.consent_outdated && <p className="note">What Recall sends has changed since you agreed. Please review and turn it on again.</p>}
              <label className="switch">
                <input type="checkbox" checked={settings.enabled} onChange={(e) => void toggle(e.target.checked)} />
                {settings.enabled ? "On" : "Off"}
              </label>
            </>
          )}
        </section>
      )}
      {api.workspaceDeletionPreview && api.deleteWorkspaceData && <section><h2>Erase workspace data</h2><p className="note">This permanently removes private workspace records and originals. Pending offline changes stay on this device until reviewed.</p><button onClick={() => void loadPreview()}>Review deletion counts</button>{preview && <div role="dialog" aria-label="Workspace deletion preview"><p>{preview.captures} captures · {preview.originals} originals · {preview.memories} memories</p><button className="danger" onClick={() => void eraseWorkspace()}>Erase workspace data</button><button onClick={() => setPreview(null)}>Cancel</button></div>}</section>}
    </main>
  );
}
