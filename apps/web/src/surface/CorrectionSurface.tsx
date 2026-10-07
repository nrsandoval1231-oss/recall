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
  onReloaded,
  onCancel,
  onSavingChange,
  onFailure,
}: {
  memory: MemoryDetail;
  claim: Claim | null;
  api: Pick<RecallApiClient, "correctMemory" | "getMemory">;
  onSaved: (memory: MemoryDetail) => void;
  onReloaded: (memory: MemoryDetail) => void;
  onCancel: () => void;
  onSavingChange: (saving: boolean) => void;
  onFailure: (failure: unknown) => void;
}) {
  const [baseline, setBaseline] = useState(memory);
  const targetClaim = claim
    ? baseline.claims?.find((c) => c.claim_id === claim.claim_id)
    : null;
  const targetAvailable =
    !claim ||
    Boolean(targetClaim && targetClaim.epistemic_state !== "retracted");
  const original = claim
    ? (targetClaim?.text ?? "This statement is no longer available.")
    : (baseline.interpretation.summary ?? "");
  const [text, setText] = useState(
    claim?.text ?? memory.interpretation.summary ?? "",
  );
  const [conflict, setConflict] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(crypto.randomUUID());
  const live = useRef(true);
  const sequence = useRef(0);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (preview ? confirm.current : textInput.current)?.focus();
  }, [preview]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      sequence.current++;
    };
  }, [api]);
  const reload = async () => {
    if (loading || busy) return;
    const ticket = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const latest = await api.getMemory(memory.memory_id);
      if (!live.current || sequence.current !== ticket) return;
      if (
        latest.memory_id !== memory.memory_id ||
        latest.revision < baseline.revision
      )
        throw new Error(
          "The latest understanding could not be verified. Your draft is preserved; reload again.",
        );
      setBaseline(latest);
      setConflict(false);
      setReviewRequired(true);
      setReviewed(false);
      setPreview(false);
      onReloaded(latest);
      textInput.current?.focus();
    } catch (failure) {
      if (live.current && sequence.current === ticket) {
        onFailure(failure);
        if (
          failure instanceof ApiError &&
          failure.status === 409 &&
          failure.code === "VERSION_CONFLICT"
        ) {
          setConflict(true);
          setReviewed(false);
          setReviewRequired(false);
          setPreview(false);
        }
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not reload. Your correction draft is preserved.",
        );
      }
    } finally {
      if (live.current && sequence.current === ticket) setLoading(false);
    }
  };
  const save = async () => {
    if (
      busy ||
      loading ||
      conflict ||
      !targetAvailable ||
      (reviewRequired && !reviewed)
    )
      return;
    const ticket = ++sequence.current;
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
        baseline.revision,
      );
      if (live.current && sequence.current === ticket) onSaved(updated);
    } catch (failure) {
      if (live.current && sequence.current === ticket) {
        onFailure(failure);
        if (
          failure instanceof ApiError &&
          failure.status === 409 &&
          failure.code === "VERSION_CONFLICT"
        ) {
          setConflict(true);
          setReviewed(false);
          setReviewRequired(false);
          setPreview(false);
        }
        setError(
          failure instanceof ApiError &&
            failure.status === 409 &&
            failure.code === "VERSION_CONFLICT"
            ? "This memory changed while you were correcting it. Your draft is preserved. Reload the latest understanding and review it before trying again. Your correction has not replaced the newer revision."
            : failure instanceof Error
              ? failure.message
              : "Correction could not be saved. Your original is unchanged.",
        );
      }
    } finally {
      if (live.current && sequence.current === ticket) {
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
      {reviewRequired && (
        <section aria-label="Latest understanding to review">
          <p className="eyebrow">
            Latest understanding · revision {baseline.revision}
          </p>
          <p>{baseline.interpretation.summary}</p>
          <ul>
            {baseline.claims
              ?.filter((c) => c.claim_id !== claim?.claim_id)
              .map((c) => (
                <li key={c.claim_id}>
                  {c.text} · {c.epistemic_state}
                </li>
              ))}
          </ul>
          <p>
            Your draft is preserved below. Review the latest content before
            replacing {claim ? "this statement" : "the summary"}.
          </p>
          <label>
            <input
              type="checkbox"
              disabled={busy || loading}
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I have reviewed the latest understanding
          </label>
        </section>
      )}
      {!targetAvailable && (
        <p role="alert">
          The statement was removed or retracted. Your draft is preserved, but
          this target cannot be corrected. Cancel and choose an available
          statement.
        </p>
      )}
      {conflict && (
        <button
          className="button link"
          disabled={loading || busy}
          onClick={() => void reload()}
        >
          {loading ? "Reloading understanding…" : "Reload latest understanding"}
        </button>
      )}
      {!preview ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              busy ||
              loading ||
              conflict ||
              !targetAvailable ||
              (reviewRequired && !reviewed)
            )
              return;
            operation.current = crypto.randomUUID();
            setPreview(true);
          }}
        >
          <label htmlFor="correction-text">
            What should Recall understand?
          </label>
          <textarea
            ref={textInput}
            id="correction-text"
            autoFocus
            value={text}
            maxLength={10000}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="button primary"
            disabled={
              busy ||
              loading ||
              conflict ||
              !targetAvailable ||
              (reviewRequired && !reviewed) ||
              !text.trim() ||
              text.trim() === original
            }
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
            {baseline.revision} of this memory. Recall’s derived understanding
            and search may change.
          </p>
          <p>
            Original evidence stays unchanged. Previous understanding remains in
            history.
          </p>
          <button
            className="button primary"
            disabled={
              busy ||
              loading ||
              conflict ||
              !targetAvailable ||
              (reviewRequired && !reviewed)
            }
            ref={confirm}
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
