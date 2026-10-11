export interface NoteRef {
  id: string;
  title: string;
  text: string;
}

export interface RelatedNote {
  id: string;
  title: string;
  excerpt: string;
}

export interface RelatedGroups {
  linked: RelatedNote[];
  mentioned: RelatedNote[];
}

/** Notes this one links to, notes that link here, and title mentions either way. */
export function relatedTo(focusId: string, notes: readonly NoteRef[]): RelatedGroups {
  const focus = notes.find((note) => note.id === focusId);
  if (!focus) return { linked: [], mentioned: [] };
  const linked: RelatedNote[] = [];
  const linkedIds = new Set<string>();
  for (const note of notes) {
    if (note.id === focus.id) continue;
    const outgoing = linkTargets(focus.text).some((target) => sameTarget(target, note));
    const incoming = linkTargets(note.text).some((target) => sameTarget(target, focus));
    if (!outgoing && !incoming) continue;
    linkedIds.add(note.id);
    linked.push({
      id: note.id,
      title: note.title,
      excerpt: outgoing ? "This note links to it." : "It links to this note.",
    });
  }
  const mentioned: RelatedNote[] = [];
  for (const note of notes) {
    if (note.id === focus.id || linkedIds.has(note.id)) continue;
    const here = mentionsTitle(focus.text, note.title);
    const there = mentionsTitle(note.text, focus.title);
    if (!here && !there) continue;
    mentioned.push({
      id: note.id,
      title: note.title,
      excerpt: here ? "This note names that title." : "That note names this title.",
    });
  }
  return { linked, mentioned };
}

function linkTargets(text: string): string[] {
  const targets: string[] = [];
  for (const match of text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const target = match[1]?.trim();
    if (target) targets.push(target);
  }
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1]?.trim() ?? "";
    if (!href || /\/sources\//i.test(href) || /^sources\//i.test(href)) continue;
    if (/\.(png|jpe?g|webp|gif)$/i.test(href)) continue;
    const file = href.split("/").pop()?.replace(/\.md$/i, "") ?? "";
    if (file) {
      try {
        targets.push(decodeURIComponent(file));
      } catch {
        targets.push(file);
      }
    }
  }
  return targets;
}

function sameTarget(target: string, note: NoteRef): boolean {
  const value = target.trim().toLowerCase();
  if (!value) return false;
  const title = note.title.trim().toLowerCase();
  return value === note.id.toLowerCase() || (title.length > 0 && value === title);
}

function mentionsTitle(text: string, title: string): boolean {
  const cleaned = title.trim();
  if (cleaned.length < 3) return false;
  const plain = text
    .replace(/\[\[[^\]]+\]\]/g, " ")
    .replace(/\[[^\]]*\]\([^)]+\)/g, " ");
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(plain);
}
