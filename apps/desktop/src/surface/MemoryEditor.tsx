import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { VaultMemory } from "../platform/local-vault";
import { EditorSession, type EditorIntent } from "./editor-session";
import { NoteMarkdown } from "./NoteMarkdown";
import { graphTitle } from "./adaptive-graph";
export function MemoryEditor({
  identity,
  memory,
  value,
  onChange,
  commit,
  memories,
  onOpen,
  disabled,
  onAttach,
  onResetAttachment,
  onAttachment,
}: {
  identity: string;
  memory: VaultMemory;
  value: string;
  onChange: (value: string) => void;
  commit: (intent: EditorIntent) => Promise<VaultMemory>;
  memories: VaultMemory[];
  onOpen: (memory: VaultMemory) => void;
  disabled: boolean;
  onAttach?: () => void;
  onResetAttachment?: () => void;
  onAttachment?: (fileName: string) => void;
}) {
  const callbacks = useRef({ commit, onChange });
  callbacks.current = { commit, onChange };
  const session = useMemo(
    () =>
      new EditorSession(identity, memory, localStorage, (intent) =>
        callbacks.current.commit(intent),
      ),
    [identity, memory.id],
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const [preview, setPreview] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const incoming = useRef(value);
  useEffect(() => {
    session.reconcile(memory);
  }, [session, memory]);
  useEffect(() => {
    if (value !== incoming.current) {
      incoming.current = value;
      if (
        value !== session.getSnapshot().body &&
        value !== session.getSnapshot().latestBody
      )
        session.propose(value);
    }
  }, [value, session]);
  useEffect(() => {
    if (!state.dirty || state.paused || disabled || state.saving) return;
    const timer = setTimeout(() => void session.save(), 1000);
    return () => clearTimeout(timer);
  }, [state.dirty, state.body, state.paused, state.saving, disabled, session]);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (session.getSnapshot().dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [session]);
  function change(body: string) {
    session.edit(body);
    incoming.current = body;
    callbacks.current.onChange(body);
  }
  function format(before: string, after = "", placeholder = "text") {
    const input = field.current;
    if (!input) return;
    const start = input.selectionStart,
      end = input.selectionEnd;
    const selected = state.body.slice(start, end) || placeholder;
    change(
      state.body.slice(0, start) +
        before +
        selected +
        after +
        state.body.slice(end),
    );
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    });
  }
  return (
    <section className="memory-editor" aria-label="Native memory editor">
      <div className="editor-top">
        <span>Your note</span>
        {onAttach && (
          <button
            type="button"
            disabled={disabled || state.dirty || state.saving || state.paused}
            onClick={onAttach}
          >
            Attach file
          </button>
        )}
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {state.paused && (
        <div className="editor-conflict" role="alert">
          <p>{state.message}</p>
          {state.latestBody !== state.body && (
            <details>
              <summary>Review latest library content</summary>
              <pre>{state.latestBody}</pre>
            </details>
          )}
          <button
            type="button"
            disabled={state.saving}
            onClick={() => {
              session.acceptLatest();
              change(session.getSnapshot().body);
            }}
          >
            Use latest saved version
          </button>
          <button
            type="button"
            disabled={
              state.saving ||
              Boolean(memory.conflict) ||
              memory.state !== "active"
            }
            onClick={() => session.keepDraftAfterReview()}
          >
            Keep my draft after review
          </button>
        </div>
      )}
      {!preview && (
        <details className="editor-formatting">
          <summary>Formatting &amp; links</summary>
          <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
            {[
              ["Bold", "**", "**"],
              ["Italic", "*", "*"],
              ["Heading", "## ", ""],
              ["Bullet list", "- ", ""],
              ["Checklist", "- [ ] ", ""],
              ["Quote", "> ", ""],
              ["Code", "`", "`"],
            ].map(([label, before, after]) => (
              <button
                key={label}
                type="button"
                disabled={disabled}
                aria-label={label}
                onClick={() => format(before!, after!)}
              >
                {label}
              </button>
            ))}
            <label>
              Link a memory
              <select
                aria-label="Link a memory"
                value=""
                disabled={disabled}
                onChange={(event) => {
                  const target = memories.find(
                    (m) => m.id === event.target.value,
                  );
                  if (target?.note_path) {
                    const label = graphTitle(target)
                      .replaceAll("[", " ")
                      .replaceAll("]", " ")
                      .replaceAll("|", " ")
                      .replaceAll("\n", " ");
                    format(
                      `[[Recall/Memories/${target.note_path.replace(/\.md$/, "")}|`,
                      "]]",
                      label,
                    );
                  }
                }}
              >
                <option value="">Choose memory…</option>
                {memories
                  .filter(
                    (m) =>
                      m.id !== memory.id &&
                      m.state === "active" &&
                      !m.conflict &&
                      m.note_path,
                  )
                  .map((m) => (
                    <option value={m.id} key={m.id}>
                      {graphTitle(m)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </details>
      )}
      <form
        className="ms-form"
        onSubmit={(event) => {
          event.preventDefault();
          const reviewedProposal = session.getSnapshot().reviewRequired;
          if (reviewedProposal) session.keepDraftAfterReview();
          void session.save(reviewedProposal);
        }}
      >
        <label className="ms-sr" htmlFor={`editor-${memory.id}`}>Your correction</label>
        {preview ? (
          <NoteMarkdown
            memories={memories}
            onOpen={onOpen}
            onAttachment={onAttachment}
          >
            {state.body}
          </NoteMarkdown>
        ) : (
          <textarea
            ref={field}
            id={`editor-${memory.id}`}
            value={state.body}
            disabled={memory.state !== "active" || Boolean(memory.conflict)}
            onChange={(event) => change(event.target.value)}
            onKeyDown={(event) => {
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === "s"
              ) {
                event.preventDefault();
                if (!disabled && !state.saving) void session.save();
              }
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === "b"
              ) {
                event.preventDefault();
                format("**", "**");
              }
            }}
          />
        )}
        <div className="editor-save">
          <button
            className="ms-primary"
            type="submit"
            disabled={
              disabled ||
              state.saving ||
              memory.state !== "active" ||
              Boolean(memory.conflict)
            }
          >
            {state.paused && !state.reviewRequired
              ? "Retry last save"
              : "Save correction"}
          </button>
          <span role="status">
            {state.message} · revision {state.revision}
          </span>
        </div>
        {state.error && <p role="alert">{state.error}</p>}
      </form>
      <p className="ms-fine">Edits save automatically as human revisions. Your original stays unchanged.</p>
      {onAttach && onResetAttachment && (
        <details>
          <summary>Attachment recovery</summary>
          <p>
            Retry Attach file to resume the previous attempt. Start a new
            attempt only after reviewing an error; any saved attachment bytes
            and receipts stay in your library.
          </p>
          <button
            type="button"
            disabled={disabled || state.saving}
            onClick={onResetAttachment}
          >
            Clear pending attachment attempt
          </button>
        </details>
      )}
    </section>
  );
}
