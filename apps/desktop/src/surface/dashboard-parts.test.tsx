// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CaptureCalendar } from "./dashboard-parts";
import { NoteMarkdown, noteSummary } from "./NoteMarkdown";
import type { VaultMemory } from "../platform/local-vault";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
const memory: VaultMemory = {
  id: "11111111-1111-4111-8111-111111111111",
  state: "active",
  revision: 2,
  note_path: "first.md",
  note: '---\nrecall_id: "11111111-1111-4111-8111-111111111111"\ntitle: "Utility meeting"\n---\n\nUtility late?',
  source_name: "meeting.txt",
  source_sha256: "ab".repeat(32),
  captured_at: "2026-05-12T01:00:00Z",
  updated_at: "2026-05-12T01:00:00Z",
  conflict: null,
};

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

it.each(["Asia/Tokyo", "America/Chicago"])(
  "keeps UTC capture days and follow-ups consistent in %s",
  async (timezone) => {
    vi.stubEnv("TZ", timezone);
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <CaptureCalendar
        initialMonth="2026-05"
        memories={[memory]}
        agenda={[{ label: "Call Sarah?", note: "Unscheduled", memory }]}
        onOpen={onOpen}
        onCapture={vi.fn()}
      />,
    );
    expect(screen.getByText("Unscheduled")).toBeTruthy();
    expect(screen.queryByText("9:00 AM")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "May 12, 2026, 1 captured notes" }),
    );
    await user.click(screen.getByRole("button", { name: "Utility meeting" }));
    expect(onOpen).toHaveBeenCalledWith(memory);
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "June 2026" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Utility meeting" }),
    ).toBeNull();
  },
);

it("never promotes retracted-only statements into a home summary", () => {
  expect(
    noteSummary(
      "# Meeting\n\n## Retracted source statements (not facts)\n\n- 8 MW confirmed\n\n## Original evidence\n\nsource only",
    ),
  ).toBe("");
});
