import { useState } from "react";
import { copy } from "@recall/design-tokens";
import type { AskResponse, Citation, RecallApiClient } from "@recall/api-client";

/** Ask what you remember. Each status renders differently: they are not interchangeable successes. */
export function Ask({ api, onOpenCitation }: { api: Pick<RecallApiClient, "ask">; onOpenCitation: (c: Citation) => void }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.ask(question.trim()));
    } catch {
      setError("Couldn't reach Recall to answer. Your captures are unaffected.");
    } finally {
      setBusy(false);
    }
  };

  const byId = new Map((result?.citations ?? []).map((c) => [c.citation_id, c]));
  const lead = result && { insufficient_evidence: copy.insufficient, ambiguous: copy.ambiguous, unavailable: copy.unavailable, answered: null }[result.status];

  return (
    <section className="ask" aria-label="Ask">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="ask-form">
        <input aria-label={copy.askPlaceholder} placeholder={copy.askPlaceholder} value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} />
        <button type="submit" className="primary" disabled={busy || !question.trim()}>{busy ? "Looking…" : copy.ask}</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {result && (
        <div className="answer" aria-live="polite" data-status={result.status}>
          {lead && <p className="note">{lead}</p>}
          {result.status === "answered" || result.status === "ambiguous" ? (
            <p>
              {result.sentences.map((s, i) => (
                <span key={i}>
                  {s.text}{" "}
                  {s.citation_ids.map((cid) => {
                    const c = byId.get(cid);
                    return c ? (
                      <button key={cid} className="cite" onClick={() => onOpenCitation(c)} aria-label={`Open source for: ${s.text}`}>
                        p.{c.page ?? "–"}
                      </button>
                    ) : null;
                  })}{" "}
                </span>
              ))}
            </p>
          ) : null}
          {result.limitations.map((l, i) => <p key={i} className="muted">{l}</p>)}
          {result.status !== "answered" && result.sources.length > 0 && (
            <ul className="sources" aria-label="Matching sources">
              {result.sources.map((s) => (
                <li key={s.citation_id}>
                  <button className="row" onClick={() => onOpenCitation(s)}>
                    <span>“{s.quote}”</span>
                    <span className="muted">{new Date(s.captured_at).toLocaleDateString()}{s.page ? ` · page ${s.page}` : ""}{s.epistemic_state && s.epistemic_state !== "reported" ? ` · ${s.epistemic_state}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
