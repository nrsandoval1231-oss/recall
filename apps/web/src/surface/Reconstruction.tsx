import type { AskResponse, Citation } from "@recall/api-client";
import { GlassBoard, ArrowIcon, displayDate } from "./primitives";
import { AskForm } from "./AskSurface";
const statusLabel = {
  answered: "Reconstructed from your memory",
  ambiguous: "More than one possibility",
  insufficient_evidence: "Not enough evidence yet",
  unavailable: "Understanding is unavailable",
};
interface Props {
  view: { response: AskResponse; asOf: string; invalidated?: boolean };
  question: string;
  setQuestion: (question: string) => void;
  busy: boolean;
  asOf: string;
  setAsOf: (date: string) => void;
  ask: (question?: string, date?: string) => void;
  inspect: (
    id: string,
    page: number | null,
    title: string,
    quote: string,
  ) => void;
  focusMemory: (id: string, citation?: Citation) => void;
  supportCount: number;
  setSupportCount: (update: (n: number) => number) => void;
}
export function Reconstruction({
  view,
  question,
  setQuestion,
  busy,
  asOf,
  setAsOf,
  ask,
  inspect,
  focusMemory,
  supportCount,
  setSupportCount,
}: Props) {
  const historical = Boolean(
    view.asOf ||
    (view.response.temporal_mode && view.response.temporal_mode !== "current"),
  );
  return (
    <div className="reconstruction">
      <GlassBoard
        label="Reconstructed understanding"
        className="primary-board answer-board"
      >
        <p className="eyebrow">
          {historical ? "Historical understanding" : "Recall understands"}
        </p>
        <h1>{view.response.question}</h1>
        <p className="status-heading" data-status={view.response.status}>
          {statusLabel[view.response.status]}
        </p>
        {view.invalidated ? (
          <p role="status">
            Understanding changed. Ask again to reconstruct from the corrected
            memory.
          </p>
        ) : (
          <>
            <div className="answer-prose">
              {(view.response.status === "answered" ||
                view.response.status === "ambiguous") &&
                view.response.sentences.map((sentence, index) => (
                  <p key={index}>
                    {sentence.text}{" "}
                    {sentence.citation_ids.map((id) => {
                      const citation = view.response.citations.find(
                        (c) => c.citation_id === id,
                      );
                      return citation ? (
                        <button
                          className="inline-cite"
                          key={id}
                          data-focus-key={`cite-${index}-${id}`}
                          aria-label={`Inspect source for: ${sentence.text}`}
                          disabled={!citation.source_id}
                          onClick={() =>
                            inspect(
                              citation.source_id!,
                              citation.page,
                              view.response.question,
                              citation.quote,
                            )
                          }
                        >
                          <ArrowIcon />{" "}
                          {citation.page ? `p.${citation.page}` : "source"}
                        </button>
                      ) : null;
                    })}
                  </p>
                ))}
            </div>
            {view.response.limitations.map((limit, i) => (
              <p className="uncertainty" key={i}>
                {limit}
              </p>
            ))}
          </>
        )}
        <div className="time-control">
          <span className="time-dot" />
          <span>{historical ? "Then" : "Now"}</span>
          <label htmlFor="as-of">What I knew by</label>
          <input
            id="as-of"
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
          <button
            className="button link"
            disabled={busy || !asOf}
            onClick={() => ask(view.response.question, asOf)}
          >
            Recall then
          </button>
          {view.asOf && (
            <button
              className="button link"
              disabled={busy}
              onClick={() => ask(view.response.question)}
            >
              Return to now
            </button>
          )}
        </div>
        <AskForm
          question={question}
          setQuestion={setQuestion}
          onAsk={() => ask()}
          busy={busy}
          compact
        />
      </GlassBoard>
      {!view.invalidated && (
        <GlassBoard
          label="Supporting memories"
          className="context-board support-board"
        >
          <p className="eyebrow">The memories beneath this</p>
          <h2>Grounded in evidence.</h2>
          <div className="support-list">
            {uniqueCitations(view.response)
              .slice(0, supportCount)
              .map((c) => (
                <button
                  className="support-memory"
                  data-focus-key={`memory-${c.citation_id}`}
                  key={c.citation_id}
                  aria-label={`Focus memory · ${c.quote}`}
                  onClick={() => focusMemory(c.memory_id, c)}
                >
                  <span className="source-marker" aria-hidden="true">
                    {c.page ?? "—"}
                  </span>
                  <span>
                    <span className="quote">{c.quote}</span>
                    <small>
                      {displayDate(c.captured_at)} ·{" "}
                      {c.epistemic_state === "uncertain" ||
                      c.epistemic_state === "question"
                        ? "Uncertain"
                        : c.epistemic_state === "superseded"
                          ? "Superseded"
                          : "Source-backed"}
                    </small>
                  </span>
                  <span aria-hidden="true">
                    <ArrowIcon />
                  </span>
                </button>
              ))}
          </div>
          {uniqueCitations(view.response).length === 0 && (
            <p>
              No eligible supporting memory was returned. Try a different
              recollection or capture its source.
            </p>
          )}
          {uniqueCitations(view.response).length > supportCount && (
            <button
              className="button link"
              onClick={() => setSupportCount((n) => n + 3)}
            >
              Explore more supporting memories
            </button>
          )}
        </GlassBoard>
      )}
    </div>
  );
}
function uniqueCitations(response: AskResponse): Citation[] {
  const seen = new Set<string>();
  return [...response.citations, ...response.sources].filter((c) => {
    const key = `${c.memory_id}:${c.source_id}:${c.memory_revision}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
