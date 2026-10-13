// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LocalVault, SourceAnswer, VaultMemory, VaultStatus } from "../platform/local-vault";
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

it("requires separate source consent and unchecked cost review for the retained failed organization", async () => {
  const initial = memory({ source_name: "Draft.png", note: "Utility late." });
  const parser = "22222222-2222-4222-8222-222222222222", prior = "33333333-3333-4333-8333-333333333333";
  localStorage.setItem(`recall.meeting.v1:${chosen.vault_identity}:${initial.id}`, JSON.stringify({ parser, organizer: prior, publisher: "44444444-4444-4444-8444-444444444444", revision: 1, published: false }));
  const client = vault({
    parse: vi.fn(async (_scope,id,revision,operation) => ({ memory_id:id,expected_revision:revision,operation_id:operation,source_sha256:initial.source_sha256,state:"parsed",message:"Synthetic saved parse" })),
    organize: vi.fn(), reviewedOrganize: vi.fn(async () => ({})), reviewOrganization: vi.fn(async (_scope,_parser,prior) => ({prior_operation_id:prior,reuse_operation:false})),
    publish: vi.fn(async () => ({ ...initial, revision:2,note:`---\nrecall_id: "${initial.id}"\n---\n\nUtility late.` })),
  }, [initial]);
  const user = userEvent.setup(); render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name:"Open original: Draft" }));
  const review = screen.getByRole("button", { name:"Review and retry organization" }) as HTMLButtonElement;
  const acknowledgement = screen.getByLabelText(/I reviewed the failed attempt/) as HTMLInputElement;
  expect(acknowledgement.checked).toBe(false); expect(review.disabled).toBe(true);
  await user.click(acknowledgement); expect(review.disabled).toBe(true);
  await user.click(screen.getByLabelText(/Send this source to Jev and Claude/)); expect(review.disabled).toBe(false);
  await user.click(review); await screen.findByText("Organized in Obsidian. Uncertainty and original evidence preserved.");
  expect(client.organize).not.toHaveBeenCalled();
  expect(client.reviewedOrganize).toHaveBeenCalledWith("session-token",parser,prior,expect.any(String),true,true);
  expect(screen.queryByRole("button", { name:"Review and retry organization" })).toBeNull();
});

