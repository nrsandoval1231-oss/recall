import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, sha256Hex } from "@recall/api-client";
import { copy } from "@recall/design-tokens";
import type { Citation, RecallApiClient, RecallAuth, ServerCapture } from "@recall/api-client";
import { Ask } from "./components/Ask";
import { Settings } from "./components/Settings";
import { SignIn } from "./components/SignIn";
import { Viewer } from "./components/Viewer";
import { Library } from "./components/Library";
import { Review } from "./components/Review";
import { statusOf } from "./viewmodel";
import type { NativeCache, CacheScope, CachedRecord } from "./platform/native-cache";

export function managedExportNotice(result: { written: string[]; conflicts: { record_id: string; reason: string }[] }): string {
  return result.conflicts.length ? `${result.conflicts.length} Markdown conflict(s) need review.` : `Markdown export updated ${result.written.length} file(s).`;
}

export interface DesktopServices {
  auth: Pick<RecallAuth, "requestEmailCode" | "verifyEmailCode" | "signOut" | "hasSession" | "onSignedInChange"> & Partial<Pick<RecallAuth, "getUserId">>;
  api: Pick<RecallApiClient, "listCaptures" | "getCapture" | "fetchSource" | "me" | "ask" | "getMemory" | "retryProcessing" | "getAiSettings" | "setAiEnabled"> & Partial<Pick<RecallApiClient, "deleteCapture" | "deleteMemory" | "deleteSource" | "workspaceDeletionPreview" | "deleteWorkspaceData" | "listEntities" | "getEntity" | "listActions" | "updateAction" | "correctMemory" | "exportZip" | "identityPreview" | "applyIdentity">>;
  cache?: NativeCache;
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
  const [surface, setSurface] = useState<"recent" | "library" | "review">("recent");
  const [scope, setScope] = useState<CacheScope | null>(null);
  const scopeRef = useRef<CacheScope | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const exportZip = async () => {
    if (!services.api.exportZip) return;
    try { const bytes = await services.api.exportZip(); if (services.cache?.available) { const digest = await sha256Hex(bytes); const saved = await services.cache.saveArchive(bytes, digest); setExportNotice(saved ? `Export saved (${saved.byte_size} bytes).` : "Export cancelled."); return; } const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" })); const link = document.createElement("a"); link.href = url; link.download = "recall-export.zip"; link.click(); URL.revokeObjectURL(url); setExportNotice("Export downloaded."); }
    catch { setExportNotice("Couldn't create an export right now."); }
  };
  const exportMarkdown = async () => {
    if (!services.api.exportZip || !services.cache?.available) return;
    try { const root = await services.cache.selectMarkdownRoot(); if (!root) { setExportNotice("Markdown export cancelled."); return; } const bytes = await services.api.exportZip(); const digest = await sha256Hex(bytes); const result = await services.cache.applyMarkdownArchive(bytes, digest); setExportNotice(managedExportNotice(result)); }
    catch { setExportNotice("Couldn't update the managed Markdown export."); }
  };
  const openCitation = async (c: Citation) => {
    try {
      setOpen({ capture: await services.api.getCapture(c.capture_id), sourceId: c.source_id });
    } catch {
      setError("Couldn't open that source right now.");
    }
  };

  const refresh = useCallback(async () => {
    try {
      const identity = await services.api.me(); // first sign-in provisions the workspace
      const activeScope = Array.isArray(identity.workspaces) && identity.workspaces[0] ? { user_id: identity.user_id, workspace_id: identity.active_workspace_id } : null;
      if (activeScope) {
        scopeRef.current = activeScope;
        setScope((previous) => previous?.user_id === activeScope.user_id && previous.workspace_id === activeScope.workspace_id ? previous : activeScope);
        if (services.cache?.available) {
          try {
            await services.cache.sync(activeScope);
            const pushed = await services.cache.push(activeScope);
            setSyncNotice(pushed.conflicts.length ? `${pushed.conflicts.length} offline change(s) need review because the server changed.` : null);
          } catch (failure) {
            if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) throw failure;
            setSyncNotice("Device sync has paused. Your pending changes remain saved on this device.");
          }
        }
      }
      setItems((await services.api.listCaptures({ limit: 50 })).items);
      setError(null);
    } catch (failure) {
      const cachedScope = scopeRef.current;
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
        if (cachedScope && services.cache?.available) await services.cache.clear(cachedScope, false);
        scopeRef.current = null;
        setScope(null);
        setItems([]);
        await services.auth.signOut();
        return;
      }
      if (cachedScope && services.cache?.available) {
        try {
          const records = await services.cache.cachedRecords(cachedScope, 50);
          const cached = records.map(cachedCapture).filter((c): c is ServerCapture => c !== null);
          setItems(cached); setError("Offline. Showing cached memories; fresh answers and changes are unavailable."); return;
        } catch { /* fall through to the honest unavailable state */ }
      }
      setError("Can't reach Recall. Check your connection. Nothing here has been lost.");
    }
  }, [services]);

  useEffect(() => {
    void (async () => {
      if (services.cache?.available && services.auth.getUserId) {
        const userId = await services.auth.getUserId();
        if (userId) {
          const workspaceId = await services.cache.lastWorkspace(userId);
          if (workspaceId) {
            const persisted = { user_id: userId, workspace_id: workspaceId };
            scopeRef.current = persisted;
            setScope(persisted);
          }
        }
      }
      await refresh();
    })();
    const timer = setInterval(() => { if (document.hasFocus()) void refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (showSettings) return <Settings api={services.api} onClose={() => setShowSettings(false)} />;
  if (surface === "library" && services.api.listEntities && services.api.getEntity) return <Library api={services.api as Pick<RecallApiClient, "listEntities" | "getEntity"> & Partial<Pick<RecallApiClient, "identityPreview" | "applyIdentity">>} cache={services.cache} scope={scope} onClose={() => setSurface("recent")} />;
  if (surface === "review" && services.api.listActions && services.api.updateAction) return <Review api={services.api as Pick<RecallApiClient, "listActions" | "updateAction">} cache={services.cache} scope={scope} onClose={() => setSurface("recent")} />;
  if (open) return <Viewer api={services.api} capture={open.capture} initialSourceId={open.sourceId} cache={services.cache} scope={scope} onDeleted={() => { setOpen(null); void refresh(); }} onClose={() => { setOpen(null); void refresh(); }} />;

  return (
    <main className="home">
      <header>
        <h1>{copy.appName}</h1>
        <div>
          <button onClick={() => void refresh()}>Refresh</button>
          <button onClick={() => setSurface("library")}>Library</button>
          <button onClick={() => setSurface("review")}>Review</button>
          {services.api.exportZip && <button onClick={() => void exportZip()}>Export</button>}
          {services.api.exportZip && services.cache?.available && <button onClick={() => void exportMarkdown()}>Markdown export</button>}
          <button onClick={() => setShowSettings(true)}>{copy.settings}</button>
          <button onClick={() => void (async () => {
            if (scope && services.cache?.available) await services.cache.clear(scope, false);
            await services.auth.signOut();
          })().catch(() => setError("Couldn't finish clearing this device. Please try signing out again."))}>{copy.signOut}</button>
        </div>
      </header>
      <p>{copy.tagline}</p>
      <Ask api={services.api} cache={services.cache} scope={scope} onOpenCitation={(c) => void openCitation(c)} />
      <h2>{copy.recent}</h2>
      {syncNotice && <p role="alert" className="error">{syncNotice}</p>}
      {exportNotice && <p role="status" className="note">{exportNotice}</p>}
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

function cachedCapture(record: CachedRecord): ServerCapture | null {
  if (record.kind !== "capture" || !record.payload || typeof record.payload !== "object") return null;
  const value = record.payload as Partial<ServerCapture>;
  if (typeof value.capture_id !== "string" || !Array.isArray(value.pages)) return null;
  return { ...value, version: value.version ?? record.version, status: value.status ?? "stored", pages: value.pages } as ServerCapture;
}
