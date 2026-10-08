import { invoke } from "@tauri-apps/api/core";
export interface VaultStatus { root: string | null; vault_id: string | null; vault_identity: string | null }
export type VaultMemoryState = "active" | "missing" | "deleted" | "conflict";
export interface ReadingBinding { schema_version: "1.0"; operation_id: string; vault_id: string; memory_id: string; source_id: string; source_sha256: string; expected_revision: number; captured_at: string }
export interface ReadingEvidence { page_id: string; quote: string }
export interface ReadingExtraction { schema_version: "1.1"; capture_id: string; input_manifest_sha256: string; summary: string | null; summary_evidence: ReadingEvidence[]; pages: { page_id: string; ordinal: number; transcription: string; legibility: "clear" | "mixed" | "unreadable" }[]; mentions: unknown[]; statements: unknown[]; action_suggestions: unknown[]; uncertainties: { kind: string; description: string; evidence: ReadingEvidence[] }[] }
export interface VaultReading { machine: { request: { binding: ReadingBinding; media_type: string }; result: { provider: "anthropic"; model_id: string; input_manifest_sha256: string; derivative: { sha256: string; transform_version: "jpeg-rgb-exif-orient-v1"; media_type: "image/jpeg" }; extraction: ReadingExtraction; validation_notes: { code: string; detail: string }[]; review_state: "unreviewed" } }; human_correction: string | null }
export interface ReadingCapability { enabled: boolean; explanation: string }
export interface PairingStatus { state: "pending_owner_approval" | "connected" | "disconnected" | "unknown"; device_id: string | null; vault_id: string; fingerprint: string | null; scope: "photo_inference" | null }
export interface ReadingOperation { operation_id: string; memory_id: string; expected_revision: number; state: "prepared" | "unknown" | "in_flight" | "ready" | "committed" | "cancelled" | "failed" | "expired"; may_have_been_sent: boolean; error_code: string | null }
export interface ReadingOutcome { operation: ReadingOperation; memory: VaultMemory | null }
export function effectiveReading(memory: Pick<VaultMemory, "reading">): string { return memory.reading?.human_correction ?? memory.reading?.machine.result.extraction.pages[0]?.transcription ?? ""; }
export interface VaultMemory { reading?: VaultReading; state: VaultMemoryState; note_path: string | null; id: string; revision: number; note: string; source_name: string; source_sha256: string; captured_at: string; updated_at: string; conflict: string | null }
export interface VaultSource { bytes: number[]; mime_type: string; sha256: string }
export interface VaultRevision { reading?: VaultReading; revision: number; note: string; recorded_at: string; origin: "human:recall" | "human:obsidian" | "machine:anthropic"; kind: "capture" | "correct" | "external" | "restore" | "remove" | "machine_reading" | "reading_correction" }
export interface LocalVault {
  readonly available: boolean;
  status(): Promise<VaultStatus>;
  select(): Promise<VaultStatus | null>;
  capture(expectedVaultId: string, operationId: string, note: string): Promise<VaultMemory | null>;
  list(expectedVaultId: string, query: string, includeDeleted?: boolean): Promise<VaultMemory[]>;
  rebuild(expectedVaultId: string, includeDeleted?: boolean): Promise<VaultMemory[]>;
  restoreNote(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string): Promise<VaultMemory>;
  remove(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, expectedState: "active" | "missing"): Promise<VaultMemory>;
  correct(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, note: string): Promise<VaultMemory>;
  source(expectedVaultId: string, memoryId: string): Promise<VaultSource>;
  history(expectedVaultId: string, memoryId: string): Promise<VaultRevision[]>;
  readingCapability(expectedVaultId: string): Promise<ReadingCapability>;
  readingOperations(expectedVaultId: string, memoryId: string): Promise<ReadingOperation[]>;
  readPhoto(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string): Promise<ReadingOutcome>;
  recoverReading(expectedVaultId: string, operationId: string): Promise<ReadingOutcome>;
  cancelReading(expectedVaultId: string, operationId: string): Promise<ReadingOperation>;
  correctReading(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, text: string): Promise<VaultMemory>;
  pairingPrepare?(expectedVaultId: string): Promise<PairingStatus>;
  pairingClaim?(expectedVaultId: string, invitationId: string): Promise<PairingStatus>;
  pairingStatus?(expectedVaultId: string): Promise<PairingStatus>;
  pairingDisconnect?(expectedVaultId: string): Promise<PairingStatus>;
}
export class NativeLocalVault implements LocalVault {
  readonly available = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  private call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.available) return Promise.reject(new Error("Open the Recall desktop app to use a local vault."));
    return invoke<T>(command, args);
  }
  readingCapability(expectedVaultId: string) { return this.call<ReadingCapability>("vault_reading_capability", { expectedVaultId }); }
  readingOperations(expectedVaultId: string, memoryId: string) { return this.call<ReadingOperation[]>("vault_reading_operations", { expectedVaultId, memoryId }); }
  readPhoto(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string) { return this.call<ReadingOutcome>("vault_read_photo", { expectedVaultId, memoryId, expectedRevision, operationId }); }
  recoverReading(expectedVaultId: string, operationId: string) { return this.call<ReadingOutcome>("vault_recover_reading", { expectedVaultId, operationId }); }
  cancelReading(expectedVaultId: string, operationId: string) { return this.call<ReadingOperation>("vault_cancel_reading", { expectedVaultId, operationId }); }
  correctReading(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, text: string) { return this.call<VaultMemory>("vault_correct_reading", { expectedVaultId, memoryId, expectedRevision, operationId, text }); }
  pairingPrepare(expectedVaultId: string) { return this.call<PairingStatus>("vault_pairing_prepare", { expectedVaultId }); }
  pairingClaim(expectedVaultId: string, invitationId: string) { return this.call<PairingStatus>("vault_pairing_claim", { expectedVaultId, invitationId }); }
  pairingStatus(expectedVaultId: string) { return this.call<PairingStatus>("vault_pairing_status", { expectedVaultId }); }
  pairingDisconnect(expectedVaultId: string) { return this.call<PairingStatus>("vault_pairing_disconnect", { expectedVaultId }); }
  status() { return this.call<VaultStatus>("vault_status"); }
  select() { return this.call<VaultStatus | null>("vault_select"); }
  capture(expectedVaultId: string, operationId: string, note: string) { return this.call<VaultMemory | null>("vault_capture", { expectedVaultId, operationId, note }); }
  list(expectedVaultId: string, query: string, includeDeleted?: boolean) { return this.call<VaultMemory[]>("vault_list", { expectedVaultId, query, ...(includeDeleted === undefined ? {} : { includeDeleted }) }); }
  rebuild(expectedVaultId: string, includeDeleted = false) { return this.call<VaultMemory[]>("vault_rebuild", { expectedVaultId, includeDeleted }); }
  restoreNote(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string) { return this.call<VaultMemory>("vault_restore_note", { expectedVaultId, memoryId, expectedRevision, operationId }); }
  remove(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, expectedState: "active" | "missing") { return this.call<VaultMemory>("vault_remove", { expectedVaultId, memoryId, expectedRevision, operationId, expectedState }); }
  correct(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, note: string) { return this.call<VaultMemory>("vault_correct", { expectedVaultId, memoryId, expectedRevision, operationId, note }); }
  source(expectedVaultId: string, memoryId: string) { return this.call<VaultSource>("vault_source", { expectedVaultId, memoryId }); }
  history(expectedVaultId: string, memoryId: string) { return this.call<VaultRevision[]>("vault_history", { expectedVaultId, memoryId }); }
}
