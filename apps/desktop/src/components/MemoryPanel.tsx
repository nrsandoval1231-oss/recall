import { useEffect, useState } from "react";
import type { MemoryDetail, RecallApiClient } from "@recall/api-client";
import { epistemicLabel } from "../viewmodel";

/** Interpretation beside the original. Always labelled as a machine reading; the original wins. */
export function MemoryPanel({ api, memoryId, pageId }: { api: Pick<RecallApiClient, "getMemory">; memoryId: string; pageId: string | undefined }) {
  const [memory, setMemory] = useState<MemoryDetail | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    api.getMemory(memoryId).then((m) => live && setMemory(m), () => live && setError(true));
    return () => { live = false; };
  }, [api, memoryId]);

  if (error) return <p className="note">The reading of this capture couldn't be loaded. The original is unaffected.</p>;
  if (!memory) return <p className="note" role="status">Loading reading…</p>;
  const ex = memory.interpretation;
  const page = ex.pages.find((p) => p.page_id === pageId);
  const onPage = (ev: { page_id: string }[]) => ev.some((e) => e.page_id === pageId);
  return (
    <section className="memory" aria-label="Reading">
      {ex.summary && <p><strong>Summary:</strong> {ex.summary}</p>}
      <h4>Machine reading of this page</h4>
      <p className="muted">{memory.labels.transcription}</p>
      {page ? (
        <pre className="transcription" data-testid="transcription">{page.transcription || "(nothing readable)"}{page.legibility !== "clear" ? `\n\n[${page.legibility}]` : ""}</pre>
      ) : <p className="note">No reading for this page.</p>}
      {ex.statements.filter((s) => onPage(s.evidence) && s.epistemic_state !== "reported").length > 0 && (
        <>
          <h4>Unclear on this page</h4>
          <ul>
            {ex.statements.filter((s) => onPage(s.evidence) && s.epistemic_state !== "reported").map((s) => (
              <li key={s.local_id}>{s.text} <span className="pill warning">{epistemicLabel[s.epistemic_state]}</span></li>
            ))}
          </ul>
        </>
      )}
      {ex.action_suggestions.length > 0 && (
        <>
          <h4>Possible actions</h4>
          <p className="muted">{memory.labels.action_suggestions}</p>
          <ul>{ex.action_suggestions.map((a) => <li key={a.local_id}>{a.text}{a.due_text ? ` (${a.due_text})` : ""}</li>)}</ul>
        </>
      )}
      {memory.validation_notes.length > 0 && (
        <details>
          <summary>{memory.validation_notes.length} thing(s) Recall couldn't confirm against the page</summary>
          <ul>{memory.validation_notes.map((n, i) => <li key={i}>{n.detail}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
