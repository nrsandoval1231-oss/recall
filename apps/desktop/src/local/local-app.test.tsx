// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopEntry } from "../entry";
import type { LocalVault, VaultMemory, VaultStatus } from "../platform/local-vault";

const selected: VaultStatus = { root: "/synthetic/vault", vault_id: "session-a", vault_identity: "manifest-a" };
const memory: VaultMemory = { id: "m1", revision: 1, note: "Synthetic garden note", source_name: "synthetic.png", source_sha256: "hash", captured_at: "2026-10-08T12:00:00Z", updated_at: "2026-10-08T12:00:00Z", conflict: null };
function vault(over: Partial<LocalVault> = {}): LocalVault {
  return { available: true, status: vi.fn(async () => selected), select: vi.fn(async () => selected), capture: vi.fn(async () => memory), list: vi.fn(async () => [memory]), correct: vi.fn(async (_s, _id, _r, _op, note) => ({ ...memory, note, revision: 2 })), source: vi.fn(async () => ({ bytes: [137,80,78,71], mime_type: "image/png", sha256: "hash" })), history: vi.fn(async () => [{ revision: 1, note: memory.note, recorded_at: memory.captured_at, origin: "human:recall" }]), ...over };
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
    history: () => new Promise(resolve => { finish = () => resolve([{ revision: 1, note: "Late historical note", recorded_at: memory.captured_at, origin: "human:recall" }]); }),
  }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: kind === "original" ? "View original" : "History" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  await act(async () => finish());
  expect(await screen.findByRole("button", { name: "Correct note" })).toBeTruthy();
  expect(screen.queryByText("Late historical note")).toBeNull(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});
