import type { VaultMemory } from "../platform/local-vault";
export interface SourceRow { label: string; note: string; memory: VaultMemory }
function section(document: string, heading: string): string[] {
  const lines = document.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}
function unescape(text: string): string { return text.replace(/\\([\\`*_[\]<>#!|])/g, "$1").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"); }
export function vaultContext(memories: VaultMemory[], focusId?: string) {
  const people: SourceRow[] = [], places: SourceRow[] = [], projects: SourceRow[] = [], agenda: SourceRow[] = [], related: SourceRow[] = [];
  const active = memories.filter(memory => memory.state === "active" && !memory.conflict);
  for (const memory of active.filter(memory => focusId === undefined || memory.id === focusId)) {
    // Read native document fields only as display hints. They never authorize a write or identity merge.
    if (!memory.note.startsWith(`---\nrecall_id: "${memory.id}"\n`)) continue;
    for (const line of section(memory.note, "Unresolved entity mentions")) {
      const match = /^- “(.*)” — (person|location|project|organization) candidate; identity unresolved$/.exec(line);
      if (!match) continue; // Retracted mentions never populate context.
      const row = { label: unescape(match[1]!), note: `${match[2]} candidate; identity unresolved · source revision ${memory.revision}`, memory };
      (match[2] === "person" ? people : match[2] === "location" ? places : projects).push(row);
    }
    for (const line of section(memory.note, "Follow-ups (not confirmed commitments)")) {
      const match = /^- \[ \] “(.*)” — source bytes (\d+)–(\d+)$/.exec(line);
      if (match) agenda.push({ label: unescape(match[1]!), note: `Unscheduled source follow-up; not a confirmed commitment · bytes ${match[2]}–${match[3]}`, memory });
    }
    for (const line of section(memory.note, "Related memories")) {
      const match = /^- \[\[Recall\/Memories\/([^|\]]+)\|Related source-backed memory\]\] \(possible relationship; review\)$/.exec(line);
      const target = match && active.find(row => row.note_path === `${match[1]}.md`);
      if (target?.note_path) related.push({ label: target.note_path, note: `Possible relationship from ${memory.note_path}; review`, memory: target });
    }
  }
  return { people, places, projects, agenda, related };
}

function noteParts(memory: Pick<VaultMemory, "id" | "note">): { prefix: string; body: string } | null {
  const marker = `---\nrecall_id: "${memory.id}"\n`;
  if (!memory.note.startsWith(marker)) return null;
  const end = memory.note.indexOf("\n---\n", marker.length - 1);
  if (end < 0) return null;
  const boundary = end + 5 + (memory.note[end + 5] === "\n" ? 1 : 0);
  return { prefix: memory.note.slice(0, boundary), body: memory.note.slice(boundary) };
}
export function noteBody(memory: Pick<VaultMemory, "id" | "note">): string {
  return noteParts(memory)?.body ?? memory.note;
}
export function noteWithBody(memory: Pick<VaultMemory, "id" | "note">, body: string): string {
  const parts = noteParts(memory);
  if (!parts && memory.note.startsWith(`---\nrecall_id: "${memory.id}"\n`)) throw new Error("Note properties need review in Obsidian before saving a body correction.");
  return parts ? parts.prefix + body : body;
}
