import {
  ApiError,
  parseApiError,
  summarizeFailure,
  type ExpectedPage,
  type ServerCapture,
  type UploadAuthorization,
} from "@recall/api-client";
import type { Clock, FileUploader, LocalFiles } from "./ports";
import { LocalCaptureStore, toManifest } from "./local-store";
import type { LocalCapture, LocalPage } from "./types";

/** The subset of RecallApiClient the engine needs (so tests and platforms can substitute transport). */
export interface SyncApi {
  createCapture(manifest: ReturnType<typeof toManifest>, idempotencyKey: string): Promise<ServerCapture>;
  authorizeUploads(captureId: string, sourceIds?: string[]): Promise<UploadAuthorization[]>;
  finalize(captureId: string, expected: ExpectedPage[], idempotencyKey: string): Promise<ServerCapture>;
  authHeaders(): Promise<Record<string, string>>;
  resolve(pathOrUrl: string): string;
}

export interface SyncDeps {
  files: LocalFiles;
  api: SyncApi;
  uploader: FileUploader;
  clock: Clock;
  uuid: () => string;
  /** Registers this device (idempotent). Called before the first create of a run. */
  ensureDevice: () => Promise<void>;
  /** The signed-in auth user id, or null when signed out. */
  currentUserId: () => Promise<string | null>;
}

/** A condition that no retry can fix without user action. The local capture is kept regardless. */
class IntegrityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type DisplayStatus = "saved_locally" | "uploading" | "uploaded" | "failed";

export function displayStatus(capture: LocalCapture, active: boolean): DisplayStatus {
  if (capture.sync.phase === "finalized") return "uploaded";
  if (active) return "uploading";
  if (capture.sync.lastError) return "failed";
  return "saved_locally";
}

type Listener = () => void;

/**
 * Local-first capture engine. "Uploaded" means ONLY: the server finalized the capture, and for
 * every page the server-computed SHA-256 equals the hash taken from the bytes saved on this device.
 * An HTTP request merely starting never changes the status.
 */
