import { invoke } from "@tauri-apps/api/core";
import type { RecallApiClient, SyncChange, SyncOperation, SyncSnapshot } from "@recall/api-client";

export interface CacheScope { user_id: string; workspace_id: string }
interface NativeEvent { sequence: number; workspace_id: string; kind: string; record_id: string; version: number; payload: unknown; deleted?: boolean }
interface NativeSnapshot { cursor: string; records: NativeEvent[] }
export interface PendingCommand { operation_id: string; kind: "memory.correction" | "action.update"; target_id: string; expected_version: number; payload: unknown; created_at: string; state?: string; last_error?: string | null }
export interface CachedRecord { kind: string; record_id: string; version: number; payload: unknown; deleted: boolean }
export interface CachedSource { source_id: string; sha256: string; byte_size: number; path: string }
export interface NativeExport { path: string; sha256: string; byte_size: number }
export interface MarkdownExport { root: string; written: string[]; removed: string[]; conflicts: { record_id: string; reason: string }[] }
export const MAX_NATIVE_EXPORT_BYTES = 32 * 1024 * 1024;
export function assertNativeExportSize(bytes: ArrayBuffer): void { if (bytes.byteLength > MAX_NATIVE_EXPORT_BYTES) throw new Error("NATIVE_EXPORT_LIMIT: export is limited to 32 MiB on this device."); }

/** Tauri-only cache adapter. Browser builds report unavailable instead of pretending persistence exists. */
export class NativeCache {
  readonly available = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  constructor(private readonly api: Pick<RecallApiClient, "syncChanges" | "syncSnapshot" | "syncPush">) {}
  private ensure() { if (!this.available) throw new Error("LOCAL_CACHE_UNAVAILABLE"); }
  private async scope(scope: CacheScope): Promise<CacheScope> { this.ensure(); return scope; }
  async cursor(scope: CacheScope): Promise<string> { return invoke<string>("sync_cursor", { scope: await this.scope(scope) }); }
  async apply(scope: CacheScope, events: SyncChange[], cursor: string): Promise<void> {
    const native: NativeEvent[] = events.map((e) => ({ sequence: e.sequence, workspace_id: scope.workspace_id, kind: e.kind, record_id: e.id, version: e.version, payload: e.data, deleted: e.deleted }));
    await invoke<void>("sync_apply_page", { scope: await this.scope(scope), events: native, cursor });
  }
  async replace(scope: CacheScope, snapshot: SyncSnapshot): Promise<void> {
    if (snapshot.workspace_id !== scope.workspace_id) throw new Error("SNAPSHOT_SCOPE_MISMATCH");
    const native: NativeSnapshot = { cursor: snapshot.cursor, records: snapshot.records.map((r) => ({ sequence: 0, workspace_id: scope.workspace_id, kind: r.kind, record_id: r.id, version: r.version, payload: r.data, deleted: r.deleted })) };
    await invoke<void>("sync_replace_snapshot", { scope: await this.scope(scope), snapshot: native });
  }
  async search(scope: CacheScope, query: string, limit = 20): Promise<CachedRecord[]> { return invoke<CachedRecord[]>("local_search", { scope: await this.scope(scope), query, limit }); }
  async cachedRecords(scope: CacheScope, limit = 100): Promise<CachedRecord[]> { return this.listRecords(scope, undefined, limit); }
  async listRecords(scope: CacheScope, kind?: string, limit = 100): Promise<CachedRecord[]> { return invoke<CachedRecord[]>("cache_list_records", { scope: await this.scope(scope), kind: kind ?? null, limit }); }
  async getRecord(scope: CacheScope, kind: string, recordId: string): Promise<CachedRecord | null> { return invoke<CachedRecord | null>("cache_get_record", { scope: await this.scope(scope), kind, recordId }); }
  async lastWorkspace(userId: string): Promise<string | null> { this.ensure(); return invoke<string | null>("cache_last_workspace", { userId }); }
  async getSource(scope: CacheScope, sourceId: string): Promise<CachedSource | null> { return invoke<CachedSource | null>("source_get_verified", { scope: await this.scope(scope), sourceId }); }
  async enqueue(scope: CacheScope, command: PendingCommand): Promise<void> { if (!Number.isInteger(command.expected_version) || command.expected_version < 1) throw new Error("EXPECTED_VERSION_REQUIRED"); await invoke<void>("outbox_enqueue", { scope: await this.scope(scope), command }); }
  async pending(scope: CacheScope): Promise<PendingCommand[]> { return invoke<PendingCommand[]>("outbox_list", { scope: await this.scope(scope) }); }
  async clear(scope: CacheScope, clearOutbox = false): Promise<void> { await invoke<void>("cache_clear", { scope: await this.scope(scope), clearOutbox }); }
  async saveArchive(bytes: ArrayBuffer, expectedSha256: string): Promise<NativeExport | null> { this.ensure(); assertNativeExportSize(bytes); return invoke<NativeExport | null>("export_save_archive", { bytes: Array.from(new Uint8Array(bytes)), expectedSha256 }); }
  async selectMarkdownRoot(): Promise<string | null> { this.ensure(); return invoke<string | null>("export_select_markdown_root", {}); }
  async applyMarkdownArchive(bytes: ArrayBuffer, expectedSha256: string): Promise<MarkdownExport> { this.ensure(); assertNativeExportSize(bytes); return invoke<MarkdownExport>("export_apply_markdown_archive", { bytes: Array.from(new Uint8Array(bytes)), expectedSha256 }); }
  async sync(scope: CacheScope): Promise<{ mode: "changes" | "snapshot"; cursor: string }> {
    this.ensure();
    try {
      let cursor = await this.cursor(scope);
      let page = await this.api.syncChanges(cursor, 100);
      let more = true;
      while (more) { await this.apply(scope, page.events, page.next_cursor ?? cursor); cursor = page.next_cursor ?? cursor; more = page.has_more; if (more) page = await this.api.syncChanges(cursor, 100); }
      return { mode: "changes", cursor };
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "SNAPSHOT_REQUIRED")) throw error;
      const snapshot = await this.api.syncSnapshot(); await this.replace(scope, snapshot); return { mode: "snapshot", cursor: snapshot.cursor };
    }
  }
  async push(scope: CacheScope): Promise<{ conflicts: string[]; applied: number }> {
    const pending = (await this.pending(scope)).slice(0, 50); if (!pending.length) return { conflicts: [], applied: 0 };
    const operations: SyncOperation[] = pending.map((p) => ({ operation_id: p.operation_id, kind: p.kind, target_id: p.target_id, expected_version: p.expected_version, payload: p.payload }));
    const result = await this.api.syncPush(operations);
    for (const item of result.results) await invoke<void>("outbox_mark", { scope: await this.scope(scope), operationId: item.operation_id, stateName: item.status, error: item.message ?? null });
    return { conflicts: result.results.filter((r) => r.status === "conflict").map((r) => r.operation_id), applied: result.results.filter((r) => r.status === "applied" || r.status === "already_applied").length };
  }
}
