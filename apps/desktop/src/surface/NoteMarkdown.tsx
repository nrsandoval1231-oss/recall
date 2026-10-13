import ReactMarkdown from "react-markdown";
import type { VaultMemory } from "../platform/local-vault";

/** Vault Markdown is untrusted: no HTML, images, remote navigation, or executable links. */
export function NoteMarkdown({
  children,
  memories = [],
  onOpen,
}: {
  children: string;
  memories?: VaultMemory[];
  onOpen?: (memory: VaultMemory) => void;
}) {
  const links = new Map<string, VaultMemory>();
  const content = children.replace(
    /\[\[([^|\]\n]+)(?:\|([^\]\n]+))?\]\]/g,
    (original, target: string, alias: string | undefined) => {
      const path = target
        .replace(/^Recall\/Memories\//, "")
        .replace(/\.md$/, "");
      const memory = memories.find(
        (m) =>
          m.state === "active" &&
          !m.conflict &&
          (m.id === path || m.note_path === path + ".md"),
      );
      if (!memory || !onOpen) return original;
      const key = `#recall-memory-${memory.id}`;
      links.set(key, memory);
      return `[${(alias || path).replaceAll("[", " ").replaceAll("]", " ").replaceAll("\\", " ")}](${key})`;
    },
  );
  return (
    <div className="ms-markdown">
      <ReactMarkdown
        skipHtml
        components={{
          a: ({ children, href }) => {
            const memory = href && links.get(href);
            return memory ? (
              <button
                type="button"
                className="ms-internal-link"
                onClick={() => onOpen?.(memory)}
              >
                {children}
              </button>
            ) : (
              <span className="ms-note-link">{children}</span>
            );
          },
          img: () => null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function noteSummary(text: string): string {
  const lines: string[] = [];
  let excluded = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      excluded =
        /^## (Retracted source statements|Original evidence|Unresolved entity mentions)/.test(
          line,
        );
      continue;
    }
    if (excluded || !line.trim() || /^\s*(#|SHA-256:|\[\[)/.test(line))
      continue;
    lines.push(
      line
        .trim()
        .replace(/^-\s*(\[[ x]\]\s*)?/, "")
        .replace(/[*`]/g, ""),
    );
    if (lines.length === 3) break;
  }
  const summary = lines.join(" ");
  if (summary.length <= 240) return summary;
  const prefix = summary.slice(0, 239);
  const boundary = prefix.lastIndexOf(" ");
  return `${(boundary > 0 ? prefix.slice(0, boundary) : prefix).trimEnd()}…`;
}
