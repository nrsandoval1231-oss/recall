import { useMemo, useState } from "react";
import type { KnowledgeRelationship, KnowledgeServiceStatus, VaultMemory } from "../platform/local-vault";

type Props = {
  relationships: KnowledgeRelationship[];
  status?: KnowledgeServiceStatus | null;
  memories: VaultMemory[];
  onInspect: (memory: VaultMemory) => void;
  onCorrect: (memory: VaultMemory) => void;
  onDismiss?: (id: string) => void | Promise<void>;
  temporalOnly?: boolean;
};

function predicateLabel(value: string): string {
  const readable = value.replace(/_/g, " ").toLowerCase();
  return readable ? `${readable[0]?.toUpperCase()}${readable.slice(1)}` : value;
}

/** A bounded relationship view with an accessible, source-first list alternative. */
export function KnowledgePanel({ relationships, status, memories, onInspect, onCorrect, onDismiss, temporalOnly = false }: Props) {
  const [type, setType] = useState("all");
  const [entityType, setEntityType] = useState("all");
  const [temporal, setTemporal] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [focusedEntityId, setFocusedEntityId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const predicates = useMemo(() => [...new Set(relationships.map(row => row.predicate))].sort(), [relationships]);
  const entityTypes = useMemo(() => [...new Set(relationships.flatMap(row => [row.subject_type, row.object_type]))].sort(), [relationships]);
  const filtered = relationships.filter(row => !dismissed.has(row.id)
    && (!temporalOnly || row.valid_at || row.invalid_at)
    && (type === "all" || row.predicate === type)
    && (entityType === "all" || row.subject_type === entityType || row.object_type === entityType)
    && (temporal === "all" || (temporal === "current" ? !row.invalid_at : Boolean(row.invalid_at))));
  const direct = focusedEntityId ? filtered.filter(row => row.subject_id === focusedEntityId || row.object_id === focusedEntityId) : filtered;
  const connected = useMemo(() => {
    if (!focusedEntityId) return filtered;
    const found = new Set<string>([focusedEntityId]);
    const edges = new Set<string>();
    let changed = true;
    while (changed && edges.size < 50) {
      changed = false;
      for (const row of filtered) {
        if (edges.has(row.id) || (!found.has(row.subject_id) && !found.has(row.object_id))) continue;
        edges.add(row.id); found.add(row.subject_id); found.add(row.object_id); changed = true;
      }
    }
    return filtered.filter(row => edges.has(row.id)).slice(0, 50);
  }, [filtered, focusedEntityId]);
  const visible = focusedEntityId ? expanded ? connected : direct : filtered.slice(0, expanded ? 50 : 12);
  const boundedVisible = visible.slice(0, 50);
  const selected = boundedVisible.find(row => row.id === selectedId) ?? boundedVisible[0];
  const nodeIds = new Set<string>();
  for (const edge of boundedVisible) { nodeIds.add(edge.subject_id); nodeIds.add(edge.object_id); }
  const hiddenCount = focusedEntityId ? Math.max(0, connected.length - direct.length) : Math.max(0, filtered.length - boundedVisible.length);

  async function dismiss(id: string) {
    if (!onDismiss) return;
    try {
      await onDismiss(id);
      setDismissed(current => new Set(current).add(id));
    } catch {
      // The owner callback presents the persistence error; keep the fact visible.
    }
  }

  return <section className="ms-knowledge" aria-label={temporalOnly ? "Knowledge timeline" : "Connected knowledge"}>
    <header><div><p className="ms-kicker">CONNECTED KNOWLEDGE</p><h2>{temporalOnly ? "Inferred relationships over time" : "Relationships from your notes"}</h2></div>
      {status && <small role="status">{status.state} · {status.indexed} indexed{status.pending ? ` · ${status.pending} pending` : ""}</small>}
    </header>
    <p className="ms-fine">Every connection is an inference. Open its supporting note before relying on it.</p>
    <div className="ms-knowledge-filters">
      <label>Relationship type <select aria-label="Relationship type" value={type} onChange={event => setType(event.target.value)}><option value="all">All types</option>{predicates.map(value => <option key={value} value={value}>{predicateLabel(value)}</option>)}</select></label>
      <label>Entity type <select aria-label="Entity type" value={entityType} onChange={event => setEntityType(event.target.value)}><option value="all">All entity types</option>{entityTypes.map(value => <option key={value} value={value}>{predicateLabel(value)}</option>)}</select></label>
      <label>Time <select aria-label="Relationship time" value={temporal} onChange={event => setTemporal(event.target.value)}><option value="all">Current and superseded</option><option value="current">Current</option><option value="superseded">Superseded</option></select></label>
    </div>
    {focusedEntityId && <p className="ms-fine">Focused on {boundedVisible.find(row => row.subject_id === focusedEntityId)?.subject ?? boundedVisible.find(row => row.object_id === focusedEntityId)?.object ?? "selected entity"}. <button type="button" onClick={() => { setFocusedEntityId(null); setExpanded(false); }}>Show all connections</button></p>}
    {boundedVisible.length ? <>
      <div className="ms-knowledge-map" role="group" aria-label="Relationship map">
        {boundedVisible.map(edge => <div className="ms-knowledge-path" key={edge.id}>
          <button type="button" aria-pressed={focusedEntityId === edge.subject_id} onClick={() => { setFocusedEntityId(edge.subject_id); setSelectedId(edge.id); setExpanded(false); }}>{edge.subject}<small>{predicateLabel(edge.subject_type)}</small></button>
          <span aria-label={predicateLabel(edge.predicate)}>{predicateLabel(edge.predicate)} <span aria-hidden="true">→</span></span>
          <button type="button" aria-pressed={focusedEntityId === edge.object_id} onClick={() => { setFocusedEntityId(edge.object_id); setSelectedId(edge.id); setExpanded(false); }}>{edge.object}<small>{predicateLabel(edge.object_type)}</small></button>
        </div>)}
        <span className="ms-knowledge-map-count">{nodeIds.size} concepts · {boundedVisible.length} connections</span>
      </div>
      <ul className="ms-knowledge-list" aria-label="Relationship list">
        {boundedVisible.map(edge => <li key={edge.id}><button type="button" aria-pressed={selected?.id === edge.id} onClick={() => setSelectedId(edge.id)}><strong>{edge.subject}</strong> <span>{predicateLabel(edge.predicate)}</span> <strong>{edge.object}</strong><small>{edge.invalid_at ? `Superseded ${edge.invalid_at}` : edge.valid_at ? `Inferred date: ${edge.valid_at}` : "Current understanding"} · Inferred</small></button></li>)}
      </ul>
      {hiddenCount > 0 && <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? "Collapse to immediate neighbors" : `Expand neighbors (${hiddenCount})`}</button>}
      {!focusedEntityId && filtered.length > 12 && <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer connections" : `Expand connections (${filtered.length})`}</button>}
      {selected && <article className="ms-knowledge-evidence" aria-label="Selected relationship evidence">
        <h3>{selected.fact}</h3><p>{selected.uncertainty || "Inferred from note evidence; not independently verified."}</p>
        {selected.supports.length ? selected.supports.map((support, index) => {
          const memory = memories.find(row => row.id === support.source_id);
          const sourceLabel = memory?.source_name.trim() || memory?.note_path?.split(/[\\/]/).filter(Boolean).at(-1) || "Captured note";
          return <div className="ms-knowledge-support" key={`${support.source_id}:${support.revision}:${index}`}>
            <p><strong>Supporting quote {index + 1}</strong>{memory ? ` · ${sourceLabel} · revision ${support.revision}` : ` · source ${support.source_id} · revision ${support.revision}`}</p>
            <blockquote>{support.quote}</blockquote>
            {memory && <div className="ms-knowledge-source"><span>{sourceLabel}</span><div><button type="button" onClick={() => onInspect(memory)}>Inspect original</button><button type="button" onClick={() => onCorrect(memory)}>Correct note</button></div></div>}
          </div>;
        }) : <><p><strong>Supporting quote</strong></p><blockquote>{selected.quote}</blockquote></>}
        {onDismiss && <button type="button" onClick={() => void dismiss(selected.id)}>Dismiss this inferred relationship</button>}
      </article>}
    </> : <p className="ms-fine">{status?.state === "disabled" || status?.state === "unavailable" ? status.message : "No source-backed relationships are available for this view yet."}</p>}
  </section>;
}
