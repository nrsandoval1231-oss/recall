import { invoke } from "@tauri-apps/api/core";
export interface VaultStatus { root: string | null; vault_id: string | null; vault_identity: string | null }
export interface VaultMemory { id: string; revision: number; note: string; source_name: string; source_sha256: string; captured_at: string; updated_at: string; conflict: string | null }
export interface VaultSource { bytes: number[]; mime_type: string; sha256: string }
export interface VaultRevision { revision: number; note: string; recorded_at: string; origin: string }
export interface LocalVault {
  readonly available: boolean;
  status(): Promise<VaultStatus>;
  select(): Promise<VaultStatus | null>;
  capture(expectedVaultId: string, operationId: string, note: string): Promise<VaultMemory | null>;
  list(expectedVaultId: string, query: string): Promise<VaultMemory[]>;
  correct(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, note: string): Promise<VaultMemory>;
  source(expectedVaultId: string, memoryId: string): Promise<VaultSource>;
  history(expectedVaultId: string, memoryId: string): Promise<VaultRevision[]>;
}
export class NativeLocalVault implements LocalVault {
  readonly available = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  private call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.available) return Promise.reject(new Error("Open the Recall desktop app to use a local vault."));
    return invoke<T>(command, args);
  }
  status() { return this.call<VaultStatus>("vault_status"); }
  select() { return this.call<VaultStatus | null>("vault_select"); }
  capture(expectedVaultId: string, operationId: string, note: string) { return this.call<VaultMemory | null>("vault_capture", { expectedVaultId, operationId, note }); }
  list(expectedVaultId: string, query: string) { return this.call<VaultMemory[]>("vault_list", { expectedVaultId, query }); }
  correct(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, note: string) { return this.call<VaultMemory>("vault_correct", { expectedVaultId, memoryId, expectedRevision, operationId, note }); }
  source(expectedVaultId: string, memoryId: string) { return this.call<VaultSource>("vault_source", { expectedVaultId, memoryId }); }
  history(expectedVaultId: string, memoryId: string) { return this.call<VaultRevision[]>("vault_history", { expectedVaultId, memoryId }); }
}
