// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { NativeLocalVault } from "./local-vault";
import type { VaultMemory } from "./local-vault";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
afterEach(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); vi.clearAllMocks(); });
it("every data command sends selected session authorization and never a renderer path", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const vault = new NativeLocalVault();
  await vault.status(); await vault.select(); await vault.capture("session", "op", "note"); await vault.captureText("session", "text-op", " pasted\nthought "); await vault.importTextFile("session", "file-op"); await vault.list("session", "word"); await vault.correct("session", "memory", 3, "op2", "new note"); await vault.source("session", "memory"); await vault.history("session", "memory");
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["vault_status", undefined], ["vault_select", undefined],
    ["vault_capture", { expectedVaultId: "session", operationId: "op", note: "note" }],
    ["vault_capture_text", { expectedVaultId: "session", operationId: "text-op", text: " pasted\nthought " }],
    ["vault_import_text_file", { expectedVaultId: "session", operationId: "file-op" }],
    ["vault_list", { expectedVaultId: "session", query: "word" }],
    ["vault_correct", { expectedVaultId: "session", memoryId: "memory", expectedRevision: 3, operationId: "op2", note: "new note" }],
    ["vault_source", { expectedVaultId: "session", memoryId: "memory" }],
    ["vault_history", { expectedVaultId: "session", memoryId: "memory" }],
  ]);
});
it("browser adapter refuses native persistence without invoking any command", async () => {
  const vault = new NativeLocalVault(); expect(vault.available).toBe(false);
  await expect(vault.status()).rejects.toThrow("desktop app"); expect(invoke).not.toHaveBeenCalled();
});

it("preserves native related-memory evidence and stable IDs in the selected-vault DTO", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const row: VaultMemory = { id: "source-id", revision: 8, note: "SYNTHETIC source", source_name: "source.txt", source_sha256: "source-hash", captured_at: "2026-10-09T12:00:00Z", updated_at: "2026-10-09T12:00:00Z", conflict: null, state: "active", note_path: "source.md", related_context: [{ target_memory_id: "target-id", label: "Possibly related (unreviewed)", source_quote: "source quote", target_quote: "target quote", note_basename: "target.md" }] };
  vi.mocked(invoke).mockResolvedValueOnce([row]);
  const vault = new NativeLocalVault();
  const rows = await vault.list("selected-session", "", false);
  expect(rows[0]?.related_context).toEqual(row.related_context);
  expect(vi.mocked(invoke)).toHaveBeenCalledWith("vault_list", { expectedVaultId: "selected-session", query: "", includeDeleted: false });
});

it("calls the atomic related-memory validator with session and stable IDs", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const verification = { memory_id: "target-id", revision: 4, source_sha256: "a".repeat(64), source_name: "target.txt", note_basename: "Target.md", original: { bytes: [83], mime_type: "text/plain", sha256: "a".repeat(64) } };
  vi.mocked(invoke).mockResolvedValueOnce(verification);
  const result = await new NativeLocalVault().relatedMemory("selected-session", "source-id", "target-id");
  expect(result).toEqual(verification);
  expect(vi.mocked(invoke)).toHaveBeenCalledWith("vault_related_memory", { expectedVaultId: "selected-session", sourceMemoryId: "source-id", targetMemoryId: "target-id" });
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

it("reading commands bind selected scope and operation without renderer bytes, origins or credentials", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const vault = new NativeLocalVault();
  await vault.readingCapability("session"); await vault.readingOperations("session", "memory");
  await vault.readPhoto("session", "memory", 4, "read-op"); await vault.recoverReading("session", "read-op");
  await vault.cancelReading("old-session", "read-op"); await vault.correctReading("session", "memory", 5, "correction-op", "");
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["vault_reading_capability", { expectedVaultId: "session" }],
    ["vault_reading_operations", { expectedVaultId: "session", memoryId: "memory" }],
    ["vault_read_photo", { expectedVaultId: "session", memoryId: "memory", expectedRevision: 4, operationId: "read-op" }],
    ["vault_recover_reading", { expectedVaultId: "session", operationId: "read-op" }],
    ["vault_cancel_reading", { expectedVaultId: "old-session", operationId: "read-op" }],
    ["vault_correct_reading", { expectedVaultId: "session", memoryId: "memory", expectedRevision: 5, operationId: "correction-op", text: "" }],
  ]);
});

