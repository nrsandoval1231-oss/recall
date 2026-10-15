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
  const angle = (hash % 3600) * Math.PI / 1800;
  const ring = 0.72 + (Math.floor(hash / 3600) % 28) / 100;
  return { x: 500 + Math.cos(angle) * 365 * ring, y: 350 + Math.sin(angle) * 240 * ring };
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
  const name = memory.source_name.replace(/\.[a-z0-9]+$/i, "");
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
  return { nodes, edges };
}
