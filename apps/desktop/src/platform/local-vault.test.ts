// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { NativeLocalVault } from "./local-vault";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
afterEach(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); vi.clearAllMocks(); });
it("every data command sends selected session authorization and never a renderer path", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const vault = new NativeLocalVault();
  await vault.status(); await vault.select(); await vault.capture("session", "op", "note"); await vault.list("session", "word"); await vault.correct("session", "memory", 3, "op2", "new note"); await vault.source("session", "memory"); await vault.history("session", "memory");
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["vault_status", undefined], ["vault_select", undefined],
    ["vault_capture", { expectedVaultId: "session", operationId: "op", note: "note" }],
    ["vault_list", { expectedVaultId: "session", query: "word" }],
    ["vault_correct", { expectedVaultId: "session", memoryId: "memory", expectedRevision: 3, operationId: "op2", note: "new note" }],
    ["vault_source", { expectedVaultId: "session", memoryId: "memory" }],
    ["vault_history", { expectedVaultId: "session", memoryId: "memory" }],
  ]);
});
it("the default vault command takes no renderer path", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  await new NativeLocalVault().openDefault();
  expect(vi.mocked(invoke).mock.calls).toEqual([["vault_open_default", undefined]]);
});
it("browser adapter refuses native persistence without invoking any command", async () => {
  const vault = new NativeLocalVault(); expect(vault.available).toBe(false);
  await expect(vault.status()).rejects.toThrow("desktop app"); expect(invoke).not.toHaveBeenCalled();
});

it("lifecycle commands preserve exact revision, state, operation identity and includeDeleted authorization", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const vault = new NativeLocalVault();
  await vault.list("session", "", true); await vault.rebuild("session", true);
  await vault.restoreNote("session", "memory", 4, "restore-op");
  await vault.remove("session", "memory", 4, "remove-op", "missing");
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["vault_list", { expectedVaultId: "session", query: "", includeDeleted: true }],
    ["vault_rebuild", { expectedVaultId: "session", includeDeleted: true }],
    ["vault_restore_note", { expectedVaultId: "session", memoryId: "memory", expectedRevision: 4, operationId: "restore-op" }],
    ["vault_remove", { expectedVaultId: "session", memoryId: "memory", expectedRevision: 4, operationId: "remove-op", expectedState: "missing" }],
  ]);
});