it("Ask and its connection use only the separately scoped native commands", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const vault = new NativeLocalVault();
  await vault.askCapability("ask-vault"); await vault.ask("ask-vault", "operation-id", "Who was in Houston?"); await vault.recoverAsk("ask-vault", "operation-id");
  await vault.intelligencePairingPrepare("ask-vault"); await vault.intelligencePairingClaim("ask-vault", "owner-issued-invitation");
  await vault.intelligencePairingStatus("ask-vault"); await vault.intelligencePairingDisconnect("ask-vault");
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["vault_intelligence_capability", { expectedVaultId: "ask-vault" }],
    ["vault_ask", { expectedVaultId: "ask-vault", operationId: "operation-id", question: "Who was in Houston?" }],
    ["vault_recover_ask", { expectedVaultId: "ask-vault", operationId: "operation-id" }],
    ["vault_intelligence_pairing_prepare", { expectedVaultId: "ask-vault" }],
    ["vault_intelligence_pairing_claim", { expectedVaultId: "ask-vault", invitationId: "owner-issued-invitation" }],
    ["vault_intelligence_pairing_status", { expectedVaultId: "ask-vault" }],
    ["vault_intelligence_pairing_disconnect", { expectedVaultId: "ask-vault" }],
  ]);
});

it("historical Ask commands keep consent, temporal intent, recovery and citation in native scope", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const temporal = { mode: "as_of" as const, start_utc: "2026-10-01T05:00:00Z", end_exclusive_utc: "2026-10-02T05:00:00Z", display_date: "2026-10-01", display_timezone: "America/Chicago" };
  const vault = new NativeLocalVault();
  await vault.setHistoryConsent("history-vault", true, 7);
  await vault.askHistory("history-vault", "history-operation", "What did I know then?", temporal);
  await vault.recoverHistoryAsk("history-vault", "history-operation");
  await vault.askHistoryCitation("history-vault", "history-operation", "c1");
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["vault_set_history_consent", { expectedVaultId: "history-vault", enableHistory: true, expectedVersion: 7 }],
    ["vault_ask_history", { expectedVaultId: "history-vault", operationId: "history-operation", question: "What did I know then?", temporal }],
    ["vault_recover_history_ask", { expectedVaultId: "history-vault", operationId: "history-operation" }],
    ["vault_ask_history_citation", { expectedVaultId: "history-vault", operationId: "history-operation", citationId: "c1" }],
  ]);
});

it("organization commands use native capability, remembered consent epoch, selected vault and snake-case DTOs", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const vault = new NativeLocalVault();
  await vault.organizationCapability("org-vault");
  await vault.setOrganizationConsent("org-vault", true, 0);
  await vault.reconcileOrganizationConsent("org-vault");
  await vault.organizationOperations("org-vault", "memory-id");
  await vault.recoverOrganization("org-vault", "same-operation");
  await vault.processPendingOrganization("org-vault");
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["vault_organization_capability", { expectedVaultId: "org-vault" }],
    ["vault_set_organization_consent", { expectedVaultId: "org-vault", enabled: true, expectedConsentEpoch: 0 }],
    ["vault_reconcile_organization_consent", { expectedVaultId: "org-vault" }],
    ["vault_organization_operations", { expectedVaultId: "org-vault", memoryId: "memory-id" }],
    ["vault_recover_organization", { expectedVaultId: "org-vault", operationId: "same-operation" }],
    ["vault_organization_process_pending", { expectedVaultId: "org-vault" }],
  ]);
});

it("audio commands carry only the selected session, UUIDs, action and text, and preserve the frozen DTO", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const vault = new NativeLocalVault();
  const dto = { schema_version: "1.0", operation_id: "op", vault_id: "stable", state: "saved_local", memory: null, error_code: null, limit_reason: "duration_limit", source_sample_rate_hz: 48000, source_channels: 2 };
  vi.mocked(invoke).mockResolvedValueOnce(dto);
  expect(await vault.audioStart("session", "op")).toEqual(dto);
  await vault.audioStop("session", "op"); await vault.audioStatus("session", "op"); await vault.audioRecover("session", "op", "discard");
  await vault.audioCorrect("session", "memory", 2, "fix-op", "typed words"); await vault.importWav("session", "wav-op");
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["vault_audio_start", { expectedVaultId: "session", operationId: "op" }],
    ["vault_audio_stop", { expectedVaultId: "session", operationId: "op" }],
    ["vault_audio_status", { expectedVaultId: "session", operationId: "op" }],
    ["vault_audio_recover", { expectedVaultId: "session", operationId: "op", action: "discard" }],
    ["vault_audio_correct", { expectedVaultId: "session", memoryId: "memory", expectedRevision: 2, operationId: "fix-op", text: "typed words" }],
    ["vault_import_wav", { expectedVaultId: "session", operationId: "wav-op" }],
  ]);
});

it("an empty human reading correction takes precedence over machine text", async () => {
  const { effectiveReading } = await import("./local-vault");
  const reading = { human_correction: "", machine: { result: { extraction: { pages: [{ transcription: "machine" }] } } } };
  expect(effectiveReading({ reading } as Parameters<typeof effectiveReading>[0])).toBe("");
  expect(effectiveReading({})).toBe("");
});
