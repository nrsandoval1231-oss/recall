import { useEffect, useState } from "react";
import { ApiError, type Action, type RecallApiClient } from "@recall/api-client";
import type { CacheScope, CachedRecord, NativeCache } from "../platform/native-cache";

type ReviewApi = Pick<RecallApiClient, "listActions" | "updateAction">;

export function Review({ api, onClose, cache, scope }: { api: ReviewApi; onClose: () => void; cache?: NativeCache; scope?: CacheScope | null }) {
  const [actions, setActions] = useState<Action[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    try { const result = await api.listActions({ limit: 50 }); setActions(result.items); setError(null); }
    catch (failure) {
      if (failure instanceof ApiError) { if (failure.status === 401 || failure.status === 403) setActions([]); setError(failure.status === 401 || failure.status === 403 ? "Your session no longer has access to Review." : "Couldn't load Review right now."); return; }
      if (!cache?.available || !scope) { setError("Couldn't load Review right now."); return; }
      try { const records = await cache.listRecords(scope, "action", 50); setActions(records.map(cachedAction).filter((action): action is Action => action !== null)); setError("Offline. Showing saved actions."); }
      catch { setError("Couldn't load Review right now."); }
    }
  };
  useEffect(() => { void refresh(); }, []);
  const update = async (action: Action, status: "open" | "done") => {
    const key = crypto.randomUUID(); const payload = { status } as const;
    let queued = false;
    try {
      if (cache?.available && scope) { await cache.enqueue(scope, { operation_id: key, kind: "action.update", target_id: action.action_id, expected_version: action.version, payload, created_at: new Date().toISOString() }); queued = true; }
      await api.updateAction(action.action_id, payload, key, action.version); await refresh();
    } catch (failure) {
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) setError("Your session no longer has access to this action.");
      else if (failure instanceof ApiError && failure.status === 409) setError("This action changed elsewhere. It remains in Review until you refresh.");
      else if (queued) setError("Saved locally. This action will sync when you reconnect.");
      else setError("Offline action storage is unavailable. Reconnect before updating this action.");
    }
  };
  const suggested = actions.filter((action) => action.status === "suggested");
  const active = actions.filter((action) => action.status === "open" || action.status === "accepted");
  const completed = actions.filter((action) => action.status === "done");
  const actionList = (list: Action[], mode: "suggested" | "active" | "done") => list.length === 0 ? <p className="empty">Nothing here.</p> : <ul className="list">{list.map((action) => <li key={action.action_id} className="review-card"><strong>{action.text}</strong>{action.due_text && <span className="muted"> · {action.due_text}</span>}<p className="muted">{mode === "suggested" ? "Suggestion only until you accept it." : `Status: ${action.status}`}</p>{mode === "suggested" && <button className="primary" onClick={() => void update(action, "open")}>Accept action</button>}{mode === "active" && <button className="primary" onClick={() => void update(action, "done")}>Mark done</button>}{mode === "done" && <button onClick={() => void update(action, "open")}>Reopen</button>}</li>)}</ul>;
  return <main className="review"><header><button onClick={onClose}>‹ Back</button><h1>Review</h1><button onClick={() => void refresh()}>Refresh</button></header><p className="muted">Review suggested actions when you are ready. Nothing is scheduled or sent automatically.</p>{error && <p role="alert" className="error">{error}</p>}<h2>Suggested actions</h2>{actionList(suggested, "suggested")}<h2>Accepted and open</h2>{actionList(active, "active")}<h2>Completed</h2>{actionList(completed, "done")}</main>;
}

function cachedAction(record: CachedRecord): Action | null {
  if (!record.payload || typeof record.payload !== "object") return null;
  const value = record.payload as Partial<Action>;
  return typeof value.action_id === "string" && typeof value.memory_id === "string" && typeof value.text === "string" && typeof value.status === "string" && typeof value.version === "number" ? value as Action : null;
}
