import { useMemo, useRef, useState } from "react";
import type { VaultMemory } from "../platform/local-vault";
import { deriveGraph, type GraphKind } from "./adaptive-graph";
export function AdaptiveGraph({
  memories,
  explore,
  selected,
  highlights,
  onSelect,
}: {
  memories: VaultMemory[];
  explore: boolean;
  selected: string | null;
  highlights: string[];
  onSelect: (memory: VaultMemory) => void;
}) {
  const graph = useMemo(() => deriveGraph(memories), [memories]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [filter, setFilter] = useState<GraphKind | "all">("all");
  const [search, setSearch] = useState("");
  const [list, setList] = useState(false);
  const [includeUnresolved, setIncludeUnresolved] = useState(true);
  function point(svg: SVGSVGElement, x: number, y: number) {
    const matrix = svg.getScreenCTM();
    return matrix
      ? new DOMPoint(x, y).matrixTransform(matrix.inverse())
      : { x, y };
  }
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(
    null,
  );
  const filtered = graph.nodes.filter(
    (n) =>
      (filter === "all" || filter === n.kind) &&
      (includeUnresolved || !n.tentative) &&
      n.label.toLowerCase().includes(search.toLowerCase()),
  );
  const nodes = filtered.slice(0, 200);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = graph.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .slice(0, 400);
  const connected = new Set(
    edges
      .filter((e) => e.from === selected || e.to === selected)
      .flatMap((e) => [e.from, e.to]),
  );
  return (
    <div className={`adaptive-graph ${explore ? "is-exploring" : ""}`} role="region" aria-label="Memory graph environment">
      {explore && <h1 className="ms-sr">Graph View</h1>}
      <svg
        viewBox="0 0 1000 800"
        preserveAspectRatio="xMidYMid slice"
        role="group"
        aria-label="Vault memory graph"
        tabIndex={0}
        onPointerDown={(event) => {
          if (!explore || event.target !== event.currentTarget) return;
          const p = point(event.currentTarget, event.clientX, event.clientY);
          drag.current = { x: p.x, y: p.y, vx: viewport.x, vy: viewport.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current) {
            const p = point(event.currentTarget, event.clientX, event.clientY);
            setViewport((v) => ({
              ...v,
              x: drag.current!.vx + (p.x - drag.current!.x),
              y: drag.current!.vy + (p.y - drag.current!.y),
            }));
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onWheel={(event) => {
          if (explore)
            setViewport((v) => ({
              ...v,
              zoom: Math.min(2.5, Math.max(0.5, v.zoom - event.deltaY * 0.001)),
            }));
        }}
        onKeyDown={(event) => {
          const delta: { [key: string]: [number, number] } = {
            ArrowLeft: [30, 0],
            ArrowRight: [-30, 0],
            ArrowUp: [0, 30],
            ArrowDown: [0, -30],
          };
          const move = delta[event.key];
          if (move) {
            event.preventDefault();
            setViewport((v) => ({ ...v, x: v.x + move[0], y: v.y + move[1] }));
          }
        }}
      >
        <defs>
          <radialGradient id="memory-light">
            <stop stopColor="#fffaf1" />
            <stop offset=".8" stopColor="#f1e0c5" />
            <stop offset="1" stopColor="#fffdf8" />
          </radialGradient>
        </defs>
        <g
          transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
        >
          {graph.nodes.length === 0 && (
            <g className="empty-motif" aria-hidden="true">
              {Array.from({ length: 48 }, (_, i) => {
                const x = 30 + ((i * 173 + Math.floor(i / 3) * 97) % 940),
                  y = 20 + ((i * i * 59 + i * 73) % 760);
                return (
                  <g key={i}>
                    <path d={`M ${x} ${y} l 95 45 l -30 90 l -65 -135`} />
                    <circle cx={x} cy={y} r={(i % 3) + 2} />
                  </g>
                );
              })}
            </g>
          )}
          {edges.map((edge, index) => {
            const from = nodes.find((n) => n.id === edge.from)!,
              to = nodes.find((n) => n.id === edge.to)!;
            return (
              <line
                key={index}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className={edge.tentative ? "tentative" : ""}
              >
                <title>{edge.reason}</title>
              </line>
            );
          })}
          {nodes.map((node) => (
            <g
              key={node.id}
              className={`graph-node ${node.kind} ${node.tentative ? "tentative" : ""} ${node.memory.id === selected || highlights.includes(node.memory.id) || connected.has(node.id) ? "highlighted" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${node.label} · ${node.tentative ? "Unresolved; " : ""}1 source · revision ${node.memory.revision}`}
              onClick={() => onSelect(node.memory)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(node.memory);
                }
              }}
              transform={`translate(${node.x} ${node.y})`}
            >
              <title>
                {node.label} ·{" "}
                {node.tentative
                  ? "Unresolved mention; identity not confirmed"
                  : "Saved source"}
              </title>
              <circle
                r={
                  node.kind === "memories"
                    ? node.memory.id === selected
                      ? 65
                      : explore
                        ? 37
                        : 13
                    : 5
                }
                fill={
                  node.kind === "memories" ? "url(#memory-light)" : undefined
                }
              />
              {explore && (
                <text y={node.kind === "memories" ? 3 : 22} textAnchor="middle">
                  {node.label.length > 24
                    ? node.label.slice(0, 23) + "…"
                    : node.label}
                </text>
              )}
            </g>
          ))}
        </g>
      </svg>
      {explore && (
        <>
          <div className="graph-tools" aria-label="Graph controls">
            <label>
              Show{" "}
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as GraphKind | "all")}
              >
                {["all", "memories", "people", "places", "topics"].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() =>
                setViewport((v) => ({
                  ...v,
                  zoom: Math.min(2.5, v.zoom + 0.2),
                }))
              }
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              onClick={() =>
                setViewport((v) => ({
                  ...v,
                  zoom: Math.max(0.5, v.zoom - 0.2),
                }))
              }
              aria-label="Zoom out"
            >
              −
            </button>
            <button onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })}>
              Reset view
            </button>
            <label>
              <input
                type="checkbox"
                checked={includeUnresolved}
                onChange={(event) => setIncludeUnresolved(event.target.checked)}
              />{" "}
              Unresolved mentions
            </label>
            <button aria-expanded={list} onClick={() => setList(!list)}>
              Relationship list
            </button>
          </div>
          {list && (
            <section
              className="graph-list glass"
              aria-label="Graph relationship list"
            >
              <label>
                Find a node
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              {filtered.length > 200 && (
                <p>Showing 200 nodes. Filter to explore more.</p>
              )}
              {nodes.map((n) => (
                <article key={n.id}>
                  <button onClick={() => onSelect(n.memory)}>{n.label}</button>
                  <small>
                    {n.tentative ? "Unresolved mention · " : ""}Source:{" "}
                    {n.memory.source_name} · revision {n.memory.revision}
                  </small>
                  {graph.edges
                    .filter((e) => e.from === n.id || e.to === n.id)
                    .map((e, i) => (
                      <p key={i}>{e.reason}</p>
                    ))}
                </article>
              ))}
            </section>
          )}
          <p className="graph-help">
            Drag to pan · Scroll to zoom · Arrow keys to move · Select a node to
            inspect its source
            {graph.nodes.length === 0 ? " · No memories yet" : ""}
          </p>
        </>
      )}
    </div>
  );
}
