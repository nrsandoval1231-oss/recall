import { expect, it } from "vitest";
import type { VaultMemory } from "../platform/local-vault";
import { vaultContext, noteBody, noteWithBody } from "./vault-context";
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

it("focuses one source without merging names and still resolves native related targets", () => {
  const a = source("a"), b = source("b");
  const focused = vaultContext([a, b], "a");
  expect(focused.people.map(row => row.memory.id)).toEqual(["a"]);
  expect(focused.agenda).toHaveLength(1);
  expect(focused.related[0]?.memory).toBe(b);
  expect(vaultContext([a, b], "missing").people).toEqual([]);
});

it("preserves exact native properties when replacing the editable body", () => {
  const memory = source("a");
  memory.note = `---\nrecall_id: "a"\ntitle: "Utility late"\ncustom_owner_property: "keep me"\n---\n\nUtility late.\n`;
  expect(noteBody(memory)).toBe("Utility late.\n");
  expect(noteWithBody(memory, noteBody(memory))).toBe(memory.note);
  expect(noteWithBody(memory, "Utility is now on time.")).toBe(`---\nrecall_id: "a"\ntitle: "Utility late"\ncustom_owner_property: "keep me"\n---\n\nUtility is now on time.`);
});
it("does not interpret raw captures or foreign identity headers as native properties", () => {
  const memory = source("a"); memory.note = `---\nrecall_id: "other"\n---\nraw source`;
  expect(noteBody(memory)).toBe(memory.note);
  expect(noteWithBody(memory, "My words")).toBe("My words");
});
it("refuses to build corrections from malformed native properties", () => {
  const memory = source("a"); memory.note = `---\nrecall_id: "a"\nno closing delimiter`;
  expect(noteBody(memory)).toBe(memory.note);
  expect(() => noteWithBody(memory, "replacement")).toThrow(/properties need review/);
});

it("reads topic tags only from frontmatter and never from body examples", () => {
  const tagged = source("a");
  tagged.note = tagged.note.replace('recall_id: "a"\n', 'recall_id: "a"\ntags: [recall/meeting, power]\n') + "\ntags: [invented-body-tag]\n";
  expect(vaultContext([tagged]).topics.map(row => row.label)).toEqual(["recall/meeting", "power"]);
});
