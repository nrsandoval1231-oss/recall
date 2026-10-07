import { useState } from "react";
import { copy } from "@recall/design-tokens";
import { ApiError, type AskResponse, type Citation, type RecallApiClient } from "@recall/api-client";
import type { CacheScope, CachedRecord, NativeCache } from "../platform/native-cache";

/** Ask what you remember. Each status renders differently: they are not interchangeable successes. */
export function Ask({ api, onOpenCitation, cache, scope }: { api: Pick<RecallApiClient, "ask">; onOpenCitation: (c: Citation) => void; cache?: NativeCache; scope?: CacheScope | null }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState<CachedRecord[]>([]);
  const [asOf, setAsOf] = useState("");

  const submit = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setCached([]);
    try {
      setResult(await api.ask(question.trim(), asOf ? { as_of: new Date(`${asOf}T23:59:59Z`).toISOString() } : {}));
    } catch (failure) {
      const denied = failure instanceof ApiError && (failure.status === 401 || failure.status === 403);
      if (!denied && cache?.available && scope) {
        try { setCached(await cache.search(scope, question.trim(), 20)); setError("Offline: showing cached keyword matches. Fresh answers are unavailable."); }
        catch { setError("Couldn't reach Recall to answer. Your captures are unaffected."); }
      } else setError(denied ? "Your session no longer has access to Ask." : "Couldn't reach Recall to answer. Your captures are unaffected.");
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
        <label className="muted">As of <input aria-label="As of date" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <button type="submit" className="primary" disabled={busy || !question.trim()}>{busy ? "Looking…" : copy.ask}</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {cached.length > 0 && <ul className="sources" aria-label="Cached keyword matches">{cached.map((item) => <li key={`${item.kind}-${item.record_id}`} className="row"><span>Cached {item.kind}</span><span className="muted">{cachedExcerpt(item.payload)}</span></li>)}</ul>}
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

function cachedExcerpt(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    for (const key of ["summary", "context_hint", "quote", "text", "name"]) if (typeof value[key] === "string" && value[key]) return value[key] as string;
  }
  return "Cached record available on this device.";
}
