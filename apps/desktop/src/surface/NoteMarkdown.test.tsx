// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NoteMarkdown, noteSummary } from "./NoteMarkdown";
afterEach(cleanup);

it("renders readable Markdown without executing HTML or opening untrusted destinations", () => {
  const { container } = render(
    <NoteMarkdown>
      {
        "# Meeting\n\n## Questions\n\n- Need generators by Dec?\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1)) [remote](https://example.com) ![tracking](https://example.com/a.png)"
      }
    </NoteMarkdown>,
  );
  expect(
    screen.getByRole("heading", { name: "Questions", level: 2 }),
  ).toBeTruthy();
  expect(screen.getByRole("listitem").textContent).toBe(
    "Need generators by Dec?",
  );
  expect(container.querySelector("script, img, iframe, a")).toBeNull();
});

it("never promotes retracted-only statements into a home summary", () => {
  expect(
    noteSummary(
      "# Meeting\n\n## Retracted source statements (not facts)\n\n- 8 MW confirmed\n\n## Original evidence\n\nsource only",
    ),
  ).toBe("");
});
it("marks a shortened preview with an ellipsis without splitting its final word", () => {
  const text = "Follow up with the operator about the proposed tour. ".repeat(
    8,
  );
  const summary = noteSummary(text);
  expect(summary.length).toBeLessThanOrEqual(240);
  expect(summary.endsWith("…")).toBe(true);
  expect(text.startsWith(summary.slice(0, -1))).toBe(true);
  expect(summary.slice(0, -1)).toMatch(
    /\b(tour\.|proposed|the|about|operator|with|up|Follow)$/,
  );
});
