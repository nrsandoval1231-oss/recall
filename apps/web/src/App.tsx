import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RecallApiClient, sha256Hex, type AskResponse, type CaptureManifest, type MediaType, type ServerCapture } from "@recall/api-client";
import { deleteDraft, draftPage, listDrafts, saveDraft, type Draft } from "./storage";
import type { BrowserAuth, BrowserSession } from "./auth/session";
import { useOriginal } from "./useOriginal";
interface Services {
    auth: BrowserAuth;
    api: RecallApiClient;
}
type Mode = "ask" | "explore" | "capture";
const scopeFor = (session: BrowserSession) => `${session.userId}:${session.workspaceId}`;
export function App({ services }: {
    services: Services;
}) {
    const [session, setSession] = useState<BrowserSession | null | undefined>();
    const [startupError, setStartupError] = useState<string | null>(null);
    const sessionRequest = useRef(0);
    const checkSession = useCallback(() => {
        const requestId = ++sessionRequest.current;
        setStartupError(null);
        setSession(undefined);
        void services.auth.getSession().then((nextSession) => {
            if (requestId === sessionRequest.current)
                setSession(nextSession);
        }).catch((failure) => {
            if (requestId === sessionRequest.current)
                setStartupError(failure instanceof Error ? failure.message : "Recall could not check your session.");
        });
    }, [services.auth]);
    useEffect(() => {
        checkSession();
        return services.auth.onChange((nextSession) => {
            sessionRequest.current += 1;
            setStartupError(null);
            setSession(nextSession);
        });
    }, [checkSession, services.auth]);
    if (startupError)
        return <main className="signin glass-board"><div className="brand">Recall<span className="brand-dot"/></div><h1>Recall is unavailable.</h1><p className="error" role="alert">{startupError}</p><button className="button primary" onClick={checkSession}>Try again</button></main>;
    if (session === undefined)
        return <p className="empty loading">Loading Recall…</p>;
    return session ? <Home key={scopeFor(session)} services={services} session={session}/> : <ConnectDevice auth={services.auth}/>;
}
function ConnectDevice({ auth }: {
    auth: BrowserAuth;
}) {
    const cooldownKey = "recall-signin-limited-until";
    const cooldownUntil = () => { const value = Number(sessionStorage.getItem(cooldownKey) ?? "0"); return Number.isFinite(value) && value > Date.now(); };
    const [email, setEmail] = useState("");
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [limited, setLimited] = useState(cooldownUntil);
    const [busy, setBusy] = useState(false);
    const request = async () => { if (limited || busy || sent)
        return; setBusy(true); setError(null); try {
        await auth.requestSignIn(email.trim());
        setSent(true);
    }
    catch (failure) {
        if (failure instanceof Error && failure.message === "EMAIL_RATE_LIMITED") {
            sessionStorage.setItem(cooldownKey, String(Date.now() + 60 * 60 * 1000));
            setLimited(true);
            setError("Device connection is temporarily limited. Try again later.");
        }
        else
            setError(failure instanceof Error ? failure.message : "Could not send the connection email.");
    }
    finally {
        setBusy(false);
    } };
    return <main className="signin glass-board"><div className="brand">Recall<span className="brand-dot"/></div><p className="eyebrow">PRIVATE MEMORY SPACE</p><h1>Connect this device.</h1><p className="muted">Connect once to open your source-backed memories directly on this device.</p><div className="field"><label htmlFor="email">Owner email</label><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email"/></div><button className="button primary" onClick={() => void request()} disabled={busy || limited || sent || !email.includes("@")}>{busy ? "Sending…" : limited ? "Connection temporarily limited" : sent ? "Link sent" : "Email me a connection link"}</button>{sent && <p className="status" role="status">Open the connection link in this browser. Future visits will open Recall directly.</p>}{limited && <p className="error" role="alert">Device connection is temporarily limited. Try again later; refreshing will not bypass the provider limit.</p>}{error && !limited && <p className="error" role="alert">{error}</p>}</main>;
}
function Home({ services, session }: {
    services: Services;
    session: BrowserSession;
}) {
    const scope = scopeFor(session);
    const active = useRef(true);
    const askRequest = useRef(0);
    useEffect(() => { active.current = true; return () => { active.current = false; askRequest.current += 1; }; }, [scope]);
    const [asking, setAsking] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [mode, setMode] = useState<Mode>("ask");
    const [captures, setCaptures] = useState<ServerCapture[]>([]);
    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [selected, setSelected] = useState<File | null>(null);
    const [context, setContext] = useState("");
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [ask, setAsk] = useState<AskResponse | null>(null);
    const [question, setQuestion] = useState("");
    const [aiEnabled, setAiEnabled] = useState(false);
    const [aiConfigured, setAiConfigured] = useState(false);
    const refresh = useCallback(async () => { try {
        const [identity, list, settings] = await Promise.all([services.api.me(), services.api.listCaptures({ limit: 20 }), services.api.getAiSettings()]);
        if (!active.current || identity.user_id !== session.userId)
            return;
        await services.api.registerDevice({ device_id: deviceId(), platform: "web", name: navigator.userAgent.slice(0, 80), app_version: "0.1.0" });
        if (!active.current)
            return;
        setCaptures(list.items);
        setAiEnabled(settings.enabled);
        setAiConfigured(settings.ai_configured);
        setError(null);
    }
    catch (failure) {
        if (active.current)
            setError(failure instanceof Error ? failure.message : "Could not load your captures.");
    } }, [services.api, session.userId]);
    useEffect(() => { void refresh(); void listDrafts(scope).then((items) => { if (active.current)
        setDrafts(items); }).catch((failure) => { if (active.current)
        setError(failure instanceof Error ? failure.message : "Local captures could not be loaded."); }); }, [refresh, scope]);
    const preview = useMemo(() => selected ? URL.createObjectURL(selected) : null, [selected]);
    useEffect(() => () => { if (preview)
        URL.revokeObjectURL(preview); }, [preview]);
    const uploadDraft = async (draft: Draft) => { const page = draft.manifest.pages[0]; if (!page)
        throw new Error("This saved capture has no page."); const bytes = await draft.files[page.client_page_id]?.arrayBuffer(); if (!bytes)
        throw new Error("The saved original is unavailable."); const server = await services.api.createCapture(draft.manifest, draft.id); const auths = await services.api.authorizeUploads(server.capture_id); const authorization = auths.find((item) => item.source_id === server.pages[0]?.source_id) ?? auths[0]; if (!authorization)
        throw new Error("Recall did not provide an upload authorization."); const uploaded = await services.api.putUpload(authorization, bytes); return services.api.finalize(server.capture_id, [{ source_id: authorization.source_id, sha256: uploaded.sha256 }], draft.id); };
    const capture = async () => {
        if (!selected)
            return;
        let draftSaved = false;
        setBusy(true);
        setError(null);
        try {
        const mediaType = selected.type as MediaType;
        if (!["image/jpeg", "image/png", "image/heic", "image/heif"].includes(mediaType))
            throw new Error("Choose a JPEG, PNG, HEIC, or HEIF image.");
        const bytes = await selected.arrayBuffer();
        const captureId = crypto.randomUUID();
        const pageId = crypto.randomUUID();
        const manifest: CaptureManifest = { schema_version: "1.0", client_capture_id: captureId, device_id: deviceId(), captured_at: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", source_kind: "handwritten_note", context_hint: context.trim() || null, pages: [{ client_page_id: pageId, ordinal: 1, media_type: mediaType, byte_size: selected.size, sha256: await sha256Hex(bytes), original_filename: selected.name || null }] };
        const draft = draftPage(scope, manifest, manifest.pages[0]!, selected);
        await saveDraft(draft);
        draftSaved = true;
        if (!active.current)
            return;
        // A retry must use the durable draft below, never create a second capture from the same file selection.
        setSelected(null);
        setContext("");
        setMessage("Original saved on this browser. Uploading…");
        setDrafts(await listDrafts(scope));
        const finalized = await uploadDraft(draft);
        if (!active.current)
            return;
        await deleteDraft(captureId);
        setDrafts(await listDrafts(scope));
        setMessage(finalized.processing ? "Saved. Recall is reading the original." : "Saved. Your original is uploaded and protected.");
        await refresh();
    }
    catch (failure) {
        if (active.current) {
            const detail = failure instanceof Error ? failure.message : "Capture failed.";
            setError(draftSaved ? `${detail} Your original remains saved on this device; retry it from Capture.` : detail);
        }
    }
    finally {
        if (active.current)
            setBusy(false);
    }
    };
    const resume = async (draft: Draft) => { setBusy(true); setError(null); try {
        await uploadDraft(draft);
        if (!active.current)
            return;
        await deleteDraft(draft.id);
        setDrafts(await listDrafts(scope));
        setMessage("Saved original uploaded successfully.");
        await refresh();
    }
    catch (failure) {
        if (active.current)
            setError(`${failure instanceof Error ? failure.message : "Retry failed."} The original remains saved on this device.`);
    }
    finally {
        if (active.current)
            setBusy(false);
    } };
    const removeDraft = async (draft: Draft) => { if (!window.confirm("Remove this unsynced original from this browser? This cannot be undone."))
        return; try {
        await deleteDraft(draft.id);
        if (active.current)
            setDrafts(await listDrafts(scope));
    }
    catch (failure) {
        if (active.current)
            setError(failure instanceof Error ? failure.message : "Could not remove this local original.");
    } };
    const askRecall = async () => {
        const trimmed = question.trim();
        if (!trimmed || asking)
            return;
        const requestId = ++askRequest.current;
        setAsking(true);
        setAsk(null);
        setError(null);
        try {
            const response = await services.api.ask(trimmed);
            if (active.current && requestId === askRequest.current)
                setAsk(response);
        }
        catch (failure) {
            if (active.current && requestId === askRequest.current)
                setError(failure instanceof Error ? failure.message : "Recall could not answer right now.");
        }
        finally {
            if (active.current && requestId === askRequest.current)
                setAsking(false);
        }
    };
    const setQuestionSafe = (value: string) => { setQuestion(value); setAsk(null); askRequest.current += 1; setAsking(false); };
    const toggleAi = async () => { setBusy(true); try {
        const next = await services.api.setAiEnabled(!aiEnabled);
        if (active.current)
            setAiEnabled(next.enabled);
    }
    catch (failure) {
        if (active.current)
            setError(failure instanceof Error ? failure.message : "AI reading could not be changed.");
    }
    finally {
        if (active.current)
            setBusy(false);
    } };
    const disconnect = async () => {
        if (busy)
            return;
        setBusy(true);
        setError(null);
        try {
            await services.auth.signOut();
        }
        catch (failure) {
            if (active.current)
                setError(failure instanceof Error ? failure.message : "Could not disconnect this device.");
        }
        finally {
            if (active.current)
                setBusy(false);
        }
    };
    return (<main className="space-shell" data-mode={mode}>
      <header className="topbar">
        <button className="brand brand-button" onClick={() => setMode("ask")} aria-label="Recall home">Recall</button>
        <div className="topnav">
          <span className="workspace-chip">Private workspace</span>
          <button className="button" onClick={() => setSettingsOpen(!settingsOpen)} aria-expanded={settingsOpen}>Settings</button>
        </div>
      </header>
      {settingsOpen && <SettingsBoard aiConfigured={aiConfigured} aiEnabled={aiEnabled} busy={busy} toggleAi={() => void toggleAi()} disconnect={() => void disconnect()}/>}
      {mode === "ask" && <AskMode question={question} setQuestion={setQuestionSafe} ask={ask} asking={asking} busy={busy} onAsk={() => void askRecall()} api={services.api} captures={captures} onCapture={() => setMode("capture")}/>}
      {mode === "explore" && <ExploreMode captures={captures} api={services.api} refresh={() => void refresh()}/>}
      {mode === "capture" && <CaptureMode selected={selected} setSelected={setSelected} preview={preview} context={context} setContext={setContext} capture={() => void capture()} busy={busy} drafts={drafts} resume={(draft) => void resume(draft)} removeDraft={(draft) => void removeDraft(draft)} message={message} error={error}/>}
      {error && mode !== "capture" && <p className="error global-error" role="alert">{error}</p>}
      <ModeDock mode={mode} setMode={setMode} pending={drafts.length}/>
    </main>);
}
function ModeDock({ mode, setMode, pending }: {
    mode: Mode;
    setMode: (mode: Mode) => void;
    pending: number;
}) {
    return <nav className="mode-dock glass-board" aria-label="Recall modes">
    {(["ask", "explore", "capture"] as Mode[]).map((item) => <button key={item} aria-label={item.charAt(0).toUpperCase() + item.slice(1)} className={mode === item ? "mode active" : "mode"} aria-pressed={mode === item} onClick={() => setMode(item)}>
      <span className={"mode-icon " + item} aria-hidden="true"/>{item.charAt(0).toUpperCase() + item.slice(1)}
      {item === "capture" && pending > 0 && <span className="pending-count" aria-label={pending + " pending uploads"}>{pending}</span>}
    </button>)}
  </nav>;
}
function AskMode({ question, setQuestion, ask, asking, busy, onAsk, api, captures, onCapture }: {
    question: string;
    setQuestion: (value: string) => void;
    ask: AskResponse | null;
    asking: boolean;
    busy: boolean;
    onAsk: () => void;
    api: RecallApiClient;
    captures: ServerCapture[];
    onCapture: () => void;
}) {
    return <section className="mode-stage ask-stage" aria-label="Ask workspace">
    <form className="ask-board glass-board" onSubmit={(event) => { event.preventDefault(); onAsk(); }}>
      <label htmlFor="question" className="sr-only">What are you trying to remember?</label>
      <div className="ask-line">
        <input id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What are you trying to remember?" autoComplete="off"/>
        <button className="ask-submit" disabled={busy || asking || !question.trim()} aria-label="Ask Recall">{asking ? "…" : "→"}</button>
      </div>
    </form>
    {asking && <p className="request-status" role="status">Looking for supporting sources…</p>}
    {ask ? <Answer key={ask.question} response={ask} api={api}/> : <div className="idle-workspace">
      <section className="welcome-board glass-board"><span className="board-tag">Your memory, within reach</span>
        <h1>Start with what<br />you remember.</h1><p>A detail, a person, a place. Ask in your own words, then follow the evidence.</p>
        <button className="button" onClick={onCapture}>＋ Capture something new</button>
      </section>
      <section className="recent-board glass-board" aria-label="Recent sources"><h2>Recently captured</h2>
        {captures.length === 0 ? <p className="muted">Your saved sources will appear here.</p> : captures.slice(0, 3).map((capture) => <CaptureBoard key={capture.capture_id} capture={capture} api={api}/>)}
      </section>
    </div>}
  </section>;
}
function ExploreMode({ captures, api, refresh }: {
    captures: ServerCapture[];
    api: RecallApiClient;
    refresh: () => void;
}) {
    return <section className="mode-stage explore-stage" aria-label="Explore sources">
    <div className="stage-heading"><div><h1>Your sources</h1><p className="muted">Open a board to inspect the original.</p></div><button className="button" onClick={refresh}>Refresh</button></div>
    {captures.length === 0 ? <div className="empty-board glass-board"><h2>No sources yet</h2><p className="muted">Capture a photo to begin.</p></div> : <div className="board-grid">{captures.map((capture) => <CaptureBoard key={capture.capture_id} capture={capture} api={api}/>)}</div>}
  </section>;
}
function CaptureMode({ selected, setSelected, preview, context, setContext, capture, busy, drafts, resume, removeDraft, message, error }: {
    selected: File | null;
    setSelected: (file: File | null) => void;
    preview: string | null;
    context: string;
    setContext: (value: string) => void;
    capture: () => void;
    busy: boolean;
    drafts: Draft[];
    resume: (draft: Draft) => void;
    removeDraft: (draft: Draft) => void;
    message: string | null;
    error: string | null;
}) { return <section className="mode-stage capture-stage"><div className="capture-board glass-board"><div className="stage-heading"><div><h2>Save an original</h2></div></div><label className="dropzone" htmlFor="capture-file"><span className="drop-orbit" aria-hidden="true">＋</span><strong>{selected ? "Ready to save" : "Choose a photo of your note"}</strong><span className="muted">Your original is saved in this browser before upload.</span><span>{selected ? "Choose a different photo" : "JPEG, PNG, HEIC or HEIF"}</span><input id="capture-file" className="capture-input" disabled={busy} type="file" accept="image/jpeg,image/png,image/heic,image/heif" onChange={(event) => setSelected(event.target.files?.[0] ?? null)}/></label>{selected && <div className="file-preview">{preview && <img src={preview} alt="Selected note preview"/>}<span><strong>{selected.name}</strong><br /><span className="muted">{Math.round(selected.size / 1024)} KB · ready to save</span></span></div>}<div className="field"><label htmlFor="context">Context <span>(optional)</span></label><textarea id="context" value={context} disabled={busy} onChange={(event) => setContext(event.target.value)} placeholder="A hint for your future self"/></div><button className="button primary save-button" onClick={capture} disabled={busy || !selected}>{busy ? "Saving…" : "Save original"}</button>{drafts.length > 0 && <div className="pending-panel"><strong>{drafts.length} saved original{drafts.length === 1 ? "" : "s"} waiting to upload.</strong><span className="muted">Pending originals stay here until you retry or remove them.</span>{drafts.map((draft) => <div className="pending-row" key={draft.id}><span>{draft.manifest.context_hint || "Untitled note"}</span><button className="button link" onClick={() => resume(draft)} disabled={busy}>Retry upload</button><button className="button link danger-link" onClick={() => removeDraft(draft)} disabled={busy}>Remove</button></div>)}</div>}{message && <p className="status" role="status">{message}</p>}{error && <p className="error" role="alert">{error}</p>}</div></section>; }
function SettingsBoard({ aiConfigured, aiEnabled, busy, toggleAi, disconnect }: {
    aiConfigured: boolean;
    aiEnabled: boolean;
    busy: boolean;
    toggleAi: () => void;
    disconnect: () => void;
}) { return <div className="settings-board glass-board"><div><p className="eyebrow">SETTINGS</p><strong>AI reading</strong><p className="muted">{aiConfigured ? "Turn on when you want searchable interpretations." : "AI reading is not configured yet."}</p></div><div className="settings-actions"><button className="button ghost" onClick={toggleAi} disabled={busy || !aiConfigured} aria-pressed={aiEnabled}>{aiEnabled ? "On" : "Off"}</button><button className="button link danger-link" onClick={disconnect} disabled={busy}>Disconnect this device</button></div></div>; }
function statusLabel(status: ServerCapture["status"]): string { return status === "ready" ? "Ready" : status === "needs_review" ? "Needs review" : status === "failed" ? "Needs retry" : status === "processing" ? "Reading" : status === "awaiting_upload" ? "Incomplete" : status === "stored" ? "Uploaded" : "Queued"; }
function CaptureBoard({ capture, api }: {
    capture: ServerCapture;
    api: RecallApiClient;
}) {
    const original = useOriginal(api);
    const [selectedPage, setSelectedPage] = useState(0);
    const page = capture.pages[selectedPage];
    const open = () => { if (page)
        void original.load(page.source_id, page.declared_sha256); };
    return <article className={"source-board glass-board " + (original.url || original.loading ? "opened" : "")}>
    <button className="board-trigger" onClick={open} disabled={!page} aria-expanded={!!original.url || original.loading}>
      <span className="source-glyph" aria-hidden="true">▤</span><span className="board-copy"><strong>{capture.context_hint || "Untitled source"}</strong><span>{new Date(capture.captured_at).toLocaleDateString()} · {capture.pages.length} page{capture.pages.length === 1 ? "" : "s"}</span></span>
      <span className={"state state-" + capture.status}>{statusLabel(capture.status)}</span>
    </button>
    {(original.loading || original.url || original.error) && <div className="original-panel">
      <div className="original-label"><span>Original · page {page?.ordinal ?? "?"}</span><button className="button link" onClick={original.close}>Close original</button></div>
      {capture.pages.length > 1 && <div className="page-controls">{capture.pages.map((item, index) => <button className="button" key={item.source_id} aria-pressed={selectedPage === index} onClick={() => { setSelectedPage(index); void original.load(item.source_id, item.declared_sha256); }}>Page {item.ordinal}</button>)}</div>}
      {original.loading && <p role="status">Checking original integrity…</p>}
      {original.error && <p className="error" role="alert">{original.error}</p>}
      {original.url && <img src={original.url} alt="Original note"/>}
    </div>}
  </article>;
}
function Answer({ response, api }: {
    response: AskResponse;
    api: RecallApiClient;
}) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [focused, setFocused] = useState(false);
    const original = useOriginal(api);
    const selected = response.citations.find((citation) => citation.citation_id === selectedId) ?? response.citations[0];
    const title = response.status === "answered" ? "Recall found this" : response.status === "insufficient_evidence" ? "Not enough evidence" : response.status === "ambiguous" ? "A few memories may match" : "Answers are currently limited";
    return <div className={"answer-workspace " + (focused ? "answer-focused" : "")}>
    <aside className="matches-board glass-board"><h2>Supporting sources</h2>
      {response.citations.length === 0 && <p className="muted">No supporting sources returned.</p>}
      {response.citations.map((citation) => <button className={"citation " + (selected?.citation_id === citation.citation_id ? "selected" : "")} key={citation.citation_id} aria-pressed={selected?.citation_id === citation.citation_id} onClick={() => { setSelectedId(citation.citation_id); original.close(); }}>
        <strong>Source · page {citation.page ?? "?"}</strong><span>{new Date(citation.captured_at).toLocaleDateString()}</span>{citation.quote && <small>{citation.quote}</small>}
      </button>)}
    </aside>
    <article className={"answer-board glass-board answer-" + response.status} aria-label="Recall response">
      <div className="answer-top"><span className="board-tag">{response.mode === "sources_only" ? "Sources only" : "Recall"}</span><button className="button link" onClick={() => setFocused(!focused)} aria-pressed={focused}>{focused ? "Show sources" : "Focus answer"}</button></div>
      <h2>{title}</h2>{response.answer && <p className="answer-copy">{response.answer}</p>}
      {response.limitations.length > 0 && <p className="muted">{response.limitations.join(" ")}</p>}
      {response.reason && <p className="muted">{response.reason}</p>}
      {selected?.quote && <blockquote>{selected.quote}</blockquote>}
      {selected && <button className="button evidence-action" disabled={!selected.source_id} onClick={() => selected.source_id && void original.load(selected.source_id)}>View evidence · page {selected.page ?? "?"} ↗</button>}
    </article>
    <aside className="evidence-board glass-board" aria-label="Source evidence">
      <div className="section-head"><h2>Evidence</h2>{(original.loading || original.url || original.error) && <button className="button link" onClick={original.close}>Close evidence</button>}</div>
       {selected ? <><p className="muted">Source · page {selected.page ?? "?"} · captured {new Date(selected.captured_at).toLocaleDateString()}</p>{selected.epistemic_state && <p className="state">{selected.epistemic_state.replaceAll("_", " ")}</p>}<p className="evidence-quote">{selected.quote || "No excerpt supplied."}</p></> : <p className="muted">A supported answer needs eligible source evidence.</p>}
      {original.loading && <p role="status">Checking original integrity…</p>}
      {original.error && <p className="error" role="alert">{original.error}</p>}
      {original.url && <img className="source-image" src={original.url} alt="Cited original"/>}
      {!original.url && !original.loading && selected && <button className="button" disabled={!selected.source_id} onClick={() => selected.source_id && void original.load(selected.source_id)}>Open original</button>}
    </aside>
  </div>;
}
function deviceId(): string { const key = "recall-web-device-id"; const existing = localStorage.getItem(key); if (existing)
    return existing; const next = crypto.randomUUID(); localStorage.setItem(key, next); return next; }
