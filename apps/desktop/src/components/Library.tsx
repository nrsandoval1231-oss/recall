import { useEffect, useState } from "react";
import { ApiError, type EntityDetail, type EntityKind, type EntitySummary, type IdentityPreview, type RecallApiClient } from "@recall/api-client";
import type { CacheScope, NativeCache } from "../platform/native-cache";

type LibraryApi = Pick<RecallApiClient, "listEntities" | "getEntity"> & Partial<Pick<RecallApiClient, "identityPreview" | "applyIdentity">>;

export function Library({ api, cache, scope, onClose, onOpenMemory }: { api: LibraryApi; cache?: NativeCache; scope?: CacheScope | null; onClose: () => void; onOpenMemory?: (memoryId: string) => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<EntityKind | "">("");
  const [items, setItems] = useState<EntitySummary[] | null>(null);
  const [selected, setSelected] = useState<EntityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<{ target: EntitySummary; preview: IdentityPreview } | null>(null);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void api.listEntities({ q: query.trim() || undefined, kind: kind || undefined, limit: 50 }).then((r) => active && setItems(r.items), async (failure) => {
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) { if (active) { setItems([]); setSelected(null); setIdentity(null); setMentionIds([]); setError("Your session no longer has access to this Library."); } return; }
      if (!cache?.available || !scope) { if (active) setError("Couldn't load the Library right now."); return; }
      try {
        const records = await cache.listRecords(scope, "entity", 50);
        const needle = query.trim().toLowerCase();
        const found = records.map(cachedEntity).filter((e): e is EntitySummary => Boolean(e && (!needle || `${e.name} ${e.kind} ${(e.aliases ?? []).join(" ")}`.toLowerCase().includes(needle)) && (!kind || e.kind === kind)));
        if (active) { setItems(found); setError("Offline. Showing cached entities."); }
      } catch { if (active) setError("Couldn't load the Library right now."); }
    });
    return () => { active = false; };
  }, [api, query, kind]);
  const open = async (entity: EntitySummary) => {
    try { setSelected(await api.getEntity(entity.entity_id)); setMentionIds([]); setIdentity(null); setError(null); } catch (failure) {
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) { setSelected(null); setIdentity(null); setMentionIds([]); setError("Your session no longer has access to this entity."); return; }
      if (cache?.available && scope) {
        try { const record = await cache.getRecord(scope, "entity", entity.entity_id); const detail = record && cachedDetail(record.payload); if (detail) { setSelected(detail); setError("Offline. Showing cached entity details."); return; } } catch { /* report below */ }
      }
      setError("Couldn't open that entity right now.");
    }
  };
  const previewIdentity = async (target: EntitySummary) => {
    if (!selected || !api.identityPreview) return;
    try { setIdentity({ target, preview: await api.identityPreview(selected.entity_id, target.entity_id) }); } catch { setError("Couldn't prepare that identity review."); }
  };
  const acceptIdentity = async () => {
    if (!identity || !selected || !api.applyIdentity) return;
    try { await api.applyIdentity(selected.entity_id, identity.target.entity_id, { source_version: selected.version, target_version: identity.target.version, mention_ids: mentionIds }, crypto.randomUUID()); setError(mentionIds.length ? "Selected mentions moved. Refresh Library to review the remaining identity." : "Identity merge applied. Refresh Library to see the updated records."); setIdentity(null); setMentionIds([]); } catch { setError("That identity changed elsewhere. Refresh before applying it."); }
  };
  return <main className="library">
    <header><button onClick={onClose}>‹ Back</button><h1>Library</h1></header>
    <p className="muted">Explore people, places, projects, and other connected memories.</p>
    <div className="library-filters">
      <label>Search <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names and memories" /></label>
      <label>Kind <select value={kind} onChange={(e) => setKind(e.target.value as EntityKind | "")}><option value="">All</option>{["person", "organization", "place", "thing", "event", "project", "topic"].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {items === null && !error && <p role="status">Loading Library…</p>}
    {items?.length === 0 && <p className="empty">Nothing connected yet. Memories appear here as Recall recognizes them.</p>}
    <ul className="list">{items?.map((entity) => <li key={entity.entity_id}><button className="row" onClick={() => void open(entity)}><span className="title">{entity.name}</span><span className="muted">{entity.kind} · {entity.aliases?.length ? entity.aliases.join(", ") : "No aliases"}</span></button></li>)}</ul>
    {selected?.mentions?.length ? <section aria-label="Identity mentions"><h3>Identity mentions</h3><p className="muted">Select mentions to preview a split. Unselected mentions stay with this identity.</p><ul>{selected.mentions.map((mention) => <li key={mention.mention_id}><label><input type="checkbox" disabled={mention.status !== "accepted"} checked={mentionIds.includes(mention.mention_id)} onChange={(e) => setMentionIds((ids) => e.target.checked ? [...ids, mention.mention_id] : ids.filter((id) => id !== mention.mention_id))} /> {mention.raw_text} <span className="muted">{mention.status ?? "unresolved"}</span></label></li>)}</ul></section> : null}
    {selected && <section className="entity-detail" aria-label="Entity details"><h2>{selected.name}</h2><p className="muted">{selected.kind} · {selected.mention_count ?? 0} mentions</p>{selected.relationships?.length ? <><h3>Relationships</h3><ul>{selected.relationships.map((r) => <li key={r.relationship_id}>{r.from_name ?? "This identity"} {r.type.replaceAll("_", " ")} {r.to_name ?? "a connected identity"} <span className="pill warning">{r.status}</span></li>)}</ul></> : null}{selected.memories?.length ? <><h3>Source memories</h3><ul>{selected.memories.map((m) => <li key={m.memory_id}><button className="row" onClick={() => onOpenMemory?.(m.memory_id)}><span>{m.summary ?? m.context_hint ?? "Untitled memory"}</span><span className="muted">{new Date(m.captured_at).toLocaleDateString()}</span></button></li>)}</ul></> : <p className="muted">No linked memories to show.</p>}{selected.timeline?.length ? <><h3>What Recall has recorded</h3><ol className="list">{selected.timeline.slice(0, 10).map((item, index) => <li key={`${item.claim_id}-${index}`}><button className="row" onClick={() => onOpenMemory?.(item.memory_id)}><span>{item.text}</span><span className="muted">{new Date(item.recorded_at).toLocaleDateString()} · {item.epistemic_state.replaceAll("_", " ")} · {item.origin === "user" ? "Your correction" : "Machine reading"}</span></button></li>)}</ol></> : null}{api.identityPreview && api.applyIdentity && <><h3>Identity review</h3><p className="muted">Preview a merge before moving accepted mentions. Split review becomes available when you select specific mentions.</p>{(items ?? []).filter((e) => e.entity_id !== selected.entity_id && e.kind === selected.kind).slice(0, 3).map((e) => <button key={e.entity_id} onClick={() => void previewIdentity(e)}>Preview with {e.name}</button>)}{identity && <div className="correction" role="dialog" aria-label="Identity merge preview"><p>{mentionIds.length ? `Split ${mentionIds.length} selected mention(s) from` : `Merge ${selected.name} into`} {identity.target.name}?</p><p className="muted">{mentionIds.length || identity.preview.accepted_mentions} accepted mention(s) would move. This can be retried safely.</p><button className="primary" onClick={() => void acceptIdentity()}>{mentionIds.length ? "Confirm split" : "Accept merge"}</button><button onClick={() => setIdentity(null)}>Cancel</button></div>}</>}</section>}
  </main>;
}

function cachedEntity(record: { payload: unknown }): EntitySummary | null {
  if (!record.payload || typeof record.payload !== "object") return null;
  const value = record.payload as Partial<EntitySummary>;
  if (typeof value.entity_id !== "string" || typeof value.name !== "string" || typeof value.kind !== "string") return null;
  return value as EntitySummary;
}

function cachedDetail(payload: unknown): EntityDetail | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Partial<EntityDetail>;
  return typeof value.entity_id === "string" && typeof value.name === "string" && typeof value.kind === "string" ? value as EntityDetail : null;
}

