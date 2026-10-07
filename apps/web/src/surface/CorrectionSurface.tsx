import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  type Claim,
  type MemoryDetail,
  type RecallApiClient,
} from "@recall/api-client";
import { GlassBoard } from "./primitives";

export function CorrectionSurface({
  memory,
  claim,
  api,
  onSaved,
  onCancel,
  onSavingChange,
  onFailure,
}: {
  memory: MemoryDetail;
  claim: Claim | null;
  api: Pick<RecallApiClient, "correctMemory">;
  onSaved: (memory: MemoryDetail) => void;
  onCancel: () => void;
  onSavingChange: (saving: boolean) => void;
  onFailure: (failure: unknown) => void;
}) {
  const original = claim?.text ?? memory.interpretation.summary ?? "";
  const [text, setText] = useState(original);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(crypto.randomUUID());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    onSavingChange(true);
    setError(null);
    try {
      const updated = await api.correctMemory(
        memory.memory_id,
        {
          target: claim ? "claim" : "summary",
          ...(claim ? { claim_id: claim.claim_id } : {}),
          text: text.trim(),
        },
        operation.current,
        memory.revision,
      );
      if (live.current) onSaved(updated);
    } catch (failure) {
      if (live.current) {
        onFailure(failure);
        setError(
          failure instanceof ApiError && failure.status === 409
            ? "This memory changed while you were correcting it. Return to the memory and reload it before trying again. Your correction has not replaced the newer revision."
            : failure instanceof Error
              ? failure.message
              : "Correction could not be saved. Your original is unchanged.",
        );
      }
    } finally {
      if (live.current) {
        setBusy(false);
        onSavingChange(false);
      }
    }
  };
  return (
    <GlassBoard
      className="primary-board correction-board"
      label="Correct understanding"
    >
      <p className="eyebrow">A better understanding</p>
      <h1>What should Recall understand?</h1>
      <blockquote>{original}</blockquote>
      {!preview ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            operation.current = crypto.randomUUID();
            setPreview(true);
          }}
        >
          <label htmlFor="correction-text">
            What should Recall understand?
          </label>
          <textarea
            id="correction-text"
            autoFocus
            value={text}
            maxLength={10000}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="button primary"
            disabled={!text.trim() || text.trim() === original}
          >
            Review affected scope
          </button>
        </form>
      ) : (
        <div className="correction-preview">
          <p className="eyebrow">Affected scope · this memory</p>
          <p className="statement">{text}</p>
          <p>
            This replaces {claim ? "one statement" : "the summary"} in revision{" "}
            {memory.revision} of this memory. Recall’s derived understanding and
            search may change.
          </p>
          <p>
            Original evidence stays unchanged. Previous understanding remains in
            history.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Saving correction…" : "Confirm correction"}
          </button>
          <button
            className="button link"
            disabled={busy}
            onClick={() => setPreview(false)}
          >
            Keep editing
          </button>
        </div>
      )}
      <button className="button link" disabled={busy} onClick={onCancel}>
        Cancel correction
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </GlassBoard>
  );
}
