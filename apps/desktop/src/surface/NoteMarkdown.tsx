import ReactMarkdown from "react-markdown";

/** Vault Markdown is untrusted: no HTML, images, remote navigation, or executable links. */
export function NoteMarkdown({ children }: { children: string }) {
  return (
    <div className="ms-markdown">
      <ReactMarkdown
        skipHtml
        components={{
          a: ({ children }) => <span className="ms-note-link">{children}</span>,
          img: () => null,
        }}
      >
        {children}
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
