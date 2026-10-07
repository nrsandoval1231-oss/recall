import { ArrowIcon } from "./primitives";
export function AskForm({
  question,
  setQuestion,
  onAsk,
  busy,
  compact = false,
}: {
  question: string;
  setQuestion: (q: string) => void;
  onAsk: () => void;
  busy: boolean;
  compact?: boolean;
}) {
  return (
    <form
      className={`surface-ask ${compact ? "compact" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        onAsk();
      }}
    >
      <label className="sr-only" htmlFor="surface-question">
        What do you need to remember?
      </label>
      <input
        id="surface-question"
        placeholder={
          compact ? "Follow another thread…" : "Ask in your own words…"
        }
        maxLength={1000}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <button
        aria-label="Ask Recall"
        type="submit"
        disabled={busy || !question.trim()}
      >
        <span>{busy ? "Recalling" : "Ask"}</span>
        <span aria-hidden="true">
          <ArrowIcon />
        </span>
      </button>
    </form>
  );
}