export class CaptureSyncer {
  readonly store: LocalCaptureStore;
  private readonly active = new Set<string>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly deps: SyncDeps) {
    this.store = new LocalCaptureStore(deps.files, deps.clock, deps.uuid);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isActive(operationId: string): boolean {
    return this.active.has(operationId);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Sync every capture that is not yet uploaded, oldest first. Safe to call repeatedly (e.g. on foreground). */
  async syncAllPending(): Promise<void> {
    const owner = await this.deps.currentUserId();
    if (!owner) return;
    const pending = (await this.store.list(owner)).filter((c) => c.sync.phase !== "finalized" && c.sync.lastError?.retryable !== false) // permanent failures wait for a manual retry
      .reverse();
    for (const capture of pending) await this.sync(capture.operationId);
  }

  /** Never throws for transport/API failures: they are recorded on the capture and shown as "Failed — retry". */
  async sync(operationId: string): Promise<LocalCapture> {
    if (this.active.has(operationId)) return this.store.read(operationId);
    this.active.add(operationId);
    this.emit();
    try {
      return await this.run(operationId);
    } finally {
      this.active.delete(operationId);
      this.emit();
    }
  }

  private async run(operationId: string): Promise<LocalCapture> {
    let capture = await this.store.read(operationId);
    if (capture.sync.phase === "finalized") return capture;
    try {
      capture = await this.store.update(operationId, (c) => ({
        ...c,
        sync: { ...c.sync, phase: "in_progress", attempts: c.sync.attempts + 1, lastError: null },
      }));
      this.emit();
      if ((await this.deps.currentUserId()) !== capture.ownerUserId) {
        throw new IntegrityError("WRONG_ACCOUNT", "This capture belongs to a different account. Sign in to that account to upload it.");
      }
      await this.deps.ensureDevice();
      await this.verifyLocalBytes(capture);

      // 1. Create (or re-find) the server capture. The operation id is the idempotency key.
      let server = await this.deps.api.createCapture(toManifest(capture), capture.operationId);
      capture = await this.recordServerCapture(capture, server);

      // 2. Upload only pages the server has not received.
      if (server.status === "awaiting_upload") {
        await this.uploadPages(capture, server, (p) => p.upload_state === "pending");
      }

      // 3. Finalize; if stored originals were lost server-side, re-upload exactly those and retry.
      for (let repair = 0; ; repair++) {
        try {
          server = await this.deps.api.finalize(server.capture_id, expectedPages(capture), `fin-${capture.operationId}`);
          break;
        } catch (error) {
          const missing = error instanceof ApiError && error.code === "UPLOAD_INCOMPLETE" ? error.details?.missing_source_ids : undefined;
          if (!Array.isArray(missing) || repair >= 2) throw error;
          // `missing_source_ids` is authoritative and complete; the create-time view is stale by now.
          await this.uploadPages(capture, server, (p) => (missing as string[]).includes(p.source_id));
        }
      }

      this.assertServerMatchesLocal(capture, server);
      capture = await this.store.update(operationId, (c) => ({
        ...c,
        pages: c.pages.map((p) => ({ ...p, serverConfirmedSha256: p.sha256 })),
        sync: { phase: "finalized", attempts: c.sync.attempts, lastError: null, serverCaptureId: server.capture_id, finalizedAt: this.deps.clock.now().toISOString() },
      }));
      return capture;
    } catch (error) {
      const summary = error instanceof IntegrityError
        ? { code: error.code, message: error.message, retryable: false }
        : summarizeFailure(error);
      return this.store.update(operationId, (c) => ({
        ...c,
        sync: { ...c.sync, phase: "pending", lastError: { ...summary, at: this.deps.clock.now().toISOString() } },
      }));
    }
  }

  /** Never upload bytes that no longer match what was saved: that would silently corrupt the source. */
  private async verifyLocalBytes(capture: LocalCapture): Promise<void> {
    for (const page of capture.pages) {
      const rel = this.store.pageRel(capture, page);
      const size = await this.deps.files.size(rel);
      if (size === null) throw new IntegrityError("LOCAL_FILE_MISSING", `Page ${page.ordinal} is missing from this device.`);
      const { sha256 } = await this.deps.files.sha256(rel);
      if (sha256 !== page.sha256) throw new IntegrityError("LOCAL_FILE_CORRUPT", `Page ${page.ordinal} changed on this device after it was saved.`);
    }
  }

  private async recordServerCapture(capture: LocalCapture, server: ServerCapture): Promise<LocalCapture> {
    const byClientPage = new Map(server.pages.map((p) => [p.client_page_id, p]));
    return this.store.update(capture.operationId, (c) => ({
      ...c,
      pages: c.pages.map((p) => ({ ...p, sourceId: byClientPage.get(p.clientPageId)?.source_id ?? p.sourceId })),
      sync: { ...c.sync, serverCaptureId: server.capture_id },
    }));
  }

  private async uploadPages(
    capture: LocalCapture,
    server: ServerCapture,
    wanted: (page: ServerCapture["pages"][number]) => boolean,
  ): Promise<void> {
    const targets = server.pages.filter(wanted);
    if (targets.length === 0) return;
    let authorizations = await this.deps.api.authorizeUploads(server.capture_id, targets.map((t) => t.source_id));
    for (const target of targets.sort((a, b) => a.ordinal - b.ordinal)) {
      const local = capture.pages.find((p) => p.clientPageId === target.client_page_id);
      if (!local) throw new IntegrityError("SERVER_MANIFEST_MISMATCH", "The server returned a page this device does not have.");
      for (let attempt = 0; ; attempt++) {
        const authorization = authorizations.find((a) => a.source_id === target.source_id);
        if (!authorization) throw new IntegrityError("SERVER_MANIFEST_MISMATCH", "No upload authorization was issued for a pending page.");
        const response = await this.deps.uploader.putFile(
          { url: this.deps.api.resolve(authorization.url), headers: { ...(await this.deps.api.authHeaders()), ...authorization.required_headers } },
          this.store.pageRel(capture, local),
        );
        if (response.status === 200) {
          const body = JSON.parse(response.bodyText) as { sha256: string };
          if (body.sha256 !== local.sha256) throw new IntegrityError("SERVER_HASH_MISMATCH", `The server computed a different hash for page ${local.ordinal}.`);
          break;
        }
        const error = parseApiError(response.status, response.bodyText);
        if (error.code === "UPLOAD_AUTHORIZATION_EXPIRED" && attempt === 0) {
          authorizations = await this.deps.api.authorizeUploads(server.capture_id, targets.map((t) => t.source_id));
          continue;
        }
        throw error;
      }
    }
  }

  private assertServerMatchesLocal(capture: LocalCapture, server: ServerCapture): void {
    if (server.status === "awaiting_upload") throw new IntegrityError("NOT_STORED", "The server did not confirm storage."); // stored or any later processing state
    if (server.pages.length !== capture.pages.length) throw new IntegrityError("SERVER_MANIFEST_MISMATCH", "Page count differs from what was saved.");
    for (const local of capture.pages) {
      const remote = server.pages.find((p) => p.client_page_id === local.clientPageId);
      if (!remote || remote.ordinal !== local.ordinal) throw new IntegrityError("SERVER_MANIFEST_MISMATCH", "Page order differs from what was saved.");
      if (remote.server_sha256 !== local.sha256 || remote.upload_state !== "verified") {
        throw new IntegrityError("SERVER_HASH_MISMATCH", `The server's verified hash for page ${local.ordinal} does not match this device's copy.`);
      }
    }
  }
}

function expectedPages(capture: LocalCapture): ExpectedPage[] {
  return capture.pages.map((p: LocalPage) => ({ source_id: p.sourceId as string, sha256: p.sha256 }));
}
