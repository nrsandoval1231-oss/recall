// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LocalVault, VaultMemory, VaultStatus } from "../platform/local-vault";
import type { Librarian } from "./librarian";
import { MemorySurface } from "./MemorySurface";

beforeAll(() => {
  if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

const emptyStatus: VaultStatus = { root: null, vault_id: null, vault_identity: null };
const chosen: VaultStatus = { root: "/vaults/field", vault_id: "session-token", vault_identity: "11111111-1111-4111-8111-111111111111" };

function memory(over: Partial<VaultMemory> = {}): VaultMemory {
  return {
    state: "active",
    note_path: "11111111-1111-4111-8111-111111111111.md",
    id: "11111111-1111-4111-8111-111111111111",
    revision: 1,
    note: "North lot laydown yard. Gate code 48?",
    source_name: "north-lot.png",
    source_sha256: "ab".repeat(32),
    captured_at: "2026-08-21T15:00:00Z",
    updated_at: "2026-08-21T15:04:00Z",
    conflict: null,
    ...over,
  };
}

function vault(over: Partial<LocalVault> = {}, memories: VaultMemory[] = []): LocalVault {
  return {
    available: true,
    status: vi.fn(async () => chosen),
    select: vi.fn(async () => null),
    openDefault: vi.fn(async () => ({ ...chosen, root: "/home/me/Documents/Recall" })),
    capture: vi.fn(async () => null),
    list: vi.fn(async () => memories),
    rebuild: vi.fn(async () => memories),
    restoreNote: vi.fn(),
    remove: vi.fn(async () => memory({ state: "deleted" })),
    correct: vi.fn(async (_vaultId, _id, _rev, _op, note) => memory({ revision: 2, note })),
    source: vi.fn(async () => ({ bytes: [137, 80, 78, 71], mime_type: "image/png", sha256: "ab".repeat(32) })),
    history: vi.fn(async () => [{ revision: 1, note: "North lot laydown yard. Gate code 48?", recorded_at: "2026-08-21T15:04:00Z", origin: "human:recall" as const, kind: "capture" as const }]),
    ...over,
  };
}

const preview: LocalVault = { ...vault(), available: false, status: async () => emptyStatus };

describe("Memory Surface", () => {
  it("shows the synthetic Brooks Campus surface when no vault is open", () => {
    const { container } = render(<MemorySurface vault={preview} />);
    expect(screen.getByText("RECALL")).toBeTruthy();
    expect(screen.getByText("Your life remembers itself.")).toBeTruthy();
    for (const label of ["Ask Recall", "Home", "Recent", "People", "Places", "Projects", "Equipment", "Timeline", "Capture"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: "Brooks Campus" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Blake Combs/ })).toBeTruthy();
    expect(screen.getByText(/Synthetic demo/)).toBeTruthy();
    expect(screen.getAllByText(/Potential 300MW \(phased\)/).length).toBeGreaterThan(0);
    expect(container.querySelector(".ms-desk, .ms-paper, .ms-polaroid, .ms-mug, .ms-recent, img")).toBeNull();
    expect(screen.queryByText("Important conversations deserve a long memory.")).toBeNull();
    expect(screen.queryByRole("img", { name: /site illustration/i })).toBeNull();
    expect(screen.queryByText("Synthetic site illustration")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recent Memories" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Timeline and recent memories" })).toBeNull();
    expect(screen.queryByText(/View all/i)).toBeNull();
    expect(screen.getByRole("region", { name: "Timeline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AUG" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("region", { name: "People" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Locations" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Key Topics" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Related" })).toBeTruthy();
    expect(screen.queryByText("Email me a sign-in link")).toBeNull();
    expect((screen.getByRole("button", { name: "Voice ask is not available in this build" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps decorative desk images out of the surface stylesheet", () => {
    const cssPath = [resolve("src/surface/memory-surface.css"), resolve("apps/desktop/src/surface/memory-surface.css")].find((path) => existsSync(path));
    expect(cssPath).toBeTruthy();
    const css = readFileSync(cssPath ?? "", "utf8");
    expect(css).not.toMatch(/url\s*\(/i);
    expect(css).not.toMatch(/memory-surface-reference|\.jpg|\.png|\.webp/i);
  });

  it("moves the timeline marker without a recent-memories strip", async () => {
    const user = userEvent.setup();
    render(<MemorySurface vault={preview} />);
    await user.click(screen.getByRole("button", { name: "SEP" }));
    expect(screen.getByRole("button", { name: "SEP" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /Utility Discussion/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Preliminary Plan/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Meeting Notes/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recent Memories" })).toBeNull();
  });

  it("answers the reference question from the fixture and opens the sample notebook", async () => {
    const user = userEvent.setup();
    render(<MemorySurface vault={preview} />);
    await user.type(screen.getByRole("searchbox", { name: "Ask Recall" }), "What do you know about Brooks Campus?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByText(/Keyword search. Not a Claude answer/)).toBeTruthy();
    expect(screen.getByText(/synthetic Brooks Campus fixture/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open Meeting Notes" }));
    expect(screen.getByText(/not a photographed page/)).toBeTruthy();
    expect(screen.getByText(/Potential 300MW \(phased\)/)).toBeTruthy();
  });

  it("abstains when the fixture has no matching words", async () => {
    const user = userEvent.setup();
    render(<MemorySurface vault={preview} />);
    await user.type(screen.getByRole("searchbox", { name: "Ask Recall" }), "xylophone quantum");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByText("Nothing in the notes matches that. This is keyword search on this device, not a Claude answer.")).toBeTruthy();
    expect(screen.getByText(/Keyword search\. Not a Claude answer\./)).toBeTruthy();
  });

  it("uses vault notes instead of the fixture and opens the original", async () => {
    const user = userEvent.setup();
    const page = memory();
    const client = vault({}, [page]);
    render(<MemorySurface vault={client} />);
    expect(await screen.findByRole("heading", { name: "north-lot" })).toBeTruthy();
    expect(screen.queryByText("Blake Combs")).toBeNull();
    expect(screen.queryByText(/Synthetic demo/)).toBeNull();
    expect(screen.queryByRole("region", { name: "People" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Locations" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Key Topics" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Related" })).toBeNull();
    expect(screen.getByRole("region", { name: "Timeline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AUG" })).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    await user.type(screen.getByRole("searchbox", { name: "Ask Recall" }), "laydown");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByText(/Markdown notes in your vault/)).toBeTruthy();
    expect(screen.getByText(/Gate code 48\?/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open original: north-lot" }));
    expect(client.source).toHaveBeenCalledWith("session-token", page.id);
    expect((await screen.findByTestId("integrity")).textContent).toMatch(/Hash matches the vault record/);
    expect(screen.getByRole("img", { name: /north-lot.png/ })).toBeTruthy();
  });

  it("imports a photo into the vault and retries the same operation", async () => {
    const user = userEvent.setup();
    const saved = memory({ id: "22222222-2222-4222-8222-222222222222", note: "North lot, confirm the gate" });
    const capture = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(saved);
    const client = vault({ capture, status: async () => chosen }, []);
    render(<MemorySurface vault={client} />);
    expect(await screen.findByText(/no active memories/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(screen.getByRole("textbox", { name: "Optional note" }), "North lot, confirm the gate");
    await user.click(screen.getByRole("button", { name: "Import photo" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/disk full/);
    await user.click(screen.getByRole("button", { name: "Retry the same import" }));
    expect((await screen.findAllByText(/Saved in your vault/)).length).toBeGreaterThan(0);
    expect(document.querySelector(".ms")?.getAttribute("data-mode")).toBe("vault");
    expect(capture).toHaveBeenCalledTimes(2);
    const first = capture.mock.calls[0] as [string, string, string];
    const second = capture.mock.calls[1] as [string, string, string];
    expect(first[0]).toBe("session-token");
    expect(first[1]).toBe(second[1]);
    expect(first[1]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first[2]).toBe("North lot, confirm the gate");
    expect(screen.queryByText("Blake Combs")).toBeNull();
  });

  it("versions a correction without changing the original hash", async () => {
    const user = userEvent.setup();
    const page = memory();
    const client = vault({}, [page]);
    render(<MemorySurface vault={client} />);
    await user.click(await screen.findByRole("button", { name: "Open original: north-lot" }));
    const field = await screen.findByRole("textbox", { name: "Your correction" });
    await user.clear(field);
    await user.type(field, "The gate code was not legible.");
    await user.click(screen.getByRole("button", { name: "Save correction" }));
    expect(client.correct).toHaveBeenCalledWith("session-token", page.id, 1, expect.stringMatching(/^[0-9a-f-]{36}$/i), "The gate code was not legible.");
    expect(await screen.findByText(/original photo is unchanged/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText(/Revision 1/)).toBeTruthy();
  });

  it("does not call a reader or the network unless a synthetic reader is injected and consented", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const page = memory();
    render(<MemorySurface vault={vault({}, [page])} />);
    await user.click(await screen.findByRole("button", { name: "Open original: north-lot" }));
    expect(screen.getByText(/will not send this photo/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Read this photo" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    cleanup();

    const read = vi.fn(async () => ({ transcription: "Met w/ Brad?", uncertainties: ["Brad is an unresolved first name."], provider: "synthetic-fixture" }));
    const librarian: Librarian = { mode: "synthetic", notice: "Synthetic reader. It does not call Claude.", read };
    const consented = vault({}, [page]);
    render(<MemorySurface vault={consented} librarian={librarian} />);
    await user.click(await screen.findByRole("button", { name: "Open original: north-lot" }));
    const readButton = screen.getByRole("button", { name: "Read this photo" }) as HTMLButtonElement;
    expect(readButton.disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /synthetic reader/ }));
    await user.click(readButton);
    expect((await screen.findAllByText("Met w/ Brad?")).length).toBeGreaterThan(0);
    expect(screen.getByText(/unresolved first name/)).toBeTruthy();
    expect(screen.getByText(/Not saved to the vault/)).toBeTruthy();
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ consent: true, sha256: page.source_sha256, memoryId: page.id }));
    expect(consented.correct).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("saves a consented synthetic reading only when the person saves the note", async () => {
    const user = userEvent.setup();
    const page = memory();
    const client = vault({}, [page]);
    const read = vi.fn(async () => ({ transcription: "Met w/ Brad?", uncertainties: ["Brad is an unresolved first name."], provider: "synthetic-fixture" }));
    render(<MemorySurface vault={client} librarian={{ mode: "synthetic", notice: "Synthetic reader. It does not call Claude.", read }} />);
    await user.click(await screen.findByRole("button", { name: "Open original: north-lot" }));
    await user.click(screen.getByRole("checkbox", { name: /synthetic reader/ }));
    await user.click(screen.getByRole("button", { name: "Read this photo" }));
    expect(await screen.findByText(/Not saved to the vault/)).toBeTruthy();
    expect(client.correct).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save correction" }));
    expect(client.correct).toHaveBeenCalledWith("session-token", page.id, 1, expect.any(String), "Met w/ Brad?");
  });

  it("opens the default vault without a renderer path and can remove a memory", async () => {
    const user = userEvent.setup();
    const page = memory();
    const client = vault({ status: async () => emptyStatus }, []);
    client.list = vi.fn(async () => []);
    render(<MemorySurface vault={client} />);
    await user.click(await screen.findByRole("button", { name: "Use default vault" }));
    expect(client.openDefault).toHaveBeenCalledWith();
    expect(await screen.findByText("/home/me/Documents/Recall")).toBeTruthy();

    cleanup();
    const filled = vault({}, [page]);
    render(<MemorySurface vault={filled} />);
    await user.click(await screen.findByRole("button", { name: "Open original: north-lot" }));
    const remove = screen.getByRole("button", { name: "Remove from Recall" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /Remove from Recall/ }));
    await user.click(remove);
    expect(filled.remove).toHaveBeenCalledWith("session-token", page.id, 1, expect.any(String), "active");
  });

  it("asks the saved note after an unreviewed reading and does not spend without consent", async () => {
    const user = userEvent.setup();
    const page = memory();
    const client = vault({}, [page]);
    const read = vi.fn(async () => {
      throw new Error("The Claude budget for this desktop is spent. Recall did not send this photo. Your note was not changed.");
    });
    const librarian: Librarian = {
      mode: "claude",
      notice: "Claude (claude-test) can read this one photo after you agree. It costs money.",
      read,
    };
    render(<MemorySurface vault={client} librarian={librarian} />);
    await user.click(await screen.findByRole("button", { name: "Open original: north-lot" }));
    const readButton = screen.getByRole("button", { name: "Read this photo with Claude" }) as HTMLButtonElement;
    expect(readButton.disabled).toBe(true);
    expect(read).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: /Send this one photo to Claude/ }));
    await user.click(readButton);
    expect((await screen.findByRole("alert")).textContent).toMatch(/budget/);
    expect(read).toHaveBeenCalledTimes(1);
    expect(client.correct).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.type(screen.getByRole("searchbox", { name: "Ask Recall" }), "laydown");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByText(/Gate code 48\?/)).toBeTruthy();
    expect(client.list).toHaveBeenCalledWith("session-token", "laydown");
  });

  it("refuses a mismatched original hash", async () => {
    const user = userEvent.setup();
    const client = vault({
      source: vi.fn(async () => ({ bytes: [1], mime_type: "image/png", sha256: "cd".repeat(32) })),
    }, [memory()]);
    render(<MemorySurface vault={client} />);
    await user.click(await screen.findByRole("button", { name: "Open original: north-lot" }));
    expect((await screen.findByTestId("integrity")).textContent).toMatch(/does not match/);
  });
});

it("saves messy text without provider consent and retrieves original source quotes through native Ask", async () => {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  const text = "Brad says maybe 5–10 MW? Utility late. Call Sarah. Crossed out: 8 MW confirmed.";
  const bytes = new TextEncoder().encode(text);
  const sha = Array.from(new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const saved = memory({ note: text, source_name: "", source_sha256: "", note_path: "meeting.md" });
  const captureNote = vi.fn(async () => saved);
  const parse = vi.fn(); const organize = vi.fn(); const publish = vi.fn();
  const ask = vi.fn(async () => ({ question: "utility delay", message: "Source-backed matches; retrieved quotes.", hits: [{ memory_id: saved.id, revision: 1, note_basename: "meeting.md", current_excerpt: text, original_excerpt: text, source_sha256: sha, mime_type: "text/plain" }] }));
  render(<MemorySurface vault={vault({ captureNote, parse, organize, publish, ask, source: vi.fn(async () => ({ bytes: Array.from(bytes), sha256: sha, mime_type: "text/plain" })) })} />);
  const user = userEvent.setup(); await user.click(await screen.findByRole("button", { name: "Capture" }));
  await user.type(screen.getByLabelText("Optional note"), text); await user.click(screen.getByRole("button", { name: "Save note" }));
  expect(await screen.findByText("Saved locally. Agree before sending this source to Jev and Claude.")).toBeTruthy();
  expect(captureNote).toHaveBeenCalledWith("session-token", expect.any(String), text); expect(parse).not.toHaveBeenCalled();
  expect(screen.getAllByText(text).length).toBeGreaterThan(0); expect(screen.getByTestId("integrity").textContent).toContain("Hash matches");
  expect(screen.queryByRole("img")).toBeNull();
  await user.type(screen.getByRole("searchbox"), "What happened with that utility delay?"); await user.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByRole("heading", { name: "Source-backed matches" })).toBeTruthy();
  expect(ask).toHaveBeenCalledWith("session-token", "What happened with that utility delay?");
  expect(screen.getByRole("button", { name: "Inspect original evidence" })).toBeTruthy(); expect(screen.getByText(`SHA-256: ${sha}`)).toBeTruthy();
});

it("finishing organization of A never replaces B's correction editor after navigation", async () => {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  const a = memory({ source_name: "A.png", note: "A source" });
  const b = memory({ id: "22222222-2222-4222-8222-222222222222", source_name: "B.png", note: "B human draft" });
  let finish!: (value: unknown) => void;
  const organize = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  const v = vault({ parse: vi.fn(async (_scope, id, revision, operation) => ({ memory_id: id, expected_revision: revision, operation_id: operation, source_sha256: a.source_sha256, state: "parsed", message: "Fixture" })), organize, publish: vi.fn(async () => ({ ...a, revision: 2, note: "Published A document" })) }, [a, b]);
  const user = userEvent.setup(); render(<MemorySurface vault={v} />);
  await user.click(await screen.findByRole("button", { name: "Open original: A" }));
  await user.click(screen.getByLabelText(/Send this source to Jev and Claude/));
  await user.click(screen.getByRole("button", { name: "Organize this memory" }));
  await screen.findByText("Claude is organizing source-linked memory…");
  await user.click(screen.getByRole("button", { name: "Timeline" }));
  await user.click(await screen.findByRole("button", { name: /Aug 21, 2026 · B/ }));
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("B human draft");
  await act(async () => { finish({}); });
  await screen.findByText("Organized in Obsidian. Uncertainty and original evidence preserved.");
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("B human draft");
});

it("older Ask responses cannot replace a newer source-backed result", async () => {
  let first!: (value: { question: string; message: string; hits: [] }) => void;
  const ask = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { first = resolve; })).mockResolvedValueOnce({ question: "second", message: "Newest result", hits: [] });
  render(<MemorySurface vault={vault({ ask }, [memory()])} />); const user = userEvent.setup();
  const input = await screen.findByRole("searchbox"); await user.type(input, "first");
  fireEvent.submit(screen.getByRole("search"));
  await user.clear(input); await user.type(input, "second"); fireEvent.submit(screen.getByRole("search"));
  await screen.findByText("Newest result");
  await act(async () => { first({ question: "first", message: "Old result", hits: [] }); });
  expect(screen.getByText("Newest result")).toBeTruthy(); expect(screen.queryByText("Old result")).toBeNull();
});

it("preserves a newer unsaved draft when organization finishes on the same memory", async () => {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  const a = memory({ source_name: "Draft.png", note: "Original draft" });
  let finish!: (value: unknown) => void;
  const organize = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  render(<MemorySurface vault={vault({ parse: vi.fn(async (_scope, id, revision, operation) => ({ memory_id: id, expected_revision: revision, operation_id: operation, source_sha256: a.source_sha256, state: "parsed", message: "Fixture" })), organize, publish: vi.fn(async () => ({ ...a, revision: 2, note: "Published machine document" })) }, [a])} />);
  const user = userEvent.setup(); await user.click(await screen.findByRole("button", { name: "Open original: Draft" }));
  await user.click(screen.getByLabelText(/Send this source to Jev and Claude/)); await user.click(screen.getByRole("button", { name: "Organize this memory" }));
  await screen.findByText("Claude is organizing source-linked memory…");
  await user.clear(screen.getByLabelText("Your correction")); await user.type(screen.getByLabelText("Your correction"), "Newer unsaved human draft");
  await act(async () => { finish({}); }); await screen.findByText(/Your newer unsaved correction draft is preserved/);
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Newer unsaved human draft");
});

it("shows saved unresolved people and source agenda in the existing panels", async () => {
  const user = userEvent.setup();
  const id = "11111111-1111-4111-8111-111111111111";
  const saved = memory({ note: `---\nrecall_id: "${id}"\n---\n## Unresolved entity mentions\n\n- “Sarah” — person candidate; identity unresolved\n## Follow-ups (not confirmed commitments)\n\n- [ ] “Call Sarah” — source bytes 20–30\n## Open questions and uncertainty\n\n-  “Need generators by Dec?” — source bytes 31–55\n` });
  render(<MemorySurface vault={vault({}, [saved])} />);
  await screen.findByText(/Last updated/);
  await user.click(screen.getByRole("button", { name: "People" }));
  expect(screen.getAllByRole("button", { name: "Sarah" })[0]).toBeTruthy();
  expect(screen.getAllByText(/person candidate; identity unresolved/)[0]).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Timeline" }));
  expect(screen.getByRole("heading", { name: "Agenda" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Call Sarah" })).toBeTruthy();
  expect(screen.getByText(/Unscheduled source follow-up/)).toBeTruthy();
});

it("keeps the board in the center grid slot with related context alone", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const saved = memory({ note: `---\nrecall_id: "${id}"\n---\n## Related memories\n\n- [[Recall/Memories/target|Related source-backed memory]] (possible relationship; review)\n` });
  const { container } = render(<MemorySurface vault={vault({}, [saved, memory({ id: "22222222-2222-4222-8222-222222222222", note_path: "target.md" })])} />);
  await screen.findByRole("region", { name: "Related" });
  const columns = container.querySelector(".ms-columns")!;
  expect(columns.children).toHaveLength(3);
  expect(columns.children[0]?.classList.contains("ms-side")).toBe(true);
  expect(columns.children[1]?.classList.contains("ms-project")).toBe(true);
  expect(columns.children[2]?.classList.contains("ms-side")).toBe(true);
});

it("opens a source-focused project board and keeps unrelated people out", async () => {
  const user = userEvent.setup();
  const first = memory({ captured_at: "2026-05-12T15:00:00Z", note: `---\nrecall_id: "11111111-1111-4111-8111-111111111111"\ntitle: "First meeting"\n---\n## Unresolved entity mentions\n\n- “Alpha” — project candidate; identity unresolved\n- “Sarah” — person candidate; identity unresolved\n` });
  const second = memory({ id: "22222222-2222-4222-8222-222222222222", note: `---\nrecall_id: "22222222-2222-4222-8222-222222222222"\n---\n## Unresolved entity mentions\n\n- “Beta” — project candidate; identity unresolved\n- “Brad” — person candidate; identity unresolved\n` });
  render(<MemorySurface vault={vault({}, [first, second])} />);
  await screen.findByText(/Last updated/);
  await user.click(screen.getByRole("button", { name: "Projects" }));
  await user.click(screen.getByRole("button", { name: "Alpha" }));
  expect(screen.getByText(/Context from this source only/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Brad" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sarah" })).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: "Timeline" }));
  expect(screen.queryByText(/No notes fall/)).toBeNull();
  expect(screen.getAllByRole("button", { name: /First meeting/ })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "All project sources" }));
  expect(screen.getByRole("button", { name: "Beta" })).toBeTruthy();
});
