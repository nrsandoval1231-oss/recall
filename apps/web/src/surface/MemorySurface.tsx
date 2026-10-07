import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  type AskResponse,
  type Citation,
  type Claim,
  type EntityDetail,
  type MemoryDetail,
  type RecallApiClient,
  type ServerCapture,
} from "@recall/api-client";
import { serverStatusKey, statusPresentation } from "@recall/design-tokens";
import { AskForm } from "./AskSurface";
import { Reconstruction } from "./Reconstruction";
import { MemoryFocus } from "./MemoryFocus";
import { EntityFocus } from "./EntityFocus";
import {
  GlassBoard,
  EvidenceArtifact,
  ArrowIcon,
  displayDate,
  useReducedMotion,
} from "./primitives";
import { useEvidenceLayer } from "./useEvidenceLayer";
import { CorrectionSurface } from "./CorrectionSurface";

export type SurfaceApi = Pick<
  RecallApiClient,
  "ask" | "getMemory" | "getEntity" | "fetchSource" | "correctMemory"
>;
type ResultView = {
  kind: "result";
  response: AskResponse;
  asOf: string;
  invalidated?: boolean;
};
type MemoryView = {
  kind: "memory";
  memory: MemoryDetail;
  citation?: Citation;
  notice?: string;
};
type View =
  | { kind: "home" | "capture" | "recent" | "settings" }
  | ResultView
  | MemoryView
  | { kind: "historical"; citation: Citation; asOf: string }
  | { kind: "entity"; entity: EntityDetail; invalidated?: boolean }
  | {
      kind: "evidence";
      sourceId: string;
      page: number | null;
      title: string;
      quote: string;
      expectedHash?: string;
    };
type Snapshot = {
  view: View;
  question: string;
  scroll: number;
  focus: string | null;
  supportCount: number;
  asOf: string;
};
interface Props {
  api: SurfaceApi;
  captures: ServerCapture[];
  capturePanel?: ReactNode;
  settingsPanel?: ReactNode;
  accountControls?: ReactNode;
  notices?: ReactNode;
  synthetic?: boolean;
  onAccessDenied?: () => void;
}

