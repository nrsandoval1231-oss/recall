import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  RecallApiClient,
  sha256Hex,
  type CaptureManifest,
  type MediaType,
  type ServerCapture,
} from "@recall/api-client";
import {
  deleteDraft,
  draftPage,
  listDrafts,
  saveDraft,
  type Draft,
} from "./storage";
import type { BrowserAuth, BrowserSession } from "./auth/session";
import { serverStatusKey, statusPresentation } from "@recall/design-tokens";
import { MemorySurface } from "./surface/MemorySurface";

interface Services {
  auth: BrowserAuth;
  api: RecallApiClient;
}
const scopeFor = (session: BrowserSession) =>
  `${session.userId}:${session.workspaceId}`;

export function App({ services }: { services: Services }) {
  const [session, setSession] = useState<BrowserSession | null | undefined>();
  const [startupError, setStartupError] = useState<string | null>(null);
  const sessionSequence = useRef(0);
  const loseSession = useCallback(() => {
    sessionSequence.current++;
    setSession(null);
  }, []);
  const checkSession = () => {
    const ticket = ++sessionSequence.current;
    setStartupError(null);
    setSession(undefined);
    void services.auth
      .getSession()
      .then((value) => {
        if (sessionSequence.current === ticket) setSession(value);
      })
      .catch((failure) => {
        if (sessionSequence.current === ticket)
          setStartupError(
            failure instanceof Error
              ? failure.message
              : "Recall could not check your session.",
          );
      });
  };
  useEffect(() => {
    checkSession();
    const unsubscribe = services.auth.onChange((value) => {
      sessionSequence.current++;
      setStartupError(null);
      setSession(value);
    });
    return () => {
      sessionSequence.current++;
      unsubscribe();
    };
  }, [services]);
  if (startupError)
    return (
      <main className="signin card">
        <div className="brand">Recall</div>
        <h1>Recall is unavailable.</h1>
        <p className="error" role="alert">
          {startupError}
        </p>
        <button className="button primary" onClick={checkSession}>
          Try again
        </button>
      </main>
    );
  if (session === undefined) return <p className="empty">Loading Recall…</p>;
  return session ? (
    <Home
      key={scopeFor(session)}
      services={services}
      session={session}
      onSessionLost={loseSession}
    />
  ) : (
    <SignIn auth={services.auth} />
  );
}

