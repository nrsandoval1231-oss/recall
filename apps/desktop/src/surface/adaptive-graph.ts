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
  return { x: 120 + (hash % 760), y: 95 + (Math.floor(hash / 997) % 610) };
}
export function graphTitle(memory: VaultMemory) {
  const title = /^title: (".*")$/m.exec(memory.note)?.[1];
  if (title) {
    try {
      const value: unknown = JSON.parse(title);
      if (typeof value === "string") return value;
    } catch {
      /* Keep source name for unfamiliar user YAML. */
    }
  }
  return memory.source_name.replace(/\.[a-z0-9]+$/i, "") || "Memory";
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
  return { nodes, edges };
}
