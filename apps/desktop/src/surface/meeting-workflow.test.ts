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
  vault.reviewOrganization = vi.fn(async (_scope,_parser,prior) => ({prior_operation_id:prior,reuse_operation:false}));
  vault.publish = vi.fn(async () => ({ ...memory, revision: 2, note: "---\nrecall_id: fixture\n" }));
  vault.history = vi.fn(async () => [{ revision: 2, note: "Organized fixture", recorded_at: "", origin: "model:claude" as const, kind: "organize" as const }]);
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
it("a correction after incomplete parsing is not mistaken for interrupted publication", async () => {
  const vault = fixture();
  vi.mocked(vault.parse).mockImplementation(async (_scope, id, revision, operation) => ({ memory_id: id, expected_revision: revision, operation_id: operation, source_sha256: "a".repeat(64), state: "pending", message: "Parser outcome uncertain" }));
  await processMeeting(vault, selected, memory, true, vi.fn());
  const key = `recall.meeting.v1:${selected.vault_identity}:${memory.id}`;
  const before = localStorage.getItem(key);
  vault.history = vi.fn(async () => [{ revision: 2, note: "Human correction", recorded_at: "", origin: "human:recall" as const, kind: "correct" as const }]);
  const state = vi.fn();
  expect(await processMeeting(vault, selected, { ...memory, revision: 2, note: "Human correction" }, true, state)).toBeNull();
  expect(state).toHaveBeenLastCalledWith("Your correction is saved. The earlier processing attempt did not publish; corrected notes require review before reprocessing. No provider request was sent.");
  expect(vault.publish).not.toHaveBeenCalled();
  expect(vault.organize).not.toHaveBeenCalled();
  expect(vault.parse).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(key)).toBe(before);
});
it("unreadable native history cannot authorize publication or a provider resend", async () => {
  const vault = fixture();
  vi.mocked(vault.organize).mockRejectedValueOnce(new Error("Interrupted"));
  await expect(processMeeting(vault, selected, memory, true, vi.fn())).rejects.toThrow("Interrupted");
  const key = `recall.meeting.v1:${selected.vault_identity}:${memory.id}`;
  const before = localStorage.getItem(key);
  vault.history = vi.fn(async () => { throw new Error("History unavailable"); });
  await expect(processMeeting(vault, selected, { ...memory, revision: 2 }, true, vi.fn())).rejects.toThrow("History unavailable");
  expect(vault.publish).not.toHaveBeenCalled();
  expect(vault.parse).toHaveBeenCalledTimes(1);
  expect(vault.organize).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(key)).toBe(before);
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
it("reviewed recovery requires acknowledgement before changing durable IDs or invoking commands", async () => {
  const vault = fixture(); vi.mocked(vault.organize).mockRejectedValueOnce(new Error("outcome uncertain; resend blocked"));
  await expect(processMeeting(vault, selected, memory, true, vi.fn())).rejects.toThrow("uncertain");
  const before = localStorage.getItem(`recall.meeting.v1:${selected.vault_identity}:${memory.id}`);
  await expect(processMeeting(vault, selected, memory, true, vi.fn(), { reviewRetry: true, acknowledgeUncertainty: false })).rejects.toThrow("acknowledge");
  expect(localStorage.getItem(`recall.meeting.v1:${selected.vault_identity}:${memory.id}`)).toBe(before);
  expect(vault.parse).toHaveBeenCalledTimes(1); expect(vault.organize).toHaveBeenCalledTimes(1);
});
it("reviewed recovery preserves parser and prior organizer, then resumes only its exact new operation", async () => {
  const vault = fixture(); vault.reviewedOrganize = vi.fn().mockRejectedValueOnce(new Error("new uncertain outcome"));
  vi.mocked(vault.organize).mockRejectedValueOnce(new Error("old uncertain outcome"));
  await expect(processMeeting(vault, selected, memory, true, vi.fn())).rejects.toThrow("old uncertain");
  const key = `recall.meeting.v1:${selected.vault_identity}:${memory.id}`;
  const prior = JSON.parse(localStorage.getItem(key)!);
  await expect(processMeeting(vault, selected, memory, true, vi.fn(), { reviewRetry: true, acknowledgeUncertainty: true })).rejects.toThrow("new uncertain");
  const reviewed = JSON.parse(localStorage.getItem(key)!);
  expect(reviewed.parser).toBe(prior.parser); expect(reviewed.reviewedFrom).toBe(prior.organizer);
  expect(reviewed.organizer).not.toBe(prior.organizer); expect(reviewed.publisher).not.toBe(prior.publisher);
  await processMeeting(vault, selected, memory, true, vi.fn());
  expect(vault.organize).toHaveBeenCalledTimes(1);
  expect(vi.mocked(vault.reviewedOrganize).mock.calls[0]!.slice(0,5)).toEqual(vi.mocked(vault.reviewedOrganize).mock.calls[1]!.slice(0,5));
  expect(vi.mocked(vault.reviewedOrganize).mock.calls[0]).toEqual([selected.vault_id, prior.parser, prior.organizer, reviewed.organizer, true, true]);
  expect(vi.mocked(vault.reviewedOrganize).mock.calls[1]![5]).toBe(false);
  expect(vi.mocked(vault.parse).mock.calls.every((call) => call[3] === prior.parser)).toBe(true);
});
it("browser reviewedFrom never supplies cost acknowledgement or authorizes a missing native audit", async () => {
  const vault=fixture();const sent=vi.fn();
  vault.reviewedOrganize=vi.fn(async (_scope,_parser,_prior,_operation,_consent,acknowledge) => {if(!acknowledge) throw new Error("Native review acknowledgement required");sent();return {};});
  localStorage.setItem(`recall.meeting.v1:${selected.vault_identity}:${memory.id}`,JSON.stringify({parser:"33333333-3333-4333-8333-333333333333",organizer:"44444444-4444-4444-8444-444444444444",publisher:"55555555-5555-4555-8555-555555555555",reviewedFrom:"66666666-6666-4666-8666-666666666666",revision:1,published:false}));
  await expect(processMeeting(vault,selected,memory,true,vi.fn())).rejects.toThrow("acknowledgement required");
  expect(sent).not.toHaveBeenCalled();expect(vault.publish).not.toHaveBeenCalled();
  expect(vi.mocked(vault.reviewedOrganize).mock.calls[0]![5]).toBe(false);
});
it("native review refusal preserves original publication IDs before creating a reviewed operation", async () => {
  const vault=fixture();vi.mocked(vault.organize).mockRejectedValueOnce(new Error("pending"));
  await expect(processMeeting(vault,selected,memory,true,vi.fn())).rejects.toThrow("pending");
  const key=`recall.meeting.v1:${selected.vault_identity}:${memory.id}`,before=localStorage.getItem(key);
  vi.mocked(vault.reviewOrganization!).mockRejectedValueOnce(new Error("Saved organization exists; resume original receipt"));
  vault.reviewedOrganize=vi.fn();
  await expect(processMeeting(vault,selected,memory,true,vi.fn(),{reviewRetry:true,acknowledgeUncertainty:true})).rejects.toThrow("resume original receipt");
  expect(localStorage.getItem(key)).toBe(before);expect(vault.reviewedOrganize).not.toHaveBeenCalled();
});
it("explicit reacknowledgement reuses an unattempted proposal after native configuration repair", async () => {
  const vault=fixture();vi.mocked(vault.organize).mockRejectedValueOnce(new Error("old uncertain"));
  await expect(processMeeting(vault,selected,memory,true,vi.fn())).rejects.toThrow("old uncertain");
  vault.reviewedOrganize=vi.fn().mockRejectedValueOnce(new Error("Native budget unavailable"));
  await expect(processMeeting(vault,selected,memory,true,vi.fn(),{reviewRetry:true,acknowledgeUncertainty:true})).rejects.toThrow("budget unavailable");
  const key=`recall.meeting.v1:${selected.vault_identity}:${memory.id}`,pending=JSON.parse(localStorage.getItem(key)!);
  vi.mocked(vault.reviewOrganization!).mockResolvedValueOnce({prior_operation_id:pending.reviewedFrom,reuse_operation:true});
  await processMeeting(vault,selected,memory,true,vi.fn(),{reviewRetry:true,acknowledgeUncertainty:true});
  const completed=JSON.parse(localStorage.getItem(key)!);
  expect(completed.organizer).toBe(pending.organizer);expect(completed.publisher).toBe(pending.publisher);
  expect(vi.mocked(vault.reviewedOrganize).mock.calls[0]).toEqual(vi.mocked(vault.reviewedOrganize).mock.calls[1]);
});
