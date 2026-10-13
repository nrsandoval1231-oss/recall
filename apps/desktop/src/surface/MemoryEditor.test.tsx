// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryEditor } from "./MemoryEditor";
import type { VaultMemory } from "../platform/local-vault";
const memory: VaultMemory = {
  id: "a",
  state: "active",
  revision: 1,
  note: "A human note?",
  note_path: "a.md",
  source_name: "",
  source_sha256: "",
  captured_at: "2026-10-13",
  updated_at: "2026-10-13",
  conflict: null,
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});
it("autosaves through a revision-safe commit without provider calls", async () => {
  vi.useFakeTimers();
  const save = vi.fn(async (intent) => ({
    ...memory,
    revision: 2,
    note: intent.note,
  }));
  render(
    <MemoryEditor
      identity="library"
      memory={memory}
      value={memory.note}
      onChange={() => {}}
      commit={save}
      memories={[memory]}
      onOpen={() => {}}
      disabled={false}
    />,
  );
  fireEvent.change(screen.getByLabelText("Your correction"), {
    target: { value: "Edited human words?" },
  });
  await act(async () => vi.advanceTimersByTime(1200));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: 1,
      note: "Edited human words?",
    }),
  );
  expect(screen.getByRole("status").textContent).toContain("Saved in library");
});
it("formats selected words and keeps preview inside Recall", () => {
  render(
    <MemoryEditor
      identity="library"
      memory={memory}
      value={memory.note}
      onChange={() => {}}
      commit={async () => memory}
      memories={[memory]}
      onOpen={() => {}}
      disabled={false}
    />,
  );
  const editor = screen.getByLabelText(
    "Your correction",
  ) as HTMLTextAreaElement;
  editor.setSelectionRange(2, 7);
  fireEvent.click(screen.getByRole("button", { name: "Bold" }));
  expect(editor.value).toContain("**human**");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.getByText("human").tagName).toBe("STRONG");
});

it("does not autosave an unreviewed machine reading until explicit save", async () => {
  vi.useFakeTimers();
  const save = vi.fn(async (intent) => ({
    ...memory,
    revision: 2,
    note: intent.note,
  }));
  const props = {
    identity: "library",
    memory,
    onChange: () => {},
    commit: save,
    memories: [memory],
    onOpen: () => {},
    disabled: false,
  };
  const view = render(<MemoryEditor {...props} value={memory.note} />);
  view.rerender(
    <MemoryEditor {...props} value="Unreviewed machine reading?" />,
  );
  await act(async () => vi.advanceTimersByTime(1500));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await act(async () => {});
  expect(save).toHaveBeenCalledTimes(1);
});

it("does not submit unchanged corrections before or after an actual edit", async () => {
  const save = vi.fn(async (intent) => ({ ...memory, revision: 2, note: intent.note }));
  render(<MemoryEditor identity="library" memory={memory} value={memory.note}
    onChange={() => {}} commit={save} memories={[memory]} onOpen={() => {}} disabled={false} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save correction" })));
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Your correction"), { target: { value: "Actual edit" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save correction" })));
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save correction" })));
  expect(save).toHaveBeenCalledTimes(1);
});
