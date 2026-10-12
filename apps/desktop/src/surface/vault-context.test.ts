import { expect, it } from "vitest";
import type { VaultMemory } from "../platform/local-vault";
import { vaultContext } from "./vault-context";
function source(id: string, state: VaultMemory["state"] = "active"): VaultMemory { return { id, state, revision: 2, note_path: `${id}.md`, captured_at: "1", updated_at: "2", source_name: "", source_sha256: "a".repeat(64), conflict: null, note: `---\nrecall_id: "${id}"\n---\n## Unresolved entity mentions\n\n- “Sarah” — person candidate; identity unresolved\n- “North \\[gate\\]” — location candidate; identity unresolved\n- “Prism” — organization candidate; identity unresolved\n- “Brad” — person candidate; identity unresolved; retracted\n## Follow-ups (not confirmed commitments)\n\n- [ ] “Call Sarah” — source bytes 20–30\n## Open questions and uncertainty\n\n-  “Need generators by Dec?” — source bytes 31–55\n## Related memories\n\n- [[Recall/Memories/b|Related source-backed memory]] (possible relationship; review)\n` }; }
it("keeps same-name mentions source-scoped, excludes retractions and does not create deadlines from questions", () => {
  const a = source("a"), b = source("b"); const data = vaultContext([a, b]);
  expect(data.people.map(row => row.memory.id)).toEqual(["a", "b"]);
  expect(data.places[0]?.label).toBe("North [gate]");
  expect(data.projects[0]?.label).toBe("Prism");
  const encoded = source("encoded"); encoded.note = encoded.note.replace("Sarah", "&lt;yard&gt; &amp;lt;");
  expect(vaultContext([encoded]).people[0]?.label).toBe("<yard> &lt;");
  expect(data.agenda.map(row => row.label)).toEqual(["Call Sarah", "Call Sarah"]);
  expect(data.agenda[0]?.note).toContain("Unscheduled");
  expect(data.related[0]?.memory).toBe(b);
});
it("ignores arbitrary capture text, deleted/conflicted memories and missing related targets", () => {
  const raw = source("raw"); raw.note = raw.note.replace(/^---\nrecall_id:.*\n/, "");
  const conflict = source("conflict"); conflict.conflict = "external edit";
  expect(vaultContext([raw, source("deleted", "deleted"), conflict]).people).toEqual([]);
  expect(vaultContext([source("a")]).related).toEqual([]);
});
