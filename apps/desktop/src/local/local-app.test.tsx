// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopEntry } from "../entry";
import type { LocalVault, VaultMemory, VaultStatus } from "../platform/local-vault";

const selected: VaultStatus = { root: "/synthetic/vault", vault_id: "session-a", vault_identity: "manifest-a" };
const memory: VaultMemory = { id: "m1", revision: 1, note: "Synthetic garden note", source_name: "synthetic.png", source_sha256: "hash", captured_at: "2026-10-08T12:00:00Z", updated_at: "2026-10-08T12:00:00Z", conflict: null, state: "active", note_path: "renamed-garden.md" };
function vault(over: Partial<LocalVault> = {}): LocalVault {
  return { available: true, status: vi.fn(async () => selected), select: vi.fn(async () => selected), capture: vi.fn(async () => memory), list: vi.fn(async () => [memory]), correct: vi.fn(async (_s, _id, _r, _op, note) => ({ ...memory, note, revision: 2 })), source: vi.fn(async () => ({ bytes: [137,80,78,71], mime_type: "image/png", sha256: "hash" })), history: vi.fn(async () => [{ revision: 1, note: memory.note, recorded_at: memory.captured_at, origin: "human:recall" as const, kind: "capture" as const }]), rebuild: vi.fn(async () => [memory]), restoreNote: vi.fn(async () => ({ ...memory, revision: 2 })), remove: vi.fn(async () => ({ ...memory, state: "deleted" as const, revision: 2 })), ...over };
}
const mount = (v: LocalVault) => render(<DesktopEntry vault={v} search="" />);
beforeEach(() => { localStorage.clear(); URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn(); });
afterEach(cleanup);
it("enters real first-use local setup without cloud configuration or auth", async () => {
  const v = vault({ status: vi.fn(async () => ({ root: null, vault_id: null, vault_identity: null })), list: vi.fn(async () => []) });
  mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Choose vault" }));
  expect(await screen.findByText("Nothing captured yet")).toBeTruthy();
  expect(screen.queryByText(/sign in|isn't configured/i)).toBeNull();
});
it("honestly explains browser limits without loading saved intent", async () => {
  const v = vault({ available: false }); mount(v);
  expect(await screen.findByText(/Open the Recall desktop app/)).toBeTruthy();
  expect(v.status).not.toHaveBeenCalled(); expect(v.list).not.toHaveBeenCalled();
});
it("keeps text when the native photo picker is cancelled", async () => {
  const v = vault({ capture: vi.fn(async () => null) }); mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.type(screen.getByLabelText("Context or note (optional)"), "Retain my draft");
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" }));
  await waitFor(() => expect((screen.getByLabelText("Context or note (optional)") as HTMLTextAreaElement).value).toBe("Retain my draft"));
  expect(screen.queryByText("Pending import")).toBeNull();
});
it("searches human notes, opens original and history, saves a human correction", async () => {
  const v = vault(); mount(v);
  await userEvent.type(await screen.findByLabelText("Search notes and filenames"), "garden");
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "View original" }));
  fireEvent.load(await screen.findByRole("img", { name: "Original photo" }));
  expect(screen.getByText(/Original bytes unchanged/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back to note" }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
  await userEvent.click(screen.getByRole("button", { name: "History" }));
  expect(await screen.findByText(/human:recall/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back to note" }));
  await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "Synthetic amended note");
  await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
  expect(await screen.findByText("Synthetic amended note")).toBeTruthy();
  expect(v.correct).toHaveBeenCalledWith("session-a", "m1", 1, expect.any(String), "Synthetic amended note");
});
it("retains a stale correction, reloads current disk note and requires explicit acknowledgment", async () => {
  const correct = vi.fn().mockRejectedValueOnce(new Error("Revision conflict: changed in Obsidian")).mockResolvedValue({ ...memory, note: "My draft", revision: 3 });
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([{ ...memory, revision: 2, note: "Current Obsidian note" }]);
  mount(vault({ correct, list }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "My draft");
  await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Reload latest note" }));
  expect(await screen.findByText("Current Obsidian note")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("My draft");
  await userEvent.click(screen.getByLabelText("I reviewed the latest note"));
  await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
  expect(await screen.findByText("My draft")).toBeTruthy();
  expect(correct.mock.calls[1]![2]).toBe(2); expect(correct.mock.calls[1]![3]).not.toBe(correct.mock.calls[0]![3]);
});
it("restores frozen pending capture on restart, using the same operation", async () => {
  const capture = vi.fn().mockRejectedValueOnce(new Error("Lost acknowledgment")).mockResolvedValue(memory);
  const v = vault({ capture }); const first = mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.type(screen.getByLabelText("Context or note (optional)"), "Frozen note");
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" }));
  await screen.findByRole("alert"); first.unmount(); mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Retry pending import" }));
  await waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
  expect(capture.mock.calls[1]).toEqual(capture.mock.calls[0]);
});
it("does not restore private capture intent for a replaced manifest at the same root", async () => {
  const v = vault({ capture: vi.fn(async () => { throw new Error("lost"); }) }); const first = mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.type(screen.getByLabelText("Context or note (optional)"), "Private old draft");
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await screen.findByRole("alert"); first.unmount();
  mount(vault({ status: vi.fn(async () => ({ ...selected, vault_identity: "new-manifest" })) }));
  await screen.findByRole("button", { name: "Capture" }); expect(screen.queryByText("Pending import")).toBeNull();
});
it("excludes stale list responses after switching vaults", async () => {
  let resolve!: (m: VaultMemory[]) => void;
  const list = vi.fn().mockImplementationOnce(() => new Promise<VaultMemory[]>(r => { resolve = r; })).mockResolvedValue([]);
  mount(vault({ list, select: vi.fn(async () => ({ root: "/synthetic/b", vault_id: "session-b", vault_identity: "manifest-b" })) }));
  await userEvent.click(await screen.findByRole("button", { name: "Switch vault" }));
  await screen.findByText("Nothing captured yet"); await act(async () => resolve([memory]));
  await waitFor(() => expect(screen.queryByText("Synthetic garden note")).toBeNull());
});
it.each(["missing", "decode"])("never claims usable original after %s failure", async (failure) => {
  mount(vault(failure === "missing" ? { source: vi.fn(async () => { throw new Error("Original missing or changed"); }) } : {}));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ })); await userEvent.click(screen.getByRole("button", { name: "View original" }));
  if (failure === "decode") fireEvent.error(await screen.findByRole("img", { name: "Original photo" }));
  expect(await screen.findByRole("alert")).toBeTruthy(); expect(screen.queryByText(/Original bytes unchanged/)).toBeNull();
});
it("ignores startup status that arrives after an explicit vault selection", async () => {
  let resolve!: (s: VaultStatus) => void;
  mount(vault({ status: () => new Promise(r => { resolve = r; }), select: async () => ({ root: "/synthetic/b", vault_id: "session-b", vault_identity: "manifest-b" }), list: async () => [] }));
  await userEvent.click(screen.getByRole("button", { name: "Choose vault" }));
  await screen.findByText("/synthetic/b"); await act(async () => resolve(selected));
  await waitFor(() => expect(screen.queryByText("/synthetic/vault")).toBeNull());
});
it("removes saved/evidence claims after source validation fails", async () => {
  mount(vault({ source: async () => { throw new Error("Source changed"); } }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "View original" })); await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Back to note" }));
  expect(screen.queryByText("Saved in vault · This device only")).toBeNull();
  expect((screen.getByRole("button", { name: "View original" }) as HTMLButtonElement).disabled).toBe(true);
});
it("keeps an import draft and valid vault after cancelling vault selection", async () => {
  mount(vault({ select: async () => null }));
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.type(screen.getByLabelText("Context or note (optional)"), "Still mine");
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  expect((await screen.findByLabelText("Context or note (optional)") as HTMLTextAreaElement).value).toBe("Still mine");
  expect(screen.getByText("/synthetic/vault")).toBeTruthy();
});
it("ignores late capture errors after switching vaults", async () => {
  let reject!: (e: Error) => void;
  mount(vault({ capture: () => new Promise((_r, j) => { reject = j; }), select: async () => ({ root: "/synthetic/b", vault_id: "session-b", vault_identity: "manifest-b" }), list: async () => [] }));
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  await screen.findByText("/synthetic/b"); await act(async () => reject(new Error("private old vault error")));
  await waitFor(() => expect(screen.queryByText(/private old vault error/)).toBeNull());
});
it("diagnostic records cannot masquerade as saved memory or eligible evidence", async () => {
  mount(vault({ list: async () => [{ ...memory, revision: 0, note: "", source_name: "", conflict: "Missing original" }] }));
  await userEvent.click(await screen.findByRole("button", { name: /Memory needs attention/ }));
  expect(screen.queryByText("Saved in vault · This device only")).toBeNull();
  expect((screen.getByRole("button", { name: "View original" }) as HTMLButtonElement).disabled).toBe(true);
});
it("freezes failed capture text until explicitly abandoned, then uses a new operation", async () => {
  const capture = vi.fn().mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValue(null);
  mount(vault({ capture }));
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.type(screen.getByLabelText("Context or note (optional)"), "First note");
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await screen.findByRole("alert");
  expect((screen.getByLabelText("Context or note (optional)") as HTMLTextAreaElement).readOnly).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Abandon pending intent & edit note" }));
  await userEvent.clear(screen.getByLabelText("Context or note (optional)")); await userEvent.type(screen.getByLabelText("Context or note (optional)"), "Changed note");
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" }));
  expect(capture.mock.calls[1]![1]).not.toBe(capture.mock.calls[0]![1]); expect(capture.mock.calls[1]![2]).toBe("Changed note");
});
it("does not open the photo picker when durable intent storage fails", async () => {
  const v = vault(); mount(v); await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  const store = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Intent storage full"); });
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Intent storage full"); expect(v.capture).not.toHaveBeenCalled(); store.mockRestore();
});
it("requires another explicit reload after a second correction conflict", async () => {
  const correct = vi.fn(async () => { throw new Error("Revision conflict"); });
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([{ ...memory, revision: 2, note: "Newer disk note" }]);
  mount(vault({ list, correct })); await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "Correct note" })); await userEvent.type(screen.getByLabelText("Your correction"), " amended");
  await userEvent.click(screen.getByRole("button", { name: "Save correction" })); await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Reload latest note" }));
  await userEvent.click(await screen.findByLabelText("I reviewed the latest note")); await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByRole("alert"); expect(screen.queryByLabelText("I reviewed the latest note")).toBeNull();
  expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Synthetic garden note amended");
});
it("does not create an evidence URL from a late source response after leaving focus", async () => {
  let resolve!: (s: {bytes: number[]; mime_type: string; sha256: string}) => void;
  mount(vault({ source: () => new Promise(r => { resolve = r; }) }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ })); await userEvent.click(screen.getByRole("button", { name: "View original" }));
  await userEvent.click(screen.getByRole("button", { name: "Back to note" }));
  await act(async () => resolve({ bytes: [1], mime_type: "image/png", sha256: "hash" })); expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("reports unreadable pending intent and blocks capture without hiding healthy memories", async () => {
  localStorage.setItem(`recall.local.capture:${JSON.stringify([selected.root, selected.vault_identity])}`, "corrupt-json");
  mount(vault()); await screen.findByRole("button", { name: /Synthetic garden note/ });
  expect(await screen.findByRole("alert")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Capture" }));
  expect((screen.getByRole("button", { name: "Choose photo & save" }) as HTMLButtonElement).disabled).toBe(true);
});
it.each([['cancel', false], ['fail', false], ['cancel', true], ['fail', true]] as const)("retains correction draft when vault selection %s (conflict review: %s)", async (outcome, conflict) => {
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([{ ...memory, revision: 2, note: "Latest disk note" }]);
  mount(vault({ list, select: async () => { if (outcome === "fail") throw new Error("Folder unavailable"); return null; }, correct: async () => { throw new Error("Revision conflict"); } }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "Unique unsaved correction");
  if (conflict) {
    await userEvent.click(screen.getByRole("button", { name: "Save correction" })); await screen.findByText("Revision conflict");
    await userEvent.click(screen.getByRole("button", { name: "Reload latest note" })); await screen.findByText("Latest disk note");
  }
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  expect((await screen.findByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Unique unsaved correction");
  if (conflict) { expect(screen.getByText("Latest disk note")).toBeTruthy(); expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true); }
  if (outcome === "fail") expect(screen.getByText("Folder unavailable")).toBeTruthy();
});
it.each(["success", "failure"])("ignores late correction %s after cancelled vault selection and requires reconciliation", async outcome => {
  let finish!: () => void;
  mount(vault({ select: async () => null, correct: () => new Promise((resolve, reject) => { finish = () => outcome === "success" ? resolve({ ...memory, revision: 2, note: "Late committed result" }) : reject(new Error("Late private error")); }) }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ })); await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "Retained pending correction");
  await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  await act(async () => finish());
  expect((await screen.findByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Retained pending correction");
  expect(screen.queryByText("Late committed result")).toBeNull(); expect(screen.queryByText("Late private error")).toBeNull();
  expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Reload latest note" })).toBeTruthy();
});
it("successful switch clears correction draft and source URLs, even when another vault has the same memory ID", async () => {
  const select = vi.fn().mockResolvedValueOnce({ root: "/synthetic/b", vault_id: "session-b", vault_identity: "manifest-b" }).mockResolvedValueOnce({ ...selected, vault_id: "session-c" });
  mount(vault({ select })); await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "View original" })); await screen.findByRole("img", { name: "Original photo" });
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); await screen.findByText("/synthetic/b");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic"); expect(screen.queryByRole("img")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Synthetic garden note/ })); await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "Private B draft");
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); await screen.findByText("/synthetic/vault");
  await userEvent.click(screen.getByRole("button", { name: /Synthetic garden note/ })); await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe(memory.note);
});
it.each(["original", "history"])("ignores late %s after cancelling vault selection", async kind => {
  let finish!: () => void;
  mount(vault({ select: async () => null,
    source: () => new Promise(resolve => { finish = () => resolve({ bytes: [1], mime_type: "image/png", sha256: "hash" }); }),
    history: () => new Promise(resolve => { finish = () => resolve([{ revision: 1, note: "Late historical note", recorded_at: memory.captured_at, origin: "human:recall" as const, kind: "capture" as const }]); }),
  }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: kind === "original" ? "View original" : "History" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  await act(async () => finish());
  expect(await screen.findByRole("button", { name: "Correct note" })).toBeTruthy();
  expect(screen.queryByText("Late historical note")).toBeNull(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});

const missing: VaultMemory = { ...memory, state: "missing", note_path: null, conflict: "Managed Markdown is missing" };
const deleted: VaultMemory = { ...memory, state: "deleted", revision: 2 };
async function openMemory() { await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ })); }
it("displays the resolved renamed Markdown basename", async () => {
  mount(vault()); await openMemory(); expect(screen.getByText("renamed-garden.md")).toBeTruthy();
});
it("missing diagnostic allows explicit restore and removal but blocks evidence and correction", async () => {
  const v = vault({ list: async () => [missing] }); mount(v); await openMemory();
  expect(screen.getByText("Markdown note missing · decision needed")).toBeTruthy();
  expect((screen.getByRole("button", { name: "View original" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Correct note" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Restore missing note" }));
  expect(await screen.findByText("Note restored in vault · This device only")).toBeTruthy();
  expect(v.restoreNote).toHaveBeenCalledWith("session-a", "m1", 1, expect.any(String));
});
it.each(["active", "missing"] as const)("removal of %s requires explicit confirmation and cancellation writes nothing", async state => {
  const v = vault({ list: async () => [state === "missing" ? missing : memory] }); mount(v); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" }));
  expect(screen.getByText(/original photo, Markdown files and history remain/)).toBeTruthy();
  expect(screen.getByText(/no in-app undo/)).toBeTruthy(); expect(v.remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel removal" })); expect(v.remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  expect(await screen.findByText("Removed from Recall · files retained")).toBeTruthy();
  expect(v.remove).toHaveBeenCalledWith("session-a", "m1", 1, expect.any(String), state);
  await userEvent.click(screen.getByRole("button", { name: "Back to memories" }));
  expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull();
});
it("removed history is inspectable with a retained pending diagnostic and never active search evidence", async () => {
  const v = vault({ list: vi.fn(async (_id, _q, include) => include ? [{ ...deleted, conflict: "Pending draft retained" }] : []), history: async () => [{ revision: 2, note: memory.note, recorded_at: memory.updated_at, origin: "human:recall", kind: "remove" }] });
  mount(v); await userEvent.click(await screen.findByRole("button", { name: "Removed items" })); await openMemory();
  expect((screen.getByRole("button", { name: "History" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "View original" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Restore missing note" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "History" })); expect(await screen.findByText(/remove · human:recall/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back to note" })); await userEvent.click(screen.getByRole("button", { name: "Back to memories" }));
  expect(screen.getByRole("heading", { name: "Removed items" })).toBeTruthy(); expect(v.list).toHaveBeenCalledWith("session-a", "", true);
});
it.each([{ ...memory, state: "conflict" as const, conflict: "Duplicate ID" }, { ...missing, revision: 0 }])("ambiguous or invalid committed records disable lifecycle mutations", async m => {
  mount(vault({ list: async () => [m] })); await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note|Memory needs attention/ }));
  expect((screen.getByRole("button", { name: "Remove from Recall" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Restore missing note" })).toBeNull();
});
it("failed rebuild keeps previous rows visibly stale then successful rebuild replaces them", async () => {
  const rebuild = vi.fn().mockRejectedValueOnce(new Error("Malformed journal")).mockResolvedValue([{ ...memory, note: "Rebuilt note" }]);
  mount(vault({ rebuild })); await screen.findByRole("button", { name: /Synthetic garden note/ });
  await userEvent.click(screen.getByRole("button", { name: "Rebuild local search" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Malformed journal");
  expect(screen.getByRole("button", { name: /Synthetic garden note/ })).toBeTruthy(); expect(screen.getByText(/Previously loaded results · not currently verified/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Rebuild local search" }));
  expect(await screen.findByRole("button", { name: /Rebuilt note/ })).toBeTruthy(); expect(screen.queryByText(/Previously loaded results/)).toBeNull();
  expect(rebuild).toHaveBeenCalledWith("session-a", true);
});
it("back preserves keyword query and rebuild uses canonical results without reintroducing removed rows", async () => {
  const v = vault({ rebuild: async () => [memory, deleted, { ...memory, id: "other", note: "Other", note_path: "other.md", source_name: "other.png" }] });
  mount(v); await userEvent.type(await screen.findByLabelText("Search notes and filenames"), "garden"); await userEvent.click(screen.getByRole("button", { name: "Search" })); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: "Back to memories" })); expect((screen.getByLabelText("Search notes and filenames") as HTMLInputElement).value).toBe("garden");
  await userEvent.click(screen.getByRole("button", { name: "Rebuild local search" })); await screen.findByRole("button", { name: /Synthetic garden note/ }); expect(screen.queryByRole("button", { name: /^Other/ })).toBeNull();
});
it("failed removal retries frozen decision; fresh review creates a new revision/state intent", async () => {
  const remove = vi.fn().mockRejectedValueOnce(new Error("Lost receipt")).mockRejectedValueOnce(new Error("Still unavailable")).mockResolvedValue(deleted);
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([missing]);
  mount(vault({ list, remove })); await openMemory(); await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" })); await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await screen.findByText("Lost receipt"); await userEvent.click(screen.getByRole("button", { name: "Retry same removal" })); await screen.findByText("Still unavailable"); expect(remove.mock.calls[1]).toEqual(remove.mock.calls[0]);
  await userEvent.click(screen.getByRole("button", { name: "Reload current state" })); await screen.findByText("Current state · missing · revision 1");
  await userEvent.click(screen.getByRole("button", { name: "Review a new removal decision" })); await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await screen.findByText("Removed from Recall · files retained"); expect(remove.mock.calls[2]![3]).not.toBe(remove.mock.calls[0]![3]); expect(remove.mock.calls[2]![4]).toBe("missing");
});
it.each(["capture", "correct", "restore"])("%s receipt reports current deleted state without active-save claim", async kind => {
  const v = vault({ capture: async () => deleted, correct: async () => deleted, restoreNote: async () => deleted, list: async () => [kind === "restore" ? missing : memory] }); mount(v);
  if (kind === "capture") { await userEvent.click(await screen.findByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); }
  else { await openMemory(); await userEvent.click(screen.getByRole("button", { name: kind === "correct" ? "Correct note" : "Restore missing note" })); if (kind === "correct") await userEvent.click(screen.getByRole("button", { name: "Save correction" })); }
  expect(await screen.findByText(/already removed · files retained/)).toBeTruthy(); expect(screen.queryByText("Note restored in vault · This device only")).toBeNull();
});
it.each(["cancel", "fail"])("tentative selection %s preserves removal confirmation without submitting", async outcome => {
  const v = vault({ select: async () => { if (outcome === "fail") throw new Error("Selection failed"); return null; } }); mount(v); await openMemory(); await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); expect(await screen.findByRole("button", { name: "Confirm removal" })).toBeTruthy(); expect(v.remove).not.toHaveBeenCalled();
});
it.each(["remove", "restore", "rebuild"])("ignores late %s response after vault switch", async kind => {
  let finish!: () => void; const delayed = () => new Promise<VaultMemory>(resolve => { finish = () => resolve(deleted); });
  const v = vault({ list: vi.fn(async s => s === "session-a" ? [kind === "restore" ? missing : memory] : []), remove: delayed, restoreNote: delayed, rebuild: () => new Promise(resolve => { finish = () => resolve([memory]); }), select: async () => ({ root: "/synthetic/b", vault_id: "session-b", vault_identity: "manifest-b" }) }); mount(v);
  if (kind === "rebuild") await userEvent.click(await screen.findByRole("button", { name: "Rebuild local search" }));
  else { await openMemory(); await userEvent.click(screen.getByRole("button", { name: kind === "remove" ? "Remove from Recall" : "Restore missing note" })); if (kind === "remove") await userEvent.click(screen.getByRole("button", { name: "Confirm removal" })); }
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); await screen.findByText("/synthetic/b"); await act(async () => finish()); expect(screen.queryByText(/already removed|Removed from Recall/)).toBeNull(); expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull();
});
it("failed switch to removed preserves active query and rows; failed return preserves removed mode", async () => {
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValueOnce([memory]).mockRejectedValueOnce(new Error("Removed list unavailable")).mockResolvedValueOnce([deleted]).mockRejectedValueOnce(new Error("Active list unavailable"));
  mount(vault({ list })); await userEvent.type(await screen.findByLabelText("Search notes and filenames"), "garden"); await userEvent.click(screen.getByRole("button", { name: "Search" }));
  await userEvent.click(screen.getByRole("button", { name: "Removed items" })); await screen.findByText("Removed list unavailable"); expect(screen.getByRole("heading", { name: "Matching memories" })).toBeTruthy(); expect((screen.getByLabelText("Search notes and filenames") as HTMLInputElement).value).toBe("garden"); expect(screen.getByRole("button", { name: /Synthetic garden note/ })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Removed items" })); await screen.findByRole("heading", { name: "Removed items" });
  await userEvent.click(screen.getByRole("button", { name: "All memories / refresh" })); await screen.findByText("Active list unavailable"); expect(screen.getByRole("heading", { name: "Removed items" })).toBeTruthy(); expect((screen.getByLabelText("Search notes and filenames") as HTMLInputElement).value).toBe("garden");
});
it("pending removal survives back to memories and retains operation identity", async () => {
  const remove = vi.fn().mockRejectedValueOnce(new Error("Lost acknowledgment")).mockResolvedValue(deleted); mount(vault({ remove })); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" })); await userEvent.click(screen.getByRole("button", { name: "Confirm removal" })); await screen.findByText("Lost acknowledgment");
  await userEvent.click(screen.getByRole("button", { name: "Cancel removal" })); await userEvent.click(screen.getByRole("button", { name: "Back to memories" })); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: "Retry same removal" })); await screen.findByText("Removed from Recall · files retained"); expect(remove.mock.calls[1]).toEqual(remove.mock.calls[0]);
});
it.each(["remove", "restore"])("interrupted %s after cancelled selection retains exact decision for retry", async kind => {
  let finish!: () => void;
  const mutation = vi.fn().mockImplementationOnce(() => new Promise<VaultMemory>(resolve => { finish = () => resolve(deleted); })).mockResolvedValue(deleted);
  mount(vault({ list: async () => [kind === "restore" ? missing : memory], remove: mutation, restoreNote: mutation, select: async () => null })); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: kind === "restore" ? "Restore missing note" : "Remove from Recall" })); if (kind === "remove") await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); await act(async () => finish()); expect(screen.queryByText("Removed from Recall · files retained")).toBeNull();
  await userEvent.click(await screen.findByRole("button", { name: kind === "remove" ? "Retry same removal" : "Retry same restore" })); await screen.findByText(kind === "remove" ? "Removed from Recall · files retained" : "This memory is already removed · files retained"); expect(mutation.mock.calls[1]).toEqual(mutation.mock.calls[0]);
});
it.each(["capture", "correct", "restore"])("%s receipts with current missing/conflict state do not report an active save", async kind => {
  const result = kind === "correct" ? { ...memory, state: "conflict" as const, conflict: "Retained pending conflict" } : missing;
  mount(vault({ list: async () => [kind === "restore" ? missing : memory], capture: async () => result, correct: async () => result, restoreNote: async () => result }));
  if (kind === "capture") { await userEvent.click(await screen.findByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); }
  else { await openMemory(); await userEvent.click(screen.getByRole("button", { name: kind === "restore" ? "Restore missing note" : "Correct note" })); if (kind === "correct") await userEvent.click(screen.getByRole("button", { name: "Save correction" })); }
  await screen.findByText(/Current memory (has a missing Markdown note|needs attention)/); expect(screen.queryByText(/Correction saved|Note restored/)).toBeNull();
});
it("opening stale rows keeps their unverified state visible until a validated mutation", async () => {
  mount(vault({ rebuild: async () => { throw new Error("Rebuild failed"); } })); await screen.findByRole("button", { name: /Synthetic garden note/ }); await userEvent.click(screen.getByRole("button", { name: "Rebuild local search" })); await screen.findByText("Rebuild failed"); await openMemory();
  expect(screen.getByText("Previously loaded memory · current state not verified")).toBeTruthy();
});
it("a failed decision can retain current terminal state after reload and inspect its history", async () => {
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([deleted]);
  mount(vault({ list, remove: async () => { throw new Error("Old operation unavailable"); } })); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" })); await userEvent.click(screen.getByRole("button", { name: "Confirm removal" })); await screen.findByText("Old operation unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Reload current state" })); await screen.findByText("Current state · deleted · revision 2");
  await userEvent.click(screen.getByRole("button", { name: "Keep current state & close decision" })); await userEvent.click(screen.getByRole("button", { name: "History" })); expect(await screen.findByText(/capture · human:recall/)).toBeTruthy();
});
it("out-of-order list responses cannot replace the latest chosen mode", async () => {
  let finish!: (rows: VaultMemory[]) => void;
  const list = vi.fn().mockResolvedValueOnce([memory]).mockImplementationOnce(() => new Promise<VaultMemory[]>(resolve => { finish = resolve; })).mockResolvedValueOnce([memory]);
  mount(vault({ list })); await screen.findByRole("button", { name: /Synthetic garden note/ }); await userEvent.click(screen.getByRole("button", { name: "Removed items" })); await userEvent.click(screen.getByRole("button", { name: "All memories / refresh" })); await screen.findByRole("button", { name: /Synthetic garden note/ }); await act(async () => finish([deleted])); expect(screen.getByRole("heading", { name: "Recent memory" })).toBeTruthy(); expect(screen.queryByRole("heading", { name: "Removed items" })).toBeNull();
});
it("initial read failure does not claim previously loaded results or an empty vault", async () => {
  mount(vault({ list: async () => { throw new Error("Vault unreadable"); } })); await screen.findByText("Vault unreadable"); expect(screen.queryByText(/Previously loaded results/)).toBeNull(); expect(screen.queryByText("Nothing captured yet")).toBeNull();
});
it("a failed later rebuild clears the earlier rebuild success receipt", async () => {
  const rebuild = vi.fn().mockResolvedValueOnce([memory]).mockRejectedValueOnce(new Error("New rebuild failed")); mount(vault({ rebuild })); await screen.findByRole("button", { name: /Synthetic garden note/ }); await userEvent.click(screen.getByRole("button", { name: "Rebuild local search" })); await screen.findByText("Local keyword search rebuilt from validated vault records.");
  await userEvent.click(screen.getByRole("button", { name: "Rebuild local search" })); await screen.findByText("New rebuild failed"); expect(screen.queryByText("Local keyword search rebuilt from validated vault records.")).toBeNull();
});
it("list predating successful removal cannot reintroduce its tombstone", async () => {
  let finishList!: (rows: VaultMemory[]) => void;
  const list = vi.fn().mockResolvedValueOnce([memory]).mockImplementationOnce(() => new Promise<VaultMemory[]>(resolve => { finishList = resolve; }));
  mount(vault({ list, select: async () => null })); await openMemory(); await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" })); await userEvent.click(screen.getByRole("button", { name: "Confirm removal" })); await screen.findByText("Removed from Recall · files retained"); await act(async () => finishList([memory]));
  await userEvent.click(screen.getByRole("button", { name: "Back to memories" })); expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull(); expect(screen.queryByText("Saved in vault · This device only")).toBeNull(); expect(screen.queryByText("Reading your vault…")).toBeNull();
});
it.each([deleted, missing, { ...memory, state: "conflict" as const, conflict: "Duplicate identity" }, { ...memory, state: "conflict" as const, revision: 0, note: "", source_name: "", conflict: "History unavailable" }])("correction reload publishes authoritative $state revision $revision while retaining the draft", async current => {
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([current]); const correct = vi.fn(async () => { throw new Error("Lost correction receipt"); });
  mount(vault({ list, correct })); await openMemory(); await userEvent.click(screen.getByRole("button", { name: "Correct note" })); await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "Retained review draft");
  await userEvent.click(screen.getByRole("button", { name: "Save correction" })); await screen.findByText("Lost correction receipt"); await userEvent.click(screen.getByRole("button", { name: "Reload latest note" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true)); expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Retained review draft"); expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).readOnly).toBe(true); expect(screen.queryByLabelText("I reviewed the latest note")).toBeNull();
  expect(await screen.findByText(current.state === "deleted" ? "Removed from Recall · files retained" : current.state === "missing" ? "Markdown note missing · decision needed" : "Needs attention · evidence unavailable")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back to note" })); expect(screen.queryByText("Saved in vault · This device only")).toBeNull(); expect((screen.getByRole("button", { name: "View original" }) as HTMLButtonElement).disabled).toBe(true); expect((screen.getByRole("button", { name: "Correct note" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Back to memories" })); if (current.state === "deleted") expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull(); else expect(screen.getByRole("button", { name: current.revision === 0 ? /Memory needs attention/ : /Synthetic garden note/ })).toBeTruthy(); expect(screen.queryByText("Saved in vault · This device only")).toBeNull(); expect(correct).toHaveBeenCalledTimes(1);
});
it("eligible correction reload publishes the current note to home without changing the pending draft", async () => {
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([{ ...memory, revision: 2, note: "Current authoritative note" }]);
  mount(vault({ list, correct: async () => { throw new Error("Revision conflict"); } })); await openMemory(); await userEvent.click(screen.getByRole("button", { name: "Correct note" })); await userEvent.type(screen.getByLabelText("Your correction"), " unsaved"); await userEvent.click(screen.getByRole("button", { name: "Save correction" })); await screen.findByText("Revision conflict"); await userEvent.click(screen.getByRole("button", { name: "Reload latest note" })); await screen.findByText("Current authoritative note");
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Synthetic garden note unsaved"); await userEvent.click(screen.getByRole("button", { name: "Back to note" })); await userEvent.click(screen.getByRole("button", { name: "Back to memories" })); expect(screen.getByRole("button", { name: /Current authoritative note/ })).toBeTruthy(); expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull();
});
it.each([false, true])("delayed capture preserves the latest removed view (request still pending: %s)", async pendingView => {
  let finishCapture!: (m: VaultMemory) => void; let finishView!: (rows: VaultMemory[]) => void;
  const list = vi.fn().mockResolvedValueOnce([memory]);
  if (pendingView) list.mockImplementationOnce(() => new Promise<VaultMemory[]>(resolve => { finishView = resolve; })); else list.mockResolvedValueOnce([deleted]);
  list.mockImplementation(async (_session, _query, includeDeleted) => includeDeleted ? [deleted] : [memory]);
  mount(vault({ list, capture: () => new Promise(resolve => { finishCapture = resolve; }) })); await userEvent.click(await screen.findByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await userEvent.click(screen.getByRole("button", { name: "Removed items" }));
  if (!pendingView) await screen.findByRole("heading", { name: "Removed items" }); await act(async () => finishCapture({ ...memory, id: "new-capture" })); await waitFor(() => expect(screen.queryByText("Reading your vault…")).toBeNull());
  expect(screen.getByRole("heading", { name: "Removed items" })).toBeTruthy(); expect(list.mock.calls.at(-1)).toEqual(["session-a", "", true]); expect(screen.getByText("Saved in vault · This device only")).toBeTruthy();
  if (pendingView) { await act(async () => finishView([deleted])); expect(screen.getByRole("heading", { name: "Removed items" })).toBeTruthy(); }
});
it.each([false, true])("delayed capture preserves the latest submitted keyword query (request still pending: %s)", async pendingQuery => {
  let finishCapture!: (m: VaultMemory) => void; let finishQuery!: (rows: VaultMemory[]) => void;
  const matching = { ...memory, id: "workshop", note: "Workshop plan", note_path: "workshop.md" }; const list = vi.fn().mockResolvedValueOnce([memory]);
  if (pendingQuery) list.mockImplementationOnce(() => new Promise<VaultMemory[]>(resolve => { finishQuery = resolve; })); else list.mockResolvedValueOnce([matching]);
  list.mockImplementation(async (_session, q) => q === "workshop" ? [matching] : [memory]);
  mount(vault({ list, capture: () => new Promise(resolve => { finishCapture = resolve; }) })); await userEvent.click(await screen.findByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await userEvent.type(screen.getByLabelText("Search notes and filenames"), "workshop"); await userEvent.click(screen.getByRole("button", { name: "Search" }));
  if (!pendingQuery) await screen.findByRole("button", { name: /Workshop plan/ }); await act(async () => finishCapture({ ...memory, id: "new-capture" })); await waitFor(() => expect(screen.queryByText("Reading your vault…")).toBeNull());
  expect((screen.getByLabelText("Search notes and filenames") as HTMLInputElement).value).toBe("workshop"); expect(screen.getByRole("heading", { name: "Matching memories" })).toBeTruthy(); expect(screen.getByRole("button", { name: /Workshop plan/ })).toBeTruthy(); expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull(); expect(list.mock.calls.at(-1)).toEqual(["session-a", "workshop", false]);
  if (pendingQuery) { await act(async () => finishQuery([matching])); expect(screen.getByRole("heading", { name: "Matching memories" })).toBeTruthy(); }
});
it("delayed capture preserves a newer return from removed items to active memories", async () => {
  let finishCapture!: (m: VaultMemory) => void; const list = vi.fn(async (_session: string, _query: string, includeDeleted?: boolean) => includeDeleted ? [deleted] : [memory]);
  mount(vault({ list, capture: () => new Promise(resolve => { finishCapture = resolve; }) })); await screen.findByRole("button", { name: /Synthetic garden note/ }); await userEvent.click(screen.getByRole("button", { name: "Removed items" })); await screen.findByRole("heading", { name: "Removed items" });
  await userEvent.click(screen.getByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await userEvent.click(screen.getByRole("button", { name: "All memories / refresh" })); await screen.findByRole("heading", { name: "Recent memory" }); await act(async () => finishCapture({ ...memory, id: "new-capture" }));
  await waitFor(() => expect(screen.queryByText("Reading your vault…")).toBeNull()); expect(screen.getByRole("heading", { name: "Recent memory" })).toBeTruthy(); expect(screen.queryByRole("heading", { name: "Removed items" })).toBeNull(); expect(list.mock.calls.at(-1)).toEqual(["session-a", "", false]);
});
it("capture follow-up failure retains the prior view after a newer requested view failed", async () => {
  let finishCapture!: (m: VaultMemory) => void; const list = vi.fn(async (_session: string, _query: string, includeDeleted?: boolean) => { if (includeDeleted) throw new Error("Removed view unavailable"); return [memory]; });
  mount(vault({ list, capture: () => new Promise(resolve => { finishCapture = resolve; }) })); await userEvent.click(await screen.findByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await userEvent.click(screen.getByRole("button", { name: "Removed items" })); await screen.findByText("Removed view unavailable");
  await act(async () => finishCapture({ ...memory, id: "new-capture" })); await waitFor(() => expect(screen.queryByText("Reading your vault…")).toBeNull()); expect(screen.getByText("Removed view unavailable")).toBeTruthy(); expect(screen.getByRole("heading", { name: "Recent memory" })).toBeTruthy(); expect(screen.getByRole("button", { name: /Synthetic garden note/ })).toBeTruthy(); expect(screen.getByText(/Previously loaded results · not currently verified/)).toBeTruthy(); expect(list.mock.calls.at(-1)).toEqual(["session-a", "", true]);
});
