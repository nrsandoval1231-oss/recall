export interface SearchDoc {
  id: string;
  title: string;
  text: string;
}

export interface SearchHit {
  id: string;
  title: string;
  excerpt: string;
}

export type KeywordAnswer =
  | { kind: "matches"; hits: SearchHit[] }
  | { kind: "abstain"; message: string };

export const KEYWORD_LABEL = "Keyword search. Not a Claude answer.";

const QUESTION_WORDS = new Set([
  "what", "whats", "who", "whom", "whose", "where", "when", "why", "how",
  "do", "does", "did", "is", "are", "was", "were", "be", "been",
  "you", "your", "yours", "me", "my", "we", "our",
  "the", "a", "an", "of", "to", "for", "in", "on", "at", "and", "or",
  "about", "know", "tell", "anything", "something", "please", "recall",
]);

const ABSTAIN =
  "Nothing in the notes matches that. This is keyword search on this device, not a Claude answer.";

/** Every remaining term must occur. Question words are ignored. This does not paraphrase or call a model. */
export function keywordSearch(query: string, docs: readonly SearchDoc[]): KeywordAnswer {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((term) => term.length > 1 && !QUESTION_WORDS.has(term));
  if (!query.trim()) return { kind: "abstain", message: "Type a question to search the notes." };
  if (!terms.length) return { kind: "abstain", message: "Type a question that includes a word from the notes." };
  if (query.length > 4096) return { kind: "abstain", message: "That question is too long to search." };
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const haystack = `${doc.title}\n${doc.text}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;
    const term = terms[0] ?? "";
    hits.push({ id: doc.id, title: doc.title, excerpt: excerpt(doc.text, term) });
  }
  if (!hits.length) return { kind: "abstain", message: ABSTAIN };
  return { kind: "matches", hits };
}

function excerpt(text: string, term: string): string {
  const at = text.toLowerCase().indexOf(term);
  const start = at < 0 ? 0 : Math.max(0, at - 48);
  const slice = text.slice(start, start + 220).trim();
  return `${start > 0 ? "…" : ""}${slice}`;
}