describe("Memory Surface", () => {
  it("shows an honest empty surface in a browser with no vault", () => {
    render(<MemorySurface vault={preview} />);
    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
    expect(screen.getByText("No project sources yet.")).toBeTruthy();
    expect(screen.queryByText("Brooks Campus")).toBeNull();
  });

  it("keeps original evidence separate from the decorative workspace asset", () => {
    const cssPath = [resolve("src/surface/memory-surface.css"), resolve("apps/desktop/src/surface/memory-surface.css")].find((path) => existsSync(path));
    expect(cssPath).toBeTruthy();
    const css = readFileSync(cssPath ?? "", "utf8");
    expect(css).not.toMatch(/Recall\/Sources|source_sha256/i);
    expect(css).not.toMatch(/memory-surface-reference|\.jpg|\.png|\.webp/i);
  });

  it("requires a native vault before retrieving evidence", async () => {
    const user = userEvent.setup(); render(<MemorySurface vault={preview} />);
    await user.type(screen.getByRole("searchbox"), "Brooks Campus");
    await user.click(screen.getByRole("button", { name: "Submit question" }));
    expect(screen.getByRole("alert").textContent).toMatch(/choose your vault/);
    expect(screen.queryByText(/Potential 300MW/)).toBeNull();
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
    expect(screen.queryByRole("region", { name: /^Related/ })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Capture calendar" })).toBeTruthy();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    await user.type(screen.getByRole("searchbox", { name: "Ask Recall" }), "laydown");
    await user.click(screen.getByRole("button", { name: "Submit question" }));
    expect(screen.getByText(/Markdown notes in your vault/)).toBeTruthy();
    expect(screen.getAllByText(/Gate code 48\?/).length).toBeGreaterThan(0);
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
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();
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
    expect(await screen.findByText(/original source is unchanged/)).toBeTruthy();
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
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Use default vault" }));
    expect(client.openDefault).toHaveBeenCalledWith();
    await user.click(screen.getByRole("button", { name: "Settings" }));
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
    await user.click(screen.getByRole("button", { name: "Submit question" }));
    expect(screen.getAllByText(/Gate code 48\?/).length).toBeGreaterThan(0);
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
  await user.type(screen.getByRole("searchbox"), "What happened with that utility delay?"); await user.click(screen.getByRole("button", { name: "Submit question" }));
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
  await user.click(screen.getByRole("button", { name: "Calendar" }));
  await user.click(await screen.findByRole("button", { name: "Open original: B" }));
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("B human draft");
  await user.click(screen.getByRole("button", { name: "Home" }));
  expect(screen.getByText("Claude is organizing source-linked memory…")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Calendar" }));
  await user.click(await screen.findByRole("button", { name: "Open original: B" }));
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

it("keeps source follow-ups unscheduled and inspectable", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const saved = memory({ note: `---\nrecall_id: "${id}"\n---\n## Follow-ups (not confirmed commitments)\n\n- [ ] “Call Sarah” — source bytes 20–30\n` });
  render(<MemorySurface vault={vault({}, [saved])} />);
  expect(await screen.findByRole("button", { name: /Call Sarah/ })).toBeTruthy();
  expect(screen.getByText(/Unscheduled · inspect source/)).toBeTruthy();
});

it("filters project sources and restores the project selection after inspection", async () => {
  const user = userEvent.setup();
  const first = memory({ note: `---\nrecall_id: "11111111-1111-4111-8111-111111111111"\ntitle: "First meeting"\n---\n## Unresolved entity mentions\n\n- “Alpha” — project candidate; identity unresolved\n` });
  const second = memory({ id: "22222222-2222-4222-8222-222222222222", source_name: "second.png", note: `---\nrecall_id: "22222222-2222-4222-8222-222222222222"\n---\n## Unresolved entity mentions\n\n- “Beta” — project candidate; identity unresolved\n` });
  render(<MemorySurface vault={vault({}, [first, second])} />);
  await user.click(await screen.findByRole("button", { name: /^Alpha/ }));
  expect(screen.queryByRole("button", { name: "Open original: second" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Open original: First meeting" }));
  await screen.findByLabelText("Your correction");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: /^Alpha/ }).getAttribute("aria-pressed")).toBe("true");
  await user.click(screen.getByRole("button", { name: "All project sources" }));
  expect(screen.getByRole("button", { name: "Open original: second" })).toBeTruthy();
});

it("edits organized note words while preserving native properties in the save payload", async () => {
  const user = userEvent.setup();
  const header = `---\nrecall_id: "11111111-1111-4111-8111-111111111111"\ntitle: "Utility meeting"\nsource_sha256: "original-source-hash"\n---\n\n`;
  const saved = memory({ revision: 2, note: header + "Utility late." });
  const client = vault({ correct: vi.fn(async (_vault, _id, _rev, _op, note) => ({ ...saved, revision: 3, note })) }, [saved]);
  render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name: "Open original: Utility meeting" }));
  const editor = await screen.findByRole("textbox", { name: "Your correction" });
  expect((editor as HTMLTextAreaElement).value).toBe("Utility late.");
  await user.clear(editor); await user.type(editor, "Utility is now on time.");
  await user.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByText(/Correction saved in the vault/);
  expect(client.correct).toHaveBeenCalledWith("session-token", saved.id, 2, expect.any(String), header + "Utility is now on time.");
  expect((editor as HTMLTextAreaElement).value).toBe("Utility is now on time.");
  await user.click(screen.getByRole("button", { name: "Home" }));
  expect(screen.queryByText(/Correction saved in the vault/)).toBeNull();
});

it("replaces failed organization progress with the error rather than a stale checking banner", async () => {
  const initial = memory({ source_name: "Draft.txt", note: "Utility late." });
  const client = vault({
    source: vi.fn(async () => ({ bytes: Array.from(new TextEncoder().encode(initial.note)), mime_type: "text/plain", sha256: initial.source_sha256 })),
    parse: vi.fn(async (_scope, id, revision, operation) => ({ memory_id: id, expected_revision: revision, operation_id: operation, source_sha256: initial.source_sha256, state: "parsed", message: "Synthetic parser" })),
    organize: vi.fn(async () => { throw new Error("Synthetic provider failure"); }),
    publish: vi.fn(),
  }, [initial]);
  const user = userEvent.setup(); render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name: "Open original: Draft" }));
  await user.click(screen.getByLabelText(/Send this source to Jev and Claude/));
  await user.click(screen.getByRole("button", { name: "Organize this memory" }));
  await screen.findByRole("alert");
  expect(screen.queryByText(/Claude organization stopped/)).toBeNull();
  expect(screen.queryByText(/Claude is organizing/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Home" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(client.publish).not.toHaveBeenCalled();
});

it("organization completion fills body-only editing without duplicating native properties on save", async () => {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  const initial = memory({ source_name: "Draft.png", note: "Original draft" });
  const header = `---\nrecall_id: "${initial.id}"\ntitle: "Utility meeting"\n---\n\n`;
  const published = { ...initial, revision: 2, note: header + "Utility late." };
  let finish!: (value: unknown) => void;
  const client = vault({
    parse: vi.fn(async (_scope, id, revision, operation) => ({ memory_id: id, expected_revision: revision, operation_id: operation, source_sha256: initial.source_sha256, state: "parsed", message: "Synthetic fixture" })),
    organize: vi.fn(() => new Promise(resolve => { finish = resolve; })),
    publish: vi.fn(async () => published),
    correct: vi.fn(async (_scope, _id, _rev, _op, note) => ({ ...published, revision: 3, note })),
  }, [initial]);
  const user = userEvent.setup(); render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name: "Open original: Draft" }));
  await user.click(screen.getByLabelText(/Send this source to Jev and Claude/));
  await user.click(screen.getByRole("button", { name: "Organize this memory" }));
  await screen.findByText("Claude is organizing source-linked memory…");
  await act(async () => { finish({}); });
  await screen.findByText("Organized in Obsidian. Uncertainty and original evidence preserved.");
  const editor = screen.getByRole("textbox", { name: "Your correction" }) as HTMLTextAreaElement;
  expect(editor.value).toBe("Utility late.");
  await user.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByText(/Correction saved in the vault/);
  expect(client.correct).toHaveBeenCalledWith("session-token", initial.id, 2, expect.any(String), published.note);
});

