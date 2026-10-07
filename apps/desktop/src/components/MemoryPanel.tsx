import { useEffect, useState } from "react";
import { ApiError, type EpistemicState, type MemoryDetail, type RecallApiClient } from "@recall/api-client";
import { epistemicLabel } from "../viewmodel";
import type { CacheScope, NativeCache } from "../platform/native-cache";

/** Interpretation beside the original. Always labelled as a machine reading; the original wins. */
export function MemoryPanel({ api, memoryId, pageId, cache, scope }: { api: Pick<RecallApiClient, "getMemory"> & Partial<Pick<RecallApiClient, "correctMemory" | "deleteMemory">>; memoryId: string; pageId: string | undefined; cache?: NativeCache; scope?: CacheScope | null }) {
  const [memory, setMemory] = useState<MemoryDetail | null>(null);
  const [error, setError] = useState(false);
  const [edit, setEdit] = useState<{ target: "summary" | "transcription" | "claim"; claimId?: string; pageId?: string; text?: string; epistemic_state?: EpistemicState; valid_from?: string | null; valid_to?: string | null } | null>(null);
  const [editNote, setEditNote] = useState<string | null>(null);
  const [deleteNote, setDeleteNote] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  useEffect(() => {
    let live = true;
    api.getMemory(memoryId).then((m) => live && setMemory(m), async (failure) => {
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) { if (live) { setMemory(null); setError(true); } return; }
      if (cache?.available && scope) {
        try { const record = await cache.getRecord(scope, "memory", memoryId); const cached = record && cachedMemory(record.payload); if (cached && live) { setMemory(cached); setEditNote("Offline. Showing the last cached reading."); return; } } catch { /* report below */ }
      }
      if (live) setError(true);
    });
    return () => { live = false; };
  }, [api, memoryId]);

  if (deleted) return <p className="note" role="status">Interpretation deleted. The original remains available.</p>;
  if (error) return <p className="note">The reading of this capture couldn't be loaded. The original is unaffected.</p>;
  if (!memory) return <p className="note" role="status">Loading reading…</p>;
  const ex = memory.interpretation;
  const page = ex.pages.find((p) => p.page_id === pageId);
  const onPage = (ev: { page_id: string }[]) => ev.some((e) => e.page_id === pageId);
  const saveCorrection = async () => {
    if (!edit) return;
    const correction = { target: edit.target, claim_id: edit.claimId, page_id: edit.pageId, text: edit.text, epistemic_state: edit.epistemic_state, valid_from: edit.valid_from, valid_to: edit.valid_to };
    const key = crypto.randomUUID();
    let queued = false;
    try {
      if (cache?.available && scope) { await cache.enqueue(scope, { operation_id: key, kind: "memory.correction", target_id: memoryId, expected_version: memory.revision, payload: correction, created_at: new Date().toISOString() }); queued = true; }
      if (!api.correctMemory) throw new Error("CORRECTION_UNAVAILABLE");
      const corrected = await api.correctMemory(memoryId, correction, key, memory.revision);
      setMemory(corrected);
      setEditNote("Correction saved. Recall will keep the original and this revision."); setEdit(null);
    }
    catch (failure) {
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) { setMemory(null); setError(true); }
      else if (failure instanceof ApiError && failure.status === 409) setEditNote("This memory changed elsewhere. Reload it before correcting again.");
      else setEditNote(queued ? "Saved locally. This correction will sync when you reconnect." : "Offline correction storage is unavailable in this browser. Reconnect before saving.");
    }
  };
  const removeMemory = async () => {
    if (!api.deleteMemory || !window.confirm("Delete this interpretation while keeping the original pages?")) return;
    try { await api.deleteMemory(memoryId, crypto.randomUUID(), memory.revision); setDeleted(true); setMemory(null); }
    catch { setDeleteNote("This interpretation changed elsewhere or could not be deleted."); }
  };
  const resolveMention = async (mentionId: string, entityId: string | null, resolution: "accepted" | "rejected") => {
    if (!api.correctMemory) return;
    const key = crypto.randomUUID();
    const correction = { target: "mention_identity" as const, mention_id: mentionId, entity_id: entityId ?? undefined, resolution };
    let queued = false;
    try {
      if (cache?.available && scope) { await cache.enqueue(scope, { operation_id: key, kind: "memory.correction", target_id: memoryId, expected_version: memory.revision, payload: correction, created_at: new Date().toISOString() }); queued = true; }
      const corrected = await api.correctMemory(memoryId, correction, key, memory.revision);
      setMemory(corrected); setEditNote(`Identity ${resolution}.`);
    } catch (failure) {
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) { setMemory(null); setError(true); }
      else setEditNote(queued ? "Identity review saved for retry; the server may have changed this reading." : "Couldn't update this identity review. It has not been saved.");
    }
  };
  return (
    <section className="memory" aria-label="Reading">
      {ex.summary && <p><strong>Summary:</strong> {ex.summary} {api.correctMemory && <button onClick={() => setEdit({ target: "summary", text: ex.summary ?? "" })}>Correct summary</button>}</p>}
      <h4>Machine reading of this page</h4>
      <p className="muted">{memory.labels.transcription}</p>
      {page ? (
            <><pre className="transcription" data-testid="transcription">{page.transcription || "(nothing readable)"}{page.legibility !== "clear" ? `\n\n[${page.legibility}]` : ""}</pre>{api.correctMemory && <button onClick={() => setEdit({ target: "transcription", pageId: page.page_id, text: page.transcription })}>Correct transcription</button>}</>
      ) : <p className="note">No reading for this page.</p>}
      {ex.statements.filter((s) => onPage(s.evidence)).length > 0 && (
        <>
          <h4>Claims on this page</h4>
          <ul>
            {ex.statements.filter((s) => onPage(s.evidence)).map((s) => (
              <li key={s.local_id}>{s.text} <span className="pill warning">{epistemicLabel[s.epistemic_state] || "reported"}</span></li>
            ))}
          </ul>
        </>
      )}
      {memory.claims?.length ? <><h4>Claims and history</h4><ul>{memory.claims.map((claim) => <li key={claim.claim_id}>{claim.text} <span className="pill warning">{epistemicLabel[claim.epistemic_state] || "reported"}</span>{claim.temporal_text && <span className="muted"> · {claim.temporal_text}</span>}{api.correctMemory && <button onClick={() => setEdit({ target: "claim", claimId: claim.claim_id, text: claim.text, epistemic_state: claim.epistemic_state, valid_from: claim.valid_from ?? null, valid_to: claim.valid_to ?? null })}>Correct</button>}</li>)}</ul></> : null}
      {memory.mentions?.length ? <><h4>Identity review</h4><ul>{memory.mentions.map((mention) => <li key={mention.mention_id}>{mention.text} <span className="pill warning">{mention.resolution}</span>{api.correctMemory && <><button onClick={() => void resolveMention(mention.mention_id, mention.entity_id, "accepted")}>Accept identity</button><button onClick={() => void resolveMention(mention.mention_id, mention.entity_id, "rejected")}>Reject identity</button></>}</li>)}</ul></> : null}
      {memory.entities?.length ? <><h4>People and things</h4><ul>{memory.entities.map((entity) => <li key={entity.entity_id}>{entity.canonical_name} <span className="muted">{entity.kind}</span></li>)}</ul></> : null}
      {memory.history?.length ? <details><summary>Revision history ({memory.history.length})</summary><ul>{memory.history.map((h) => <li key={h.revision}>Revision {h.revision} · {h.origin} · {h.reason ?? "No reason recorded"}</li>)}</ul></details> : null}
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
      {edit && <div className="correction" role="dialog" aria-label="Correct memory"><h4>Correct this reading</h4><textarea value={edit.text ?? ""} onChange={(e) => setEdit({ ...edit, text: e.target.value })} rows={3} />{edit.target === "claim" && <><label>Status <select value={edit.epistemic_state ?? "reported"} onChange={(e) => setEdit({ ...edit, epistemic_state: e.target.value as EpistemicState })}>{["reported", "uncertain", "question", "confirmed_by_user", "superseded", "retracted"].map((state) => <option key={state} value={state}>{state}</option>)}</select></label><label>Valid from <input value={edit.valid_from ?? ""} onChange={(e) => setEdit({ ...edit, valid_from: e.target.value || null })} placeholder="RFC 3339 timestamp" /></label><label>Valid to <input value={edit.valid_to ?? ""} onChange={(e) => setEdit({ ...edit, valid_to: e.target.value || null })} placeholder="RFC 3339 timestamp" /></label></>}<div><button className="primary" onClick={() => void saveCorrection()}>Save correction</button><button onClick={() => setEdit(null)}>Cancel</button></div></div>}
      {editNote && <p className="note" role="status">{editNote}</p>}
      {api.deleteMemory && <><button onClick={() => void removeMemory()}>Delete interpretation</button>{deleteNote && <p className="note" role="status">{deleteNote}</p>}</>}
    </section>
  );
}

function cachedMemory(payload: unknown): MemoryDetail | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Partial<MemoryDetail>;
  return value.interpretation && typeof value.revision === "number" && value.labels && Array.isArray(value.validation_notes)
    ? value as MemoryDetail : null;
}
