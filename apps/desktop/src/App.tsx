import { useCallback, useEffect, useState } from "react";
import { copy } from "@recall/design-tokens";
import type { Citation, RecallApiClient, RecallAuth, ServerCapture } from "@recall/api-client";
import { Ask } from "./components/Ask";
import { Settings } from "./components/Settings";
import { SignIn } from "./components/SignIn";
import { Viewer } from "./components/Viewer";
import { statusOf } from "./viewmodel";

export interface DesktopServices {
  auth: Pick<RecallAuth, "requestEmailCode" | "verifyEmailCode" | "signOut" | "hasSession" | "onSignedInChange">;
  api: Pick<RecallApiClient, "listCaptures" | "getCapture" | "fetchSource" | "me" | "ask" | "getMemory" | "retryProcessing" | "getAiSettings" | "setAiEnabled">;
}

export function App({ services }: { services: DesktopServices }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    void services.auth.hasSession().then(setSignedIn);
    return services.auth.onSignedInChange(setSignedIn);
  }, [services]);
  if (signedIn === null) return <p className="center" role="status">Loading…</p>;
  if (!signedIn) return <SignIn auth={services.auth} />;
  return <Recent services={services} />;
}

function Recent({ services }: { services: DesktopServices }) {
  const [items, setItems] = useState<ServerCapture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ capture: ServerCapture; sourceId?: string | null } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const openCitation = async (c: Citation) => {
    try {
      setOpen({ capture: await services.api.getCapture(c.capture_id), sourceId: c.source_id });
    } catch {
      setError("Couldn't open that source right now.");
    }
  };

  const refresh = useCallback(async () => {
    try {
      await services.api.me(); // first sign-in provisions the workspace
      setItems((await services.api.listCaptures({ limit: 50 })).items);
      setError(null);
    } catch {
      setError("Can't reach Recall. Check your connection. Nothing here has been lost.");
    }
  }, [services]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (document.hasFocus()) void refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (showSettings) return <Settings api={services.api} onClose={() => setShowSettings(false)} />;
  if (open) return <Viewer api={services.api} capture={open.capture} initialSourceId={open.sourceId} onClose={() => { setOpen(null); void refresh(); }} />;

  return (
    <main className="home">
      <header>
        <h1>{copy.appName}</h1>
        <div>
          <button onClick={() => void refresh()}>Refresh</button>
          <button onClick={() => setShowSettings(true)}>{copy.settings}</button>
          <button onClick={() => void services.auth.signOut()}>{copy.signOut}</button>
        </div>
      </header>
      <p>{copy.tagline}</p>
      <Ask api={services.api} onOpenCitation={(c) => void openCitation(c)} />
      <h2>{copy.recent}</h2>
      {error && <p role="alert" className="error">{error}</p>}
      {items === null && !error && <p role="status">Loading…</p>}
      {items?.length === 0 && (
        <p className="empty">{copy.emptyRecent} Photograph pages with Recall on your iPhone and they'll appear here once uploaded.</p>
      )}
      <ul className="list">
        {items?.map((c) => {
          const status = statusOf(c);
          return (
            <li key={c.capture_id}>
              <button className="row" onClick={() => setOpen({ capture: c })} aria-label={`${c.context_hint ?? copy.untitled}, ${copy.pagesLabel(c.pages.length)}, ${status.label}`}>
                <span className="title">{c.context_hint ?? copy.untitled}</span>
                <span className="muted">{copy.pagesLabel(c.pages.length)} · {new Date(c.captured_at).toLocaleString()}</span>
                <span className={`pill ${status.tone}`}>{status.glyph} {status.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
