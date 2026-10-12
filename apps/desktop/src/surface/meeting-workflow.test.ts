// @vitest-environment jsdom
// Synthetic native-command fixtures prove UI orchestration, not provider execution.
import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { NativeLocalVault, type VaultMemory } from "../platform/local-vault";
import { processMeeting } from "./meeting-workflow";
beforeAll(() => Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true }));
afterEach(() => localStorage.clear());
const selected = { vault_id: "selected-native-token", vault_identity: "11111111-1111-4111-8111-111111111111" };
const memory: VaultMemory = { id: "22222222-2222-4222-8222-222222222222", revision: 1, state: "active", conflict: null, note: "Utility late.", note_path: "memory.md", source_name: "", source_sha256: "", captured_at: "", updated_at: "" };
function fixture() {
  const vault = new NativeLocalVault();
  vault.parse = vi.fn(async (_scope, id, revision, operation) => ({ memory_id: id, expected_revision: revision, operation_id: operation, source_sha256: "a".repeat(64), state: "parsed", message: "Parsed fixture" }));
  vault.organize = vi.fn(async () => ({}));
  vault.publish = vi.fn(async () => ({ ...memory, revision: 2, note: "---\nrecall_id: fixture\n" }));
  return vault;
}
it("consent is checked before even creating or invoking provider operations", async () => {
  const vault = fixture(); const state = vi.fn();
  expect(await processMeeting(vault, selected, memory, false, state)).toBeNull();
  expect(vault.parse).not.toHaveBeenCalled(); expect(vault.organize).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0);
});
it("uses the same durable stage IDs after an interrupted Claude operation", async () => {
  const vault = fixture(); vi.mocked(vault.organize).mockRejectedValueOnce(new Error("Interrupted fixture"));
  await expect(processMeeting(vault, selected, memory, true, vi.fn())).rejects.toThrow("Interrupted");
  await processMeeting(vault, selected, memory, true, vi.fn());
  expect(vi.mocked(vault.parse).mock.calls[0]).toEqual(vi.mocked(vault.parse).mock.calls[1]);
  expect(vi.mocked(vault.organize).mock.calls[0]).toEqual(vi.mocked(vault.organize).mock.calls[1]);
  expect(vault.publish).toHaveBeenCalledTimes(1);
});
it("unavailable parsing leaves saved evidence pending without organization or publication", async () => {
  const vault = fixture(); vi.mocked(vault.parse).mockImplementation(async (_scope, id, revision, operation) => ({ memory_id: id, expected_revision: revision, operation_id: operation, source_sha256: "a".repeat(64), state: "pending", message: "Native configuration missing" }));
  const state = vi.fn(); expect(await processMeeting(vault, selected, memory, true, state)).toBeNull();
  expect(state).toHaveBeenLastCalledWith("Native configuration missing"); expect(vault.organize).not.toHaveBeenCalled(); expect(vault.publish).not.toHaveBeenCalled();
});
it("recovers native publication receipt after renderer interruption without another provider call", async () => {
  const vault = fixture(); vi.mocked(vault.publish).mockRejectedValueOnce(new Error("Renderer lost response"));
  await expect(processMeeting(vault, selected, memory, true, vi.fn())).rejects.toThrow("lost response");
  const changed = { ...memory, revision: 3, note: "User corrected the organized memory." };
  vi.mocked(vault.publish).mockResolvedValueOnce(changed);
  expect(await processMeeting(vault, selected, changed, true, vi.fn())).toEqual(changed);
  expect(vault.parse).toHaveBeenCalledTimes(1); expect(vault.organize).toHaveBeenCalledTimes(1);
});
it("rejects malformed local state and cross-memory parser responses", async () => {
  const vault = fixture(); localStorage.setItem(`recall.meeting.v1:${selected.vault_identity}:${memory.id}`, "{}");
  await expect(processMeeting(vault, selected, memory, true, vi.fn())).rejects.toThrow("identity"); expect(vault.parse).not.toHaveBeenCalled();
  localStorage.clear(); vi.mocked(vault.parse).mockImplementation(async (_scope, _id, revision, operation) => ({ memory_id: "other", expected_revision: revision, operation_id: operation, source_sha256: "a".repeat(64), state: "parsed", message: "Wrong source" }));
  await expect(processMeeting(vault, selected, memory, true, vi.fn())).rejects.toThrow("match"); expect(vault.organize).not.toHaveBeenCalled();
});
