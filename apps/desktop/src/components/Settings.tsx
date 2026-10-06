import { useEffect, useState } from "react";
import { copy } from "@recall/design-tokens";
import type { AiSettings, RecallApiClient } from "@recall/api-client";

export function Settings({ api, onClose }: { api: Pick<RecallApiClient, "getAiSettings" | "setAiEnabled">; onClose: () => void }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  return (
    <main className="settings">
      <header><h1>{copy.settings}</h1><button onClick={onClose}>Done</button></header>
      {error && <p role="alert" className="error">{error}</p>}
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
    </main>
  );
}