function SignIn({ auth }: { auth: BrowserAuth }) {
  const cooldownKey = "recall-signin-limited-until";
  const cooldownUntil = () => {
    const value = Number(sessionStorage.getItem(cooldownKey) ?? "0");
    return Number.isFinite(value) && value > Date.now();
  };
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(cooldownUntil);
  const [busy, setBusy] = useState(false);
  const request = async () => {
    if (limited || busy || sent) return;
    setBusy(true);
    setError(null);
    try {
      await auth.requestSignIn(email.trim());
      setSent(true);
    } catch (failure) {
      if (
        failure instanceof Error &&
        failure.message === "EMAIL_RATE_LIMITED"
      ) {
        sessionStorage.setItem(
          cooldownKey,
          String(Date.now() + 60 * 60 * 1000),
        );
        setLimited(true);
        setError("Email sign-in is temporarily limited. Try again later.");
      } else
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not send the sign-in email.",
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="signin card">
      <div className="brand">Recall</div>
      <h1>Keep what matters.</h1>
      <p className="muted">
        Sign in privately. The link in your email returns here automatically.
      </p>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </div>
      <button
        className="button primary"
        onClick={() => void request()}
        disabled={busy || limited || sent || !email.includes("@")}
      >
        {busy
          ? "Sending…"
          : limited
            ? "Email sign-in temporarily limited"
            : sent
              ? "Email sent"
              : "Email me a sign-in link"}
      </button>
      {sent && (
        <p className="status" role="status">
          Check your email. Follow the link to return to Recall.
        </p>
      )}
      {limited && (
        <p className="error" role="alert">
          Email sign-in is temporarily limited. Try again later; refreshing will
          not bypass the provider limit.
        </p>
      )}
      {error && !limited && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

function Home({
  services,
  session,
  onSessionLost,
}: {
  services: Services;
  session: BrowserSession;
  onSessionLost: () => void;
}) {
  const scope = scopeFor(session);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, [scope]);
  const [captures, setCaptures] = useState<ServerCapture[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<File | null>(null);
  const [context, setContext] = useState("");
  const [captureState, setCaptureState] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiExplanation, setAiExplanation] = useState("");
  const denySession = useCallback(() => {
    setCaptures([]);
    setDrafts([]);
    onSessionLost();
  }, [onSessionLost]);
  const refresh = useCallback(async () => {
    try {
      const [identity, list, settings] = await Promise.all([
        services.api.me(),
        services.api.listCaptures({ limit: 20 }),
        services.api.getAiSettings(),
      ]);
      if (
        !active.current ||
        identity.user_id !== session.userId ||
        identity.active_workspace_id !== session.workspaceId
      )
        return;
      await services.api.registerDevice({
        device_id: deviceId(),
        platform: "web",
        name: navigator.userAgent.slice(0, 80),
        app_version: "0.1.0",
      });
      if (!active.current) return;
      setCaptures(list.items);
      setAiEnabled(settings.enabled);
      setAiConfigured(settings.ai_configured);
      setAiExplanation(settings.explanation);
      setError(null);
    } catch (failure) {
      if (
        active.current &&
        failure instanceof ApiError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        if (active.current) denySession();
        return;
      }
      if (active.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not load your captures.",
        );
    }
  }, [services.api, session.userId, session.workspaceId, denySession]);
  useEffect(() => {
    void refresh();
    void listDrafts(scope)
      .then((items) => {
        if (active.current) setDrafts(items);
      })
      .catch((failure) => {
        if (active.current)
          setError(
            failure instanceof Error
              ? failure.message
              : "Local captures could not be loaded.",
          );
      });
  }, [refresh, scope]);
  const preview = useMemo(
    () => (selected ? URL.createObjectURL(selected) : null),
    [selected],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const uploadDraft = async (draft: Draft) => {
    const page = draft.manifest.pages[0];
    if (!page) throw new Error("This saved capture has no page.");
    const bytes = await draft.files[page.client_page_id]?.arrayBuffer();
    if (!bytes) throw new Error("The saved original is unavailable.");
    setCaptureState("Uploading · your original is saved on this device.");
    const server = await services.api.createCapture(draft.manifest, draft.id);
    if (
      server.pages.length === draft.manifest.pages.length &&
      server.pages.every(
        (page) =>
          page.upload_state === "verified" &&
          page.server_sha256 === page.declared_sha256,
      )
    ) {
      return services.api.finalize(
        server.capture_id,
        server.pages.map((page) => ({
          source_id: page.source_id,
          sha256: page.declared_sha256,
        })),
        draft.id,
      );
    }
    const auths = await services.api.authorizeUploads(server.capture_id);
    const authorization =
      auths.find((item) => item.source_id === server.pages[0]?.source_id) ??
      auths[0];
    if (!authorization)
      throw new Error("Recall did not provide an upload authorization.");
    const uploaded = await services.api.putUpload(authorization, bytes);
    return services.api.finalize(
      server.capture_id,
      [{ source_id: authorization.source_id, sha256: uploaded.sha256 }],
      draft.id,
    );
  };
  const capture = async () => {
    if (!selected) return;
    setBusy(true);
    setCaptureState("Saving locally · upload has not started.");
    setError(null);
    let savedLocally = false;
    try {
      const mediaType = selected.type as MediaType;
      if (
        !["image/jpeg", "image/png", "image/heic", "image/heif"].includes(
          mediaType,
        )
      )
        throw new Error("Choose a JPEG, PNG, HEIC, or HEIF image.");
      const bytes = await selected.arrayBuffer();
      const captureId = crypto.randomUUID();
      const pageId = crypto.randomUUID();
      const manifest: CaptureManifest = {
        schema_version: "1.0",
        client_capture_id: captureId,
        device_id: deviceId(),
        captured_at: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        source_kind: "handwritten_note",
        context_hint: context.trim() || null,
        pages: [
          {
            client_page_id: pageId,
            ordinal: 1,
            media_type: mediaType,
            byte_size: selected.size,
            sha256: await sha256Hex(bytes),
            original_filename: selected.name || null,
          },
        ],
      };
      const draft = draftPage(scope, manifest, manifest.pages[0]!, selected);
      await saveDraft(draft);
      savedLocally = true;
      setCaptureState("Saved on this device · not uploaded yet.");
      if (!active.current) return;
      setDrafts(await listDrafts(scope));
      const finalized = await uploadDraft(draft);
      if (!active.current) return;
      await deleteDraft(captureId);
      setDrafts(await listDrafts(scope));
      setSelected(null);
      setContext("");
      const state =
        statusPresentation[
          serverStatusKey(finalized.status, finalized.processing)
        ];
      setCaptureState(null);
      setMessage(`Saved. ${state.label}. ${state.detail}`);
      await refresh();
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        if (active.current) denySession();
        return;
      }
      if (active.current)
        setCaptureState(
          savedLocally
            ? "Upload failed · original saved on this device. Retry in Capture."
            : "Not saved · keep the selected original and try again.",
        );
      if (active.current)
        setError(
          failure instanceof ApiError && failure.retryable
            ? `${failure.message} Your original is still saved on this device; try again.`
            : failure instanceof Error
              ? failure.message
              : "Capture failed. Your original remains saved locally.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const resume = async (draft: Draft) => {
    setBusy(true);
    setError(null);
    try {
      await uploadDraft(draft);
      if (!active.current) return;
      await deleteDraft(draft.id);
      setDrafts(await listDrafts(scope));
      setCaptureState(null);
      setMessage("Saved original uploaded successfully.");
      await refresh();
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        if (active.current) denySession();
        return;
      }
      if (active.current)
        setCaptureState(
          "Upload failed · original saved on this device. Retry in Capture.",
        );
      if (active.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Retry failed. The original remains saved on this device.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const removeDraft = async (draft: Draft) => {
    if (
      !window.confirm(
        "Remove this unsynced original from this browser? This cannot be undone.",
      )
    )
      return;
    try {
      await deleteDraft(draft.id);
      if (active.current) setDrafts(await listDrafts(scope));
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not remove this local original.",
        );
    }
  };
  const toggleAi = async () => {
    setBusy(true);
    try {
      const next = await services.api.setAiEnabled(!aiEnabled);
      if (active.current) setAiEnabled(next.enabled);
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        if (active.current) denySession();
        return;
      }
      if (active.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "AI reading could not be changed.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <MemorySurface
      api={services.api}
      captures={captures}
      onAccessDenied={denySession}
      capturePanel={
        <>
          <label className="dropzone" htmlFor="capture-file">
            <span>
              <strong>
                {selected ? "Ready to save" : "Choose a photo of your note"}
              </strong>
              <span className="muted">
                Your original is saved in this browser before upload.
              </span>
            </span>
            <span className="button primary">
              {selected ? "Choose a different photo" : "Choose photo"}
            </span>
            <input
              id="capture-file"
              className="capture-input"
              aria-label="Choose a photo of your note"
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif"
              onChange={(event) => setSelected(event.target.files?.[0] ?? null)}
            />
          </label>
          {selected && (
            <div className="preview">
              {preview && <img src={preview} alt="Selected note preview" />}
              <span>
                <strong>{selected.name}</strong>
                <br />
                <span className="muted">
                  {Math.round(selected.size / 1024)} KB · selected locally, not
                  saved yet
                </span>
              </span>
            </div>
          )}
          <div className="field">
            <label htmlFor="context">Context (optional)</label>
            <textarea
              id="context"
              value={context}
              onChange={(event) => setContext(event.target.value)}
              placeholder="A hint for your future self"
            />
          </div>
          <button
            className="button primary"
            onClick={() => void capture()}
            disabled={busy || !selected}
          >
            {busy ? "Saving original…" : "Save original"}
          </button>
          {drafts.length > 0 && (
            <div className="status">
              <strong>
                {drafts.length} saved original{drafts.length === 1 ? "" : "s"}{" "}
                on this device.
              </strong>
              <br />
              <span className="muted">
                Pending originals stay on this browser until you explicitly
                retry or remove them.
              </span>
              {drafts.map((draft) => (
                <div key={draft.id}>
                  <span className="muted">
                    {draft.manifest.context_hint || "Untitled note"}
                  </span>{" "}
                  <button
                    className="button link"
                    onClick={() => void resume(draft)}
                    disabled={busy}
                  >
                    Retry upload
                  </button>
                  <button
                    className="button link"
                    onClick={() => void removeDraft(draft)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="capture-state">
            {captureState
              ? captureState
              : selected
                ? "Selected locally · save to preserve this original"
                : "Photograph or import. Save. Leave."}
          </p>
        </>
      }
      settingsPanel={
        <div className="settings">
          <div>
            <strong>AI reading</strong>
            <p className="muted">
              {aiConfigured
                ? aiExplanation ||
                  "Turn on when you want searchable interpretations."
                : "AI reading is not configured yet."}
            </p>
          </div>
          <button
            className="button"
            onClick={() => void toggleAi()}
            disabled={busy || !aiConfigured}
            aria-pressed={aiEnabled}
          >
            {aiEnabled ? "On" : "Off"}
          </button>
        </div>
      }
      accountControls={
        <button
          className="button link"
          disabled={busy}
          title={
            busy ? "Finish saving this original before signing out." : undefined
          }
          onClick={() =>
            void services.auth
              .signOut()
              .catch(() => setError("Could not sign out. Try again."))
          }
        >
          Sign out
        </button>
      }
      notices={
        <>
          {captureState && (
            <p className="status" role="status">
              {captureState}
            </p>
          )}
          {message && (
            <p className="status" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {drafts.length > 0 && !busy && (
            <p className="status">
              {drafts.length} saved original{drafts.length === 1 ? "" : "s"}{" "}
              waiting to upload. Open Capture to retry.
            </p>
          )}
          <button
            className="button link refresh-control"
            onClick={() => void refresh()}
          >
            Refresh memory
          </button>
        </>
      }
    />
  );
}

function deviceId(): string {
  const key = "recall-web-device-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}
