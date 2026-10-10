// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
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
    expect(container.querySelector(".ms-desk, .ms-paper, .ms-polaroid, .ms-mug")).toBeNull();
    expect(screen.queryByText("Important conversations deserve a long memory.")).toBeNull();
    expect(screen.queryByRole("img", { name: /site illustration/i })).toBeNull();
    expect(screen.queryByText("Synthetic site illustration")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recent Memories" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Timeline and recent memories" })).toBeNull();
    expect(screen.queryByText("Email me a sign-in link")).toBeNull();
    expect((screen.getByRole("button", { name: "Voice ask is not available in this build" }) as HTMLButtonElement).disabled).toBe(true);
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