/** One environment, with reversible bounded compositions and explicit async ownership. */
export function MemorySurface({
  api,
  captures,
  capturePanel,
  settingsPanel,
  accountControls,
  notices,
  synthetic = false,
  onAccessDenied,
}: Props) {
  const [view, setView] = useState<View>({ kind: "home" });
  const [question, setQuestion] = useState("");
  const [asOf, setAsOf] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<Snapshot[]>([]);
  const [edit, setEdit] = useState<{ claim: Claim | null } | null>(null);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [supportCount, setSupportCount] = useState(3);
  const sequence = useRef(0);
  const heading = useRef<HTMLDivElement>(null);
  const restore = useRef<Snapshot | null>(null);
  const reduced = useReducedMotion();
  const evidence = useEvidenceLayer();
  const sourceFailure = useCallback(
    (failure: unknown) => {
      if (
        failure instanceof ApiError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        sequence.current++;
        evidence.clear();
        setView({ kind: "home" });
        setStack([]);
        setBusy(false);
        setEdit(null);
        setError("Your session no longer has access to this memory.");
        onAccessDenied?.();
      }
    },
    [evidence.clear, onAccessDenied],
  );
  useEffect(
    () => () => {
      sequence.current++;
    },
    [api],
  );
  useEffect(() => {
    const previous = restore.current;
    restore.current = null;
    const control = previous?.focus
      ? Array.from(
          document.querySelectorAll<HTMLElement>("[data-focus-key]"),
        ).find((el) => el.dataset.focusKey === previous.focus)
      : null;
    (control ?? heading.current)?.focus({ preventScroll: true });
    if (previous)
      window.scrollTo({ top: previous.scroll, behavior: "instant" });
  }, [view]);
  const snapshot = (): Snapshot => ({
    view,
    question,
    scroll: window.scrollY,
    supportCount,
    asOf,
    focus:
      (document.activeElement as HTMLElement | null)?.dataset.focusKey ?? null,
  });
  const move = (next: View, previous = snapshot()) => {
    setStack((old) => [...old, previous].slice(-20));
    setView(next);
    setError(null);
    setSupportCount(3);
  };
  const navigate = (next: View) => {
    sequence.current++;
    setBusy(false);
    setEdit(null);
    move(next);
  };
  const home = () => {
    sequence.current++;
    setBusy(false);
    setEdit(null);
    setError(null);
    setView({ kind: "home" });
    setStack([]);
    setAsOf("");
    evidence.clear();
  };
  const back = () => {
    sequence.current++;
    setBusy(false);
    setError(null);
    if (edit) {
      setEdit(null);
      return;
    }
    const previous = stack.at(-1);
    if (!previous) {
      home();
      return;
    }
    restore.current = previous;
    setView(previous.view);
    setQuestion(previous.question);
    setAsOf(previous.asOf);
    setSupportCount(previous.supportCount);
    setStack((old) => old.slice(0, -1));
  };
  const request = async <T,>(
    work: () => Promise<T>,
    complete: (value: T, prior: Snapshot) => void,
  ) => {
    const ticket = ++sequence.current;
    const prior = snapshot();
    setBusy(true);
    setError(null);
    try {
      const value = await work();
      if (sequence.current === ticket) complete(value, prior);
    } catch (failure) {
      if (sequence.current === ticket) {
        sourceFailure(failure);
        setError(
          failure instanceof Error
            ? failure.message
            : "Recall is unavailable. Your originals are unaffected.",
        );
      }
    } finally {
      if (sequence.current === ticket) setBusy(false);
    }
  };
  const ask = (q = question, date = "") => {
    if (!q.trim()) return;
    setEdit(null);
    void request(
      () => api.ask(q.trim(), date ? { as_of: `${date}T23:59:59.999Z` } : {}),
      (response, prior) => {
        setQuestion(q);
        setAsOf(date);
        move({ kind: "result", response, asOf: date }, prior);
      },
    );
  };
  const focusMemory = (memoryId: string, citation?: Citation) => {
    if (
      view.kind === "result" &&
      (view.asOf ||
        (view.response.temporal_mode &&
          view.response.temporal_mode !== "current")) &&
      citation
    ) {
      navigate({ kind: "historical", citation, asOf: view.asOf });
      return;
    }
    void request(
      () => api.getMemory(memoryId),
      (memory, prior) =>
        move(
          {
            kind: "memory",
            memory,
            citation,
            ...(citation && citation.memory_revision !== memory.revision
              ? {
                  notice:
                    "This understanding changed since the answer was reconstructed. The cited original remains available.",
                }
              : {}),
          },
          prior,
        ),
    );
  };
  const focusEntity = (entityId: string) =>
    void request(
      () => api.getEntity(entityId),
      (entity, prior) => move({ kind: "entity", entity }, prior),
    );
  const inspect = (
    sourceId: string,
    page: number | null,
    title: string,
    quote: string,
    expectedHash?: string,
  ) =>
    navigate({ kind: "evidence", sourceId, page, title, quote, expectedHash });
  const corrected = (memory: MemoryDetail) => {
    sequence.current++;
    setEdit(null);
    setStack((old) =>
      old.map((entry) => ({
        ...entry,
        view:
          entry.view.kind === "result"
            ? { ...entry.view, invalidated: true }
            : entry.view.kind === "entity"
              ? { ...entry.view, invalidated: true }
              : entry.view.kind === "memory" &&
                  entry.view.memory.memory_id === memory.memory_id
                ? { ...entry.view, memory }
                : entry.view,
      })),
    );
    setView({
      kind: "memory",
      memory,
      notice:
        "Correction saved. The original and previous understanding are preserved.",
    });
  };
  return (
    <main
      className={`memory-surface state-${view.kind}`}
      data-reduced-motion={String(reduced)}
    >
      <a className="skip-link" href="#surface-focus">
        Skip to memory
      </a>
      <header className="surface-header">
        <button
          className="wordmark"
          aria-label="Recall home"
          disabled={savingCorrection}
          onClick={home}
        >
          Recall<span className="wordmark-dot">•</span>
        </button>
        <nav aria-label="Recall">
          <button
            className="nav-action"
            disabled={savingCorrection}
            onClick={home}
            aria-current={view.kind === "home" ? "page" : undefined}
          >
            Ask
          </button>
          <button
            className="nav-action"
            disabled={savingCorrection}
            data-focus-key="capture-nav"
            onClick={() => navigate({ kind: "capture" })}
          >
            Capture
          </button>
          <button
            className="nav-action"
            disabled={savingCorrection}
            data-focus-key="recent-nav"
            onClick={() => navigate({ kind: "recent" })}
          >
            Recent
          </button>
        </nav>
        <button
          className="workspace-control"
          aria-label="Workspace settings"
          disabled={savingCorrection}
          onClick={() => navigate({ kind: "settings" })}
        >
          Private workspace <ArrowIcon />
        </button>
      </header>
      {synthetic && (
        <p className="fixture-banner">
          Synthetic design world · development only · nothing here enters your
          memory
        </p>
      )}
      <div className="surface-path">
        {view.kind !== "home" && (
          <button
            className="back-control"
            disabled={savingCorrection}
            onClick={back}
            aria-label="Back"
          >
            <ArrowIcon back />
            <span>Back</span>
          </button>
        )}
        <span>
          {view.kind === "result" && view.asOf
            ? `Historical understanding · ${displayDate(view.asOf)}`
            : view.kind === "historical"
              ? view.asOf
                ? `What you knew by ${displayDate(view.asOf)}`
                : "Earlier understanding"
              : view.kind !== "home"
                ? "Your memory, in focus"
                : "Your life remembers itself."}
        </span>
      </div>
      <div
        id="surface-focus"
        className="surface-stage"
        ref={heading}
        tabIndex={-1}
        aria-busy={busy}
      >
        {view.kind === "home" ? (
          <div className="home-center">
            <p className="eyebrow">A little less to hold on to.</p>
            <h1>
              What do you need
              <br />
              to remember?
            </h1>
            <AskForm
              question={question}
              setQuestion={setQuestion}
              onAsk={() => ask()}
              busy={busy}
            />
            <p className="home-hint">
              A name. A moment. Something you almost remember.
            </p>
            <button
              className="home-capture"
              onClick={() => navigate({ kind: "capture" })}
            >
              + <span>Remember something new</span>
            </button>
            {captures.length > 0 && (
              <button
                className="recent-thread"
                data-focus-key="recent-thread"
                onClick={() => navigate({ kind: "recent" })}
              >
                <span className="thread-dot" /> Last remembered{" "}
                <span>
                  {captures[0]?.context_hint || "a captured original"}
                </span>
                <ArrowIcon />
              </button>
            )}
          </div>
        ) : edit && view.kind === "memory" ? (
          <CorrectionSurface
            memory={view.memory}
            claim={edit.claim}
            api={api}
            onSaved={corrected}
            onCancel={() => setEdit(null)}
            onSavingChange={setSavingCorrection}
            onFailure={sourceFailure}
          />
        ) : view.kind === "capture" ? (
          <GlassBoard label="Capture" className="primary-board capture-board">
            <p className="eyebrow">Let it go. Keep the memory.</p>
            <h1>Remember this.</h1>
            {capturePanel ?? (
              <p>
                Capture is unavailable in this development world. No synthetic
                originals are uploaded.
              </p>
            )}
          </GlassBoard>
        ) : view.kind === "settings" ? (
          <GlassBoard label="Workspace settings" className="primary-board">
            <p className="eyebrow">Your memory stays yours.</p>
            <h1>Private by design.</h1>
            {settingsPanel}
            {accountControls}
          </GlassBoard>
        ) : view.kind === "recent" ? (
          <GlassBoard label="Recent memory" className="primary-board">
            <p className="eyebrow">Recently remembered</p>
            <h1>A way back in.</h1>
            <p className="muted">
              Originals remain available even when Recall has not finished
              reading them.
            </p>
            {captures.length === 0 ? (
              <p className="empty">Your saved originals will appear here.</p>
            ) : (
              <div className="recent-list">
                {captures.map((capture) => {
                  const status =
                    statusPresentation[
                      serverStatusKey(capture.status, capture.processing)
                    ];
                  return (
                    <button
                      className="memory-link"
                      data-focus-key={`capture-${capture.capture_id}`}
                      key={capture.capture_id}
                      onClick={() => {
                        const page = capture.pages[0];
                        if (capture.memory_id) focusMemory(capture.memory_id);
                        else if (page)
                          inspect(
                            page.source_id,
                            page.ordinal,
                            capture.context_hint ?? "Your original",
                            "",
                            page.declared_sha256,
                          );
                      }}
                    >
                      <span>
                        {capture.context_hint ?? "Captured original"}
                        <small>{displayDate(capture.captured_at)}</small>
                      </span>
                      <span className="state-label" title={status.detail}>
                        {status.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </GlassBoard>
        ) : view.kind === "result" ? (
          <Reconstruction
            view={view}
            question={question}
            setQuestion={setQuestion}
            busy={busy}
            asOf={asOf}
            setAsOf={setAsOf}
            ask={ask}
            inspect={inspect}
            focusMemory={focusMemory}
            supportCount={supportCount}
            setSupportCount={setSupportCount}
          />
        ) : view.kind === "memory" ? (
          <MemoryFocus
            view={view}
            evidence={evidence}
            setEdit={setEdit}
            focusEntity={focusEntity}
            inspect={inspect}
            supportCount={supportCount}
            setSupportCount={setSupportCount}
          />
        ) : view.kind === "historical" ? (
          <GlassBoard label="Historical memory" className="primary-board">
            <p className="eyebrow">Historical evidence</p>
            <h1>What the source said then.</h1>
            <blockquote>{view.citation.quote}</blockquote>
            <p>
              {view.asOf
                ? `As known by ${displayDate(view.asOf)}`
                : "Historical understanding"}{" "}
              · source captured {displayDate(view.citation.captured_at)} ·
              revision {view.citation.memory_revision}
            </p>
            <p className="muted">
              Today’s interpretation and identity links are kept out of this
              historical view.
            </p>
            {view.citation.source_id && (
              <button
                className="source-reveal"
                onClick={() =>
                  inspect(
                    view.citation.source_id!,
                    view.citation.page,
                    "Historical evidence",
                    view.citation.quote,
                  )
                }
              >
                Reveal original{" "}
                <span>
                  Page {view.citation.page ?? "unknown"} <ArrowIcon />
                </span>
              </button>
            )}
          </GlassBoard>
        ) : view.kind === "entity" ? (
          <EntityFocus
            view={view}
            ask={ask}
            focusMemory={focusMemory}
            focusEntity={focusEntity}
            supportCount={supportCount}
            setSupportCount={setSupportCount}
          />
        ) : view.kind === "evidence" ? (
          <div className="evidence-composition">
            <GlassBoard
              label="Supporting interpretation"
              className="context-board yielded-understanding"
            >
              <p className="eyebrow">Understanding yields to evidence</p>
              <h2>{view.title}</h2>
              {view.quote && <blockquote>{view.quote}</blockquote>}
              <p className="muted">
                This is Recall’s reading.
                <br />
                The original is yours to inspect.
              </p>
            </GlassBoard>
            <EvidenceArtifact
              key={view.sourceId}
              api={api}
              sourceId={view.sourceId}
              page={view.page}
              expectedHash={view.expectedHash}
              onVerified={evidence.retain}
              onStart={evidence.forget}
              onFailure={sourceFailure}
            />
          </div>
        ) : null}
        {busy && (
          <p className="surface-loading" role="status">
            Bringing memory into focus…
          </p>
        )}
        {error && (
          <p className="surface-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {notices && <div className="surface-notices">{notices}</div>}
      <footer className="surface-footer">
        <span>Recall</span>
        <span>
          {synthetic
            ? "Synthetic evidence · no live memory"
            : "Evidence preserved. Understanding evolves."}
        </span>
      </footer>
    </main>
  );
}
