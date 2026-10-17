import { invoke } from "@tauri-apps/api/core";
import type { VaultMemory, VaultSource } from "./local-vault";
export interface CloudMutation {
  processing_consent?: boolean;
  operation_id: string; memory_id: string; expected_revision: number;
  action: "capture" | "correct" | "remove" | "restore";
  note?: string; source_base64?: string; source_name?: string; mime_type?: string; source_sha256?: string; expected_vault_id?: string; captured_at?: string;
}
export interface PendingMutation { scope: string; operation: string; memory: string; body: CloudMutation; error: string | null }
interface StoredMemory { scope: string; id: string; record: VaultMemory; source: VaultSource | null }
export interface CloudStore {
  list(scope: string): Promise<VaultMemory[]>;
  source(scope: string, id: string): Promise<VaultSource | null>;
  pending(scope: string): Promise<PendingMutation[]>;
  commit(scope: string, record: VaultMemory, source: VaultSource | null, mutation: CloudMutation): Promise<void>;
  accept(scope: string, operation: string, record: VaultMemory): Promise<void>;
  remote(scope: string, record: VaultMemory, source: VaultSource | null): Promise<void>;
  conflict(scope: string, operation: string, error: string): Promise<void>;
}
function result<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => {request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);}); }
function complete(tx: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => {tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error || new Error("Offline storage transaction failed"));}); }

export class BrowserCloudStore implements CloudStore {
  private async open(): Promise<IDBDatabase> {
    const request = indexedDB.open("megraph-cloud-v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("memories", {keyPath: ["scope", "id"]});
      request.result.createObjectStore("outbox", {keyPath: ["scope", "operation"]}).createIndex("scope", "scope");
    };
    return result(request);
  }
  private async read<T>(store: string, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    try { return await result(action(db.transaction(store).objectStore(store))); } finally { db.close(); }
  }
  async list(scope: string) { return (await this.read<StoredMemory[]>("memories", store => store.getAll(IDBKeyRange.bound([scope, ""], [scope, "\uffff"])))).map(row => row.record); }
  async source(scope: string, id: string) { return (await this.read<StoredMemory | undefined>("memories", store => store.get([scope, id])))?.source ?? null; }
  async pending(scope: string) { return this.read<PendingMutation[]>("outbox", store => store.index("scope").getAll(scope)); }
  private async write(action: (memories: IDBObjectStore, outbox: IDBObjectStore) => Promise<void>) {
    const db = await this.open(); const tx = db.transaction(["memories", "outbox"], "readwrite"); const done = complete(tx);
    try { await action(tx.objectStore("memories"), tx.objectStore("outbox")); await done; }
    catch (error) { try {tx.abort();} catch { /* already aborted */ } await done.catch(() => {}); throw error; }
    finally { db.close(); }
  }
  async commit(scope: string, record: VaultMemory, source: VaultSource | null, mutation: CloudMutation) {
    await this.write(async (memories, outbox) => {
      const replay = await result(outbox.get([scope, mutation.operation_id])) as PendingMutation | undefined;
      if (replay) {
        if (JSON.stringify(replay.body) !== JSON.stringify(mutation)) throw new Error("Operation ID reused with different content");
        return;
      }
      const current = await result(memories.get([scope, record.id])) as StoredMemory | undefined;
      if ((current?.record.revision ?? 0) !== mutation.expected_revision) throw new Error("Memory changed in another window. Your draft is retained; reload before retrying.");
      memories.put({scope, id: record.id, record, source: source ?? current?.source ?? null});
      outbox.put({scope, operation: mutation.operation_id, memory: record.id, body: mutation, error: null});
    });
  }
  async accept(scope: string, operation: string, record: VaultMemory) {
    await this.write(async (memories, outbox) => {
      outbox.delete([scope, operation]);
      const remaining = await result(outbox.index("scope").getAll(scope)) as PendingMutation[];
      const current = await result(memories.get([scope, record.id])) as StoredMemory | undefined;
      if (!remaining.some(row => row.memory === record.id)) memories.put({scope, id: record.id, record, source: current?.source ?? null});
    });
  }
  async remote(scope: string, record: VaultMemory, source: VaultSource | null) {
    await this.write(async (memories, outbox) => {
      const pending = await result(outbox.index("scope").getAll(scope)) as PendingMutation[];
      if (pending.some(row => row.memory === record.id)) return;
      const current = await result(memories.get([scope, record.id])) as StoredMemory | undefined;
      if (current && current.record.revision > record.revision) return;
      memories.put({scope, id: record.id, record, source: source ?? current?.source ?? null});
    });
  }
  async conflict(scope: string, operation: string, error: string) {
    await this.write(async (_memories, outbox) => {
      const current = await result(outbox.get([scope, operation])) as PendingMutation | undefined;
      if (current) outbox.put({...current, error});
    });
  }
}

/** Windows uses the existing SQLite database, not a browser-only persistence claim. */
export class NativeCloudStore implements CloudStore {
  private call<T>(action: string, scope: string, payload: unknown = null): Promise<T> {
    return invoke<T>("cloud_cache", {action, scope, payload});
  }
  list(scope: string) { return this.call<VaultMemory[]>("list", scope); }
  source(scope: string, id: string) { return this.call<VaultSource | null>("source", scope, {id}); }
  pending(scope: string) { return this.call<PendingMutation[]>("pending", scope); }
  commit(scope: string, record: VaultMemory, source: VaultSource | null, mutation: CloudMutation) { return this.call<void>("commit", scope, {record, source, mutation}); }
  accept(scope: string, operation: string, record: VaultMemory) { return this.call<void>("accept", scope, {operation, record}); }
  remote(scope: string, record: VaultMemory, source: VaultSource | null) { return this.call<void>("remote", scope, {record, source}); }
  conflict(scope: string, operation: string, error: string) { return this.call<void>("conflict", scope, {operation, error}); }
}
