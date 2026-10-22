import { BrowserCloudStore, type CloudStore, type CloudMutation } from "./cloud-store";
import type { LocalVault, SourceAnswer, VaultMemory, VaultRevision, VaultSource, VaultStatus, ProcessingOutcome } from "./local-vault";

export class CloudError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: unknown) { super(message); }
}

/** Same-origin HTTP only. Session/provider credentials are never stored in JavaScript. */
export async function cloudRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/v1${path}`, {
    ...init, credentials: "same-origin", cache: "no-store",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new CloudError(body.error?.message || "The cloud request could not finish. Your local draft is retained.", response.status, body.error?.code || "REQUEST_FAILED", body.error?.details);
  }
  if (path.endsWith("/source")) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = await sha256(bytes);
    if (digest !== response.headers.get("X-Recall-Source-SHA256")) throw new Error("Original source integrity verification failed.");
    return {bytes: Array.from(bytes), sha256: digest, mime_type: response.headers.get("Content-Type")?.split(";")[0] || "application/octet-stream"} as T;
  }
  return response.json() as Promise<T>;
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
function base64(bytes: Uint8Array): string {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), x => x.toString(16).padStart(2, "0")).join("");
}

/** One memory whose local edits the cloud refused. `remote` is null while the cloud version is unreachable. */
export interface ConflictReview { memory: string; operations: number; error: string; local: VaultMemory; remote: VaultMemory | null }
export type ConflictChoice = {kind: "mine"} | {kind: "cloud"} | {kind: "merged"; note: string};

export class CloudVault implements LocalVault {
  readonly storage = "cloud" as const;
  readonly available = true;
  private scope: string | null = null;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  syncMessage = "Connecting to your cloud library…";
  constructor(private store: CloudStore = new BrowserCloudStore(), private request = cloudRequest) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(message: string) { this.syncMessage = message; this.listeners.forEach(fn => fn()); }
  async synchronize(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.runSync().finally(() => {this.running = null;});
    return this.running;
  }
  private async runSync() {
    if (!this.scope) return;
    const scope = this.scope;
    const queued = (await this.store.pending(scope)).sort((a, b) => a.body.expected_revision - b.body.expected_revision);
    const blocked = new Set(queued.filter(row => row.error).map(row => row.memory));
    try {
      for (const item of queued) {
        if (blocked.has(item.memory)) continue;
        try {
          const saved = await this.request<VaultMemory>("/library/mutations", {method: "POST", body: JSON.stringify(item.body)});
          await this.store.accept(scope, item.operation, saved);
        } catch (error) {
          if (error instanceof CloudError && error.status === 409) {
            await this.store.conflict(scope, item.operation, error.message);
            blocked.add(item.memory);
          } else throw error;
        }
      }
      const remote = await this.request<VaultMemory[]>("/library/memories?include_deleted=true");
      for (const row of remote) {
        let source = await this.store.source(scope, row.id);
        if (!source && row.state === "active") source = await this.request<VaultSource>(`/library/memories/${encodeURIComponent(row.id)}/source`);
        await this.store.remote(scope, row, source);
      }
      const pending = await this.store.pending(scope);
      this.notify(blocked.size ? `${blocked.size} memory conflict(s). Local edits are retained; review before retrying.` : pending.length ? `${pending.length} change(s) waiting to sync.` : "All changes synced to your private cloud library.");
    } catch (error) {
      this.notify(error instanceof CloudError && error.status === 401 ? "Session expired. Changes remain saved on this device; sign in to sync." : "Offline or cloud unavailable. Changes are saved on this device and will retry.");
    }
  }
  async importMemory(memory: VaultMemory, source: VaultSource, history: VaultRevision[]) {
    if (!this.scope) await this.status();
    const scope = this.scope!;
    if (await sha256(new Uint8Array(source.bytes)) !== source.sha256) throw new Error("Import source hash mismatch");
    const saved = await this.request<VaultMemory>("/library/mutations", {method: "POST", body: JSON.stringify({
      action: "import", expected_vault_id: scope, operation_id: memory.id, memory_id: memory.id, expected_revision: 0,
      note: memory.note, note_path: memory.note_path || `${memory.id}.md`, captured_at: memory.captured_at,
      source_base64: base64(new Uint8Array(source.bytes)), source_sha256: source.sha256,
      source_name: memory.source_name || "note.txt", mime_type: source.mime_type,
      history: [...history].sort((a,b) => a.revision - b.revision),
    })});
    await this.store.remote(scope, saved, source);
    return saved;
  }
  async exportData() {
    if (!this.scope) await this.status();
    const scope = this.scope!;
    const memories = await this.store.list(scope);
    const records = [];
    for (const memory of memories) {
      const source = await this.source(scope, memory.id);
      let history: VaultRevision[] | null = null;
      try { history = await this.history(scope, memory.id); } catch { /* Explicitly marked unavailable in export. */ }
      records.push({memory, source, history});
    }
    return {format: "megraph-device-export-v1", exported_at: new Date().toISOString(), workspace_id: scope,
      records, pending_changes: await this.store.pending(scope),
      warning: "Device export; null history means it was unavailable. Not a complete server backup."};
  }
  async conflicts() { return this.scope ? (await this.store.pending(this.scope)).filter(row => row.error) : []; }
  async conflictReviews(): Promise<ConflictReview[]> {
    const blocked = await this.conflicts();
    if (!blocked.length) return [];
    const scope = this.scope!;
    const local = await this.store.list(scope);
    let remote: VaultMemory[] = [];
    try { remote = await this.request<VaultMemory[]>("/library/memories?include_deleted=true"); } catch { /* reviewed read-only while offline */ }
    const reviews: ConflictReview[] = [];
    for (const memory of new Set(blocked.map(row => row.memory))) {
      const mine = local.find(row => row.id === memory);
      if (mine) reviews.push({memory, operations: (await this.store.pending(scope)).filter(row => row.memory === memory).length, error: blocked.find(row => row.memory === memory)!.error!, local: mine, remote: remote.find(row => row.id === memory) ?? null});
    }
    return reviews;
  }
  /**
   * Explicit user resolution. Nothing is silently overwritten: "mine"/"merged" append new revisions on top of
   * the current cloud revision (the cloud text stays in history); "cloud" adopts the cloud record and drops the
   * reviewed local edits, which is why the UI shows them and asks first.
   */
  async resolveConflict(memory: string, choice: ConflictChoice): Promise<VaultMemory> {
    if (!this.scope) await this.status();
    const scope = this.scope!;
    const remote = (await this.request<VaultMemory[]>("/library/memories?include_deleted=true")).find(row => row.id === memory);
    const local = (await this.store.list(scope)).find(row => row.id === memory);
    if (!remote || !local) throw new Error("The cloud version is unavailable. Your edits are retained.");
    const mutations: CloudMutation[] = [];
    let revision = remote.revision;
    const add = (action: CloudMutation["action"], note?: string) => {
      mutations.push({operation_id: crypto.randomUUID(), memory_id: memory, action, expected_revision: revision++, expected_vault_id: scope, ...(note === undefined ? {} : {note})});
    };
    const removing = choice.kind === "mine" && local.state === "deleted";
    const note = choice.kind === "merged" ? choice.note : local.note;
    if (choice.kind !== "cloud") {
      if (removing) { if (remote.state !== "deleted") add("remove"); }
      else {
        if (remote.state === "deleted") add("restore");
        if (remote.state === "deleted" || note !== remote.note) add("correct", note);
      }
    }
    const record: VaultMemory = mutations.length
      ? {...remote, revision, state: removing ? "deleted" : "active", note: removing ? remote.note : note, updated_at: new Date().toISOString(), conflict: null}
      : remote;
    await this.store.resolve(scope, memory, record, mutations);
    this.notify(mutations.length ? "Resolution saved on this device. Sync pending." : "Using the cloud version.");
    void this.synchronize();
    return record;
  }

  private async check(scope: string) {
    if (!this.scope) await this.status();
    if (scope !== this.scope) throw new Error("The active cloud library changed. Reload before saving.");
  }
  async status(): Promise<VaultStatus> {
    try {
      const status = await this.request<VaultStatus>("/library/status");
      this.scope = status.vault_id;
      localStorage.setItem("megraph.cloud.last-scope", JSON.stringify(status));
      return status;
    } catch (error) {
      if (error instanceof CloudError && (error.status === 401 || error.status === 403)) throw error;
      const cached = localStorage.getItem("megraph.cloud.last-scope");
      if (!cached) throw error;
      const status = JSON.parse(cached) as VaultStatus;
      if (!status.vault_id) throw error;
      this.scope = status.vault_id;
      this.notify("Offline. Showing the library saved on this device.");
      return status;
    }
  }
  select() { return this.status(); }
  openDefault() { return this.status(); }
  async list(scope: string, query: string, includeDeleted = false): Promise<VaultMemory[]> {
    await this.check(scope);
    await this.synchronize();
    const rows = (await this.store.list(scope)).filter(row => includeDeleted || row.state !== "deleted");
    return rows.filter(row => !query || `${row.note} ${row.source_name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  }
  rebuild(scope: string, includeDeleted = false) { return this.list(scope, "", includeDeleted); }
  private async mutate(scope: string, body: CloudMutation): Promise<VaultMemory> {
    await this.check(scope);
    body.expected_vault_id = scope;
    const records = await this.store.list(scope);
    const current = records.find(row => row.id === body.memory_id);
    let source: VaultSource | null = null;
    if (body.action === "capture") {
      const bytes = body.source_base64 !== undefined ? Uint8Array.from(atob(body.source_base64), c => c.charCodeAt(0)) : new TextEncoder().encode(body.note ?? "");
      source = {bytes: Array.from(bytes), mime_type: body.mime_type || "text/plain", sha256: await sha256(bytes)};
      if (current && current.source_sha256 === source.sha256 && current.note === (body.note ?? "") && current.revision >= 1) return current;
    }
    const now = new Date().toISOString();
    if (body.action === "capture") body.captured_at = body.captured_at ?? now;
    const record: VaultMemory = {
      processing: body.action === "capture" ? {state: body.processing_consent ? "saved" : "consent-required", message: body.processing_consent ? "Saved on this device. Authorized processing queues after cloud sync." : "Original saved. Choose processing before sending this source to AI."} : current?.processing,
      id: body.memory_id, revision: body.expected_revision + 1, state: body.action === "remove" ? "deleted" : "active",
      note: body.action === "correct" || body.action === "capture" ? body.note ?? "" : current?.note ?? "",
      source_name: current?.source_name ?? body.source_name ?? "note.txt", source_sha256: current?.source_sha256 ?? source?.sha256 ?? "",
      captured_at: current?.captured_at ?? body.captured_at ?? now, updated_at: now, note_path: current?.note_path ?? `${body.memory_id}.md`, conflict: null,
    };
    await this.store.commit(scope, record, source, body);
    this.notify("Saved on this device. Sync pending.");
    void this.synchronize();
    return record;
  }
  async requestProcessing(scope: string, memory: string, revision: number, consent: boolean) {
    await this.check(scope);
    await this.synchronize();
    return this.request<ProcessingOutcome>(`/library/memories/${encodeURIComponent(memory)}/processing`, {method: "POST", body: JSON.stringify({expected_vault_id: scope, expected_revision: revision, consent})});
  }
  captureNote(scope: string, operation: string, note: string, processingConsent = false) {
    return this.mutate(scope, {operation_id: operation, memory_id: operation, action: "capture", expected_revision: 0, note, processing_consent: processingConsent});
  }
  async capture(scope: string, operation: string, note: string, processingConsent = false) {
    const file = await pickFile("image/jpeg,image/png,image/heic,image/heif");
    if (!file) return null;
    if (file.size > 25 * 1024 * 1024) throw new Error("Choose an original smaller than 25 MiB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    return this.mutate(scope, {operation_id: operation, memory_id: operation, action: "capture", expected_revision: 0,
      note, source_name: file.name, mime_type: file.type || (file.name.toLowerCase().endsWith(".heic") ? "image/heic" : "image/heif"),
      source_base64: base64(bytes), source_sha256: await sha256(bytes), processing_consent: processingConsent});
  }
  correct(scope: string, memory: string, revision: number, operation: string, note: string) {
    return this.mutate(scope, {operation_id: operation, memory_id: memory, action: "correct", expected_revision: revision, note});
  }
  remove(scope: string, memory: string, revision: number, operation: string) {
    return this.mutate(scope, {operation_id: operation, memory_id: memory, action: "remove", expected_revision: revision});
  }
  restoreDeleted(scope: string, memory: string, revision: number, operation: string) {
    return this.mutate(scope, {operation_id: operation, memory_id: memory, action: "restore", expected_revision: revision});
  }
  restoreNote(scope: string, memory: string, revision: number, operation: string) { return this.restoreDeleted(scope, memory, revision, operation); }
  async source(scope: string, memory: string): Promise<VaultSource> {
    await this.check(scope);
    const cached = await this.store.source(scope, memory);
    if (cached) {
      if (await sha256(new Uint8Array(cached.bytes)) !== cached.sha256) throw new Error("Cached original failed integrity verification.");
      return cached;
    }
    return this.request<VaultSource>(`/library/memories/${encodeURIComponent(memory)}/source`);
  }
  async history(scope: string, memory: string): Promise<VaultRevision[]> {
    await this.check(scope);
    return this.request(`/library/memories/${encodeURIComponent(memory)}/history`);
  }
  async ask(scope: string, question: string): Promise<SourceAnswer> {
    await this.check(scope);
    await this.synchronize();
    return this.request("/library/ask", {method: "POST", body: JSON.stringify({question})});
  }
}
