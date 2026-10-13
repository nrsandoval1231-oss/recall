import { describe, expect, it } from "vitest";
import { deriveGraph } from "./adaptive-graph";
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