it.each(["Follow-ups", "Corrections"])("discards a late Ask result after navigating to %s", async label => {
  let finish!: (value: SourceAnswer) => void;
  const ask = vi.fn(() => new Promise<SourceAnswer>(resolve => { finish = resolve; }));
  render(<MemorySurface vault={vault({ ask }, [memory()])} />);
  const user = userEvent.setup();
  await user.type(await screen.findByRole("searchbox"), "utility");
  fireEvent.submit(screen.getByRole("search"));
  await user.click(screen.getByRole("button", { name: label }));
  await act(async () => finish({ question: "utility", message: "Stale source result", hits: [] }));
  expect(screen.queryByText("Stale source result")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Source-backed matches" })).toBeNull();
});

it("keeps an empty native vault empty even with the canonical preview parameter", async () => {
  history.replaceState(null, "", "/?design=canonical");
  try {
    render(<MemorySurface vault={vault()} />);
    await screen.findByRole("heading", { name: "Projects" });
    expect(screen.queryByText("Permian Power Expansion")).toBeNull();
    expect(screen.queryByText("Blake Combs")).toBeNull();
    expect(document.querySelector(".ms")?.getAttribute("data-mode")).toBe("vault");
  } finally { history.replaceState(null, "", "/"); }
});

it("offers the approved navigation and an honest empty project board", async () => {
  render(<MemorySurface vault={vault()} />);
  await screen.findByRole("heading", { name: "Projects" });
  for (const name of ["Home", "Capture", "Ask", "Projects", "Calendar", "Follow-ups", "Recent", "Corrections", "Settings", "Help"]) {
    expect(screen.getByRole("button", { name })).toBeTruthy();
  }
  expect(screen.getByText("No project sources yet.")).toBeTruthy();
  expect(screen.queryByText("Permian Power Expansion")).toBeNull();
});

it("reveals memories beyond the home preview from Recent", async () => {
  const rows = Array.from({ length: 7 }, (_, index) => memory({ id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`, source_name: `source-${index}.png` }));
  const user = userEvent.setup(); render(<MemorySurface vault={vault({}, rows)} />);
  await screen.findByRole("button", { name: "Open original: source-0" });
  expect(screen.queryByRole("button", { name: "Open original: source-6" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Recent" }));
  expect(screen.getByRole("button", { name: "Open original: source-6" })).toBeTruthy();
});

it("drops text into capture without saving or enabling provider consent", async () => {
  const client = vault({ captureNote: vi.fn() });
  render(<MemorySurface vault={client} />);
  await screen.findByRole("heading", { name: "Projects" });
  fireEvent.drop(document.querySelector(".approved-capture")!, { dataTransfer: { getData: () => "Original dropped note?" } });
  expect((screen.getByLabelText("Optional note") as HTMLTextAreaElement).value).toBe("Original dropped note?");
  expect((screen.getByLabelText(/Send this saved source/) as HTMLInputElement).checked).toBe(false);
  expect(client.captureNote).not.toHaveBeenCalled();
});

it("the quick photo action cannot reuse consent from a previous memory", async () => {
  const page = memory(); const parse = vi.fn();
  const client = vault({ parse, capture: vi.fn(async () => memory({ id: "22222222-2222-4222-8222-222222222222" })) }, [page]);
  const user = userEvent.setup(); render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name: "Open original: north-lot" }));
  await user.click(screen.getByLabelText(/Send this source to Jev and Claude/));
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(screen.getByRole("button", { name: "Add Photo" }));
  await screen.findByText(/Saved in your vault. The original photo/);
  expect(parse).not.toHaveBeenCalled();
});

it("retries an unavailable original without discarding an unsaved correction", async () => {
  const source = vi.fn().mockRejectedValueOnce(new Error("Source temporarily unavailable")).mockResolvedValue({ bytes: [137,80,78,71], mime_type:"image/png", sha256:"ab".repeat(32) });
  const user = userEvent.setup(); render(<MemorySurface vault={vault({ source }, [memory()])} />);
  await user.click(await screen.findByRole("button", { name:"Open original: north-lot" }));
  await screen.findByRole("alert");
  await user.clear(screen.getByLabelText("Your correction"));
  await user.type(screen.getByLabelText("Your correction"), "Unsaved human wording");
  await user.click(screen.getByRole("button", { name:"Retry original" }));
  await screen.findByTestId("integrity");
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Unsaved human wording");
});

it("keeps a missing Markdown note's original accessible for restoration", async () => {
  const user = userEvent.setup(); const missing = memory({ state: "missing" });
  render(<MemorySurface vault={vault({}, [missing])} />);
  await user.click(await screen.findByRole("button", { name:"Open original: north-lot" }));
  await screen.findByRole("button", { name:"Restore missing note" });
  expect(screen.getByText(/Markdown note missing. The original is still in the vault/)).toBeTruthy();
});

it("shows conflicting notes honestly and keeps their unsafe inspection disabled", async () => {
  render(<MemorySurface vault={vault({}, [memory({ state:"conflict", conflict:"Local note needs review" })])} />);
  expect(await screen.findByRole("heading", { name:"Notes needing attention" })).toBeTruthy();
  expect((screen.getByRole("button", { name:"Open original: north-lot" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name:"Reload: north-lot.png" })).toBeTruthy();
});
