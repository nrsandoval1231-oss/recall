import type { VaultMemory } from "../platform/local-vault";
import { vaultContext } from "./vault-context";
export type GraphKind = "memories" | "people" | "places" | "topics";
export interface GraphNode {
  id: string;
  label: string;
  kind: GraphKind;
  memory: VaultMemory;
  tentative: boolean;
  x: number;
  y: number;
}
export interface GraphEdge {
  from: string;
  to: string;
  reason: string;
  tentative: boolean;
}
function position(id: string) {
  let hash = 2166136261;
  for (const char of id)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const angle = ((hash % 3600) * Math.PI) / 1800;
  const ring = 0.72 + (Math.floor(hash / 3600) % 28) / 100;
  return {
    x: 500 + Math.cos(angle) * 365 * ring,
    y: 350 + Math.sin(angle) * 240 * ring,
  };
}
/** Layout only: leave source identities, provenance and relationships unchanged.
 * Reserve room for source hit targets, their labels, and the central library mark.
 * Sorted source/mention order makes collision resolution independent of index order.
 */
function separateNodes(nodes: GraphNode[]) {
  const placed: GraphNode[] = [];
  const width = (node: { label: string }) =>
    Math.max(70, Math.min(node.label.length, 18) * 8);
  // The view renders at most 200 nodes; larger libraries remain searchable in the list.
  for (const node of nodes.slice(0, 200)) {
    const origin = { x: node.x, y: node.y };
    let best = origin;
    let bestPenalty = Infinity;
    const obstacles = [...placed, { x: 500, y: 350, label: "Your library" }];
    for (let attempt = 0; attempt < 360; attempt++) {
      const angle = attempt * 2.399963229728653;
      const radius = 20 * Math.sqrt(attempt);
      const candidate = {
        x: Math.max(160, Math.min(840, origin.x + Math.cos(angle) * radius)),
        y: Math.max(100, Math.min(590, origin.y + Math.sin(angle) * radius)),
      };
      let penalty = 0;
      for (const other of obstacles) {
        const overlapX =
          width(node) + width(other) + 12 - Math.abs(candidate.x - other.x);
        const overlapY = 145 - Math.abs(candidate.y - other.y);
        if (overlapX > 0 && overlapY > 0) penalty += overlapX * overlapY;
      }
      if (penalty < bestPenalty) {
        best = candidate;
        bestPenalty = penalty;
      }
      if (penalty === 0) break;
    }
    node.x = best.x;
    node.y = best.y;
    placed.push(node);
  }
}
function displayTitle(value: string) {
  const label =
    value
      .replace(/\[\[[^\]]+\]\]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*`]/g, "")
      .trim() || "Untitled memory";
  return label.length > 80 ? label.slice(0, 79) + "…" : label;
}
export function graphTitle(memory: VaultMemory) {
  const title = /^title: (".*")$/m.exec(memory.note)?.[1];
  if (title) {
    try {
      const value: unknown = JSON.parse(title);
      if (typeof value === "string") return displayTitle(value);
    } catch {
      /* Keep source name for unfamiliar user YAML. */
    }
  }
  const body = memory.note.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const heading = /^#{1,2}\s+(.+)$/m.exec(body)?.[1];
  const name = (memory.source_name === "note.txt" ? "" : memory.source_name).replace(/\.[a-z0-9]+$/i, "");
  const line = body
    .split("\n")
    .find((value) => value.trim() && !value.trim().startsWith("<!--"))
    ?.trim();
  return displayTitle(name || heading || line || "Untitled memory");
}
export function deriveGraph(memories: VaultMemory[]) {
  const records = memories
    .filter((m) => m.state !== "deleted")
    .sort((a, b) => a.id.localeCompare(b.id));
  const nodes: GraphNode[] = records.map((memory) => ({
    id: memory.id,
    label: graphTitle(memory),
    kind: "memories",
    memory,
    tentative: Boolean(memory.conflict) || memory.state !== "active",
    ...position(memory.id),
  }));
  const edges: GraphEdge[] = [];
  for (const memory of records.filter(
    (m) => m.state === "active" && !m.conflict,
  )) {
    const context = vaultContext([memory]);
    for (const [kind, rows] of [
      ["people", context.people],
      ["places", context.places],
      ["topics", [...context.projects, ...context.topics]],
    ] as const) {
      rows.forEach((row, index) => {
        const id = `${memory.id}:${kind}:${index}`;
        const tentative = row.note.includes("unresolved");
        nodes.push({
          id,
          label: row.label,
          kind,
          memory,
          tentative,
          ...position(id),
        });
        edges.push({ from: memory.id, to: id, reason: row.note, tentative });
      });
    }
    for (const match of memory.note.matchAll(
      /\[\[Recall\/Memories\/([^|\]]+)(?:\|[^\]]+)?\]\]([^\n]*)/g,
    )) {
      const path = match[1]!.replace(/\.md$/, "") + ".md";
      const target = records.find(
        (m) => m.note_path === path && m.state === "active" && !m.conflict,
      );
      if (target && target.id !== memory.id)
        edges.push({
          from: memory.id,
          to: target.id,
          reason: `Explicit saved wikilink in ${memory.note_path} · revision ${memory.revision}${match[2]}`,
          tentative: true,
        });
    }
  }
  separateNodes(nodes);
  return { nodes, edges };
}
