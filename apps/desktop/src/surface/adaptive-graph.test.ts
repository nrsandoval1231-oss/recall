import { describe, expect, it } from "vitest";
import { deriveGraph, graphTitle } from "./adaptive-graph";
import type { VaultMemory } from "../platform/local-vault";
const row = (id: string, note = ""): VaultMemory => ({
  id,
  note,
  state: "active",
  revision: 1,
  note_path: `${id}.md`,
  source_name: `${id}.txt`,
  source_sha256: "a".repeat(64),
  captured_at: "2026-10-13T00:00:00Z",
  updated_at: "2026-10-13T00:00:00Z",
  conflict: null,
});
describe("derived vault graph", () => {
  it("has no invented nodes in an empty vault", () =>
    expect(deriveGraph([]).nodes).toEqual([]));
  it("rebuilds stable positions regardless of index order", () =>
    expect(deriveGraph([row("a"), row("b")])).toEqual(
      deriveGraph([row("b"), row("a")]),
    ));
  it("does not link unconnected notes or deleted records", () => {
    const g = deriveGraph([row("a"), { ...row("b"), state: "deleted" }]);
    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toEqual([]);
  });
  it("keeps unresolved same-name mentions separate and marks their provenance", () => {
    const note = (id: string) =>
      `---\nrecall_id: "${id}"\n---\n\n## Unresolved entity mentions\n- “Sarah” — person candidate; identity unresolved`;
    const g = deriveGraph([row("a", note("a")), row("b", note("b"))]);
    expect(g.nodes.filter((n) => n.kind === "people")).toHaveLength(2);
    expect(
      g.edges.every((e) => e.tentative && e.reason.includes("unresolved")),
    ).toBe(true);
  });
  it("only resolves explicit links to eligible current vault notes", () => {
    const g = deriveGraph([
      row(
        "a",
        "[[Recall/Memories/b|Related source-backed memory]] (possible relationship; review)",
      ),
      row("b"),
      { ...row("c", "[[Recall/Memories/b]]"), conflict: "edited" },
    ]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]?.tentative).toBe(true);
  });
});

it("uses authored headings or words to distinguish native notes without AI or mandatory folders", () => {
  expect(graphTitle({ ...row("a", "Buy groceries?"), source_name: "" })).toBe(
    "Buy groceries?",
  );
  expect(
    graphTitle({
      ...row("a", "---\ntags: [personal]\n---\n# Reading notes\nDetails"),
      source_name: "",
    }),
  ).toBe("Reading notes");
  expect(graphTitle({ ...row("a", ""), source_name: "" })).toBe(
    "Untitled memory",
  );
  expect(
    graphTitle({ ...row("a", "x".repeat(200)), source_name: "" }).length,
  ).toBe(80);
  expect(
    graphTitle({
      ...row("a", "## Unresolved entity mentions"),
      source_name: "north-lot.png",
    }),
  ).toBe("north-lot");
});

it("uses a saved heading before the source filename for adaptive graph previews", () => {
  expect(graphTitle({
    ...row("a", "---\ntags: [personal]\n---\n# Utility delay notes\nDetails"),
    source_name: "IMG_1042.jpg",
  })).toBe("Utility delay notes");
});

it("bounds interpreted titles consistently without rewriting their metadata", () => {
  const note = `title: "${"x".repeat(200)}"`;
  expect(graphTitle(row("a", note)).length).toBe(80);
  expect(row("a", note).note).toBe(note);
});

it("separates a source and its saved utility topic without changing evidence", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const source = row(
    id,
    `---\nrecall_id: "${id}"\ntags: [utility]\n---\nUtility delay?`,
  );
  const snapshot = structuredClone(source);
  const graph = deriveGraph([source]);
  const memory = graph.nodes.find((node) => node.kind === "memories")!;
  const topic = graph.nodes.find((node) => node.kind === "topics")!;
  // Account for the selected source's 65px radius, the topic and both labels.
  expect(
    Math.abs(memory.x - topic.x) >= 152 || Math.abs(memory.y - topic.y) >= 145,
  ).toBe(true);
  expect(Math.hypot(memory.x - topic.x, memory.y - topic.y)).toBeGreaterThan(
    100,
  );
  expect(graph.edges).toEqual([
    {
      from: id,
      to: topic.id,
      tentative: false,
      reason: "Saved note tag · source revision 1",
    },
  ]);
  expect(source).toEqual(snapshot);
  expect(deriveGraph([source])).toEqual(graph);
});

it("keeps multiple sources and their mentions apart independent of input ordering", () => {
  const records = ["a", "b", "c"].map((id) =>
    row(id, `---\nrecall_id: "${id}"\ntags: [utility]\n---\nSynthetic fixture`),
  );
  const graph = deriveGraph(records);
  expect(deriveGraph([...records].reverse())).toEqual(graph);
  for (const [index, node] of graph.nodes.entries()) {
    for (const other of graph.nodes.slice(index + 1)) {
      expect(
        Math.abs(node.x - other.x) >=
          Math.max(70, Math.min(node.label.length, 18) * 8) +
            Math.max(70, Math.min(other.label.length, 18) * 8) +
            12 || Math.abs(node.y - other.y) >= 145,
      ).toBe(true);
    }
  }
});
