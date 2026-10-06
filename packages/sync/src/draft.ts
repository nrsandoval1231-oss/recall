import { MAX_PAGES } from "./types";

/** An unsaved page held in memory. A draft is NOT durable: only Save makes a capture durable. */
export interface DraftPage {
  id: string;
  /** Temporary camera / photo-library URI. */
  uri: string;
  originalFilename: string | null;
}

export interface AddResult {
  draft: DraftPage[];
  /** Pages that did not fit under the 10-page limit. */
  rejected: number;
}

export function addPages(draft: DraftPage[], pages: DraftPage[]): AddResult {
  const room = Math.max(0, MAX_PAGES - draft.length);
  return { draft: [...draft, ...pages.slice(0, room)], rejected: Math.max(0, pages.length - room) };
}

export function removePage(draft: DraftPage[], id: string): DraftPage[] {
  return draft.filter((p) => p.id !== id);
}

/** Replace a page in place (retake): its position is preserved. */
export function retakePage(draft: DraftPage[], id: string, replacement: DraftPage): DraftPage[] {
  return draft.map((p) => (p.id === id ? replacement : p));
}

export function movePage(draft: DraftPage[], id: string, delta: -1 | 1): DraftPage[] {
  const from = draft.findIndex((p) => p.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= draft.length) return draft;
  const next = [...draft];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as DraftPage);
  return next;
}
