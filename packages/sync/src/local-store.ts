import type { CaptureManifest } from "@recall/api-client";
import type { Clock, LocalFiles } from "./ports";
import { extensionFor, sniffMediaType } from "./sniff";
import {
  MAX_CAPTURE_BYTES,
  MAX_PAGE_BYTES,
  MAX_PAGES,
  SaveError,
  type LocalCapture,
  type LocalPage,
} from "./types";
import type { DraftPage } from "./draft";

const ROOT = "captures";
const STAGING_PREFIX = ".staging-";
const MANIFEST = "manifest.json";

export interface SaveInput {
  pages: Pick<DraftPage, "uri" | "originalFilename">[];
  contextHint?: string | null;
  ownerUserId: string;
  deviceId: string;
  timezone: string;
}

export interface RecoveryReport {
  captures: LocalCapture[];
  /** Directories whose manifest could not be read. Left untouched; never deleted. */
  unreadable: string[];
  /** Interrupted (never acknowledged) saves that were cleaned up. */
  discardedStaging: string[];
  /** Captures whose private page files are missing or altered. */
  damaged: { operationId: string; reason: string }[];
}

export class LocalCaptureStore {
  constructor(
    private readonly files: LocalFiles,
    private readonly clock: Clock,
    private readonly uuid: () => string,
  ) {}

  private dir = (operationId: string) => `${ROOT}/${operationId}`;
  private manifestPath = (operationId: string) => `${this.dir(operationId)}/${MANIFEST}`;

  /**
   * Durable Save. Success is returned ONLY after:
   *   1. every page's bytes were copied into app-private storage (not left as temp URIs),
   *   2. each copy was re-read and hashed,
   *   3. the ordered manifest (ids, hashes, sizes, order) was written,
   *   4. the staging directory was atomically renamed into place (the single commit point).
   * Anything before step 4 is invisible and cleaned up by `recover()`.
   */
  async save(input: SaveInput): Promise<LocalCapture> {
    const { pages: sources } = input;
    if (!input.ownerUserId) throw new SaveError("STORAGE_FAILED", "Sign in before saving.");
    if (sources.length === 0) throw new SaveError("NO_PAGES", "Add at least one page.");
    if (sources.length > MAX_PAGES) throw new SaveError("TOO_MANY_PAGES", `A capture can have at most ${MAX_PAGES} pages.`);

    const operationId = this.uuid();
    const staging = `${ROOT}/${STAGING_PREFIX}${operationId}`;
    const now = this.clock.now().toISOString();
    try {
      await this.files.ensureDir(`${staging}/pages`);
      const pages: LocalPage[] = [];
      let total = 0;
      for (const [index, source] of sources.entries()) {
        const clientPageId = this.uuid();
        const tempRel = `${staging}/pages/${index + 1}-${clientPageId}.incoming`;
        try {
          await this.files.copyIn(source.uri, tempRel);
        } catch (cause) {
          throw new SaveError("STORAGE_FAILED", `Could not copy page ${index + 1} into app storage: ${describe(cause)}`, index);
        }
        const { sha256, size } = await this.files.sha256(tempRel);
        if (size === 0) throw new SaveError("EMPTY_FILE", `Page ${index + 1} is empty.`, index);
        if (size > MAX_PAGE_BYTES) throw new SaveError("TOO_LARGE", `Page ${index + 1} is larger than 25 MB.`, index);
        total += size;
        if (total > MAX_CAPTURE_BYTES) throw new SaveError("TOO_LARGE", "This capture is larger than 100 MB.", index);
        const mediaType = sniffMediaType(await this.files.readHead(tempRel, 32));
        if (!mediaType) throw new SaveError("UNSUPPORTED_FILE", `Page ${index + 1} is not a supported image (JPEG, PNG, HEIC).`, index);
        const file = `pages/${index + 1}-${clientPageId}.${extensionFor[mediaType]}`;
        await this.files.rename(tempRel, `${staging}/${file}`); // rename within staging gives the final name
        pages.push({
          clientPageId,
          ordinal: index + 1,
          mediaType,
          byteSize: size,
          sha256,
          originalFilename: source.originalFilename,
          file,
        });
      }
      const capture: LocalCapture = {
        schemaVersion: 1,
        operationId,
        ownerUserId: input.ownerUserId,
        deviceId: input.deviceId,
        createdAt: now,
        capturedAt: now,
        timezone: input.timezone,
        sourceKind: "photo_document",
        contextHint: input.contextHint?.trim() ? input.contextHint.trim().slice(0, 2000) : null,
        pages,
        sync: { phase: "pending", attempts: 0, lastError: null },
      };
      await this.files.writeTextAtomic(`${staging}/${MANIFEST}`, JSON.stringify(capture));
      await this.files.rename(staging, this.dir(operationId)); // ---- commit point ----
      return capture;
    } catch (error) {
      await this.files.remove(staging).catch(() => undefined);
      throw error;
    }
  }

  async read(operationId: string): Promise<LocalCapture> {
    return parseManifest(await this.files.readText(this.manifestPath(operationId)));
  }

  /** Read-modify-write the manifest atomically. Callers serialise per capture. */
  async update(operationId: string, change: (current: LocalCapture) => LocalCapture): Promise<LocalCapture> {
    const next = change(await this.read(operationId));
    await this.files.writeTextAtomic(this.manifestPath(operationId), JSON.stringify(next));
    return next;
  }

  /** All captures on this device, or only those saved by `ownerUserId`. */
  async list(ownerUserId?: string): Promise<LocalCapture[]> {
    const report = await this.scan();
    return ownerUserId ? report.captures.filter((c) => c.ownerUserId === ownerUserId) : report.captures;
  }

  /** Startup reconciliation after a crash, force-close, or reboot. Never deletes acknowledged data. */
  async recover(): Promise<RecoveryReport> {
    const discardedStaging: string[] = [];
    for (const name of await this.files.listDir(ROOT)) {
      if (name.startsWith(STAGING_PREFIX)) {
        await this.files.remove(`${ROOT}/${name}`);
        discardedStaging.push(name);
      }
    }
    const scanned = await this.scan();
    const captures: LocalCapture[] = [];
    const damaged: RecoveryReport["damaged"] = [];
    for (const capture of scanned.captures) {
      let repaired = capture;
      // An interrupted upload is not "uploading" any more: it is waiting to be retried.
      if (capture.sync.phase === "in_progress") {
        repaired = await this.update(capture.operationId, (c) => ({ ...c, sync: { ...c.sync, phase: "pending" } }));
      }
      for (const page of repaired.pages) {
        const size = await this.files.size(`${this.dir(repaired.operationId)}/${page.file}`);
        if (size !== page.byteSize) {
          damaged.push({ operationId: repaired.operationId, reason: `page ${page.ordinal} is ${size === null ? "missing" : "the wrong size"}` });
        }
      }
      captures.push(repaired);
    }
    return { captures, unreadable: scanned.unreadable, discardedStaging, damaged };
  }

  private async scan(): Promise<{ captures: LocalCapture[]; unreadable: string[] }> {
    const captures: LocalCapture[] = [];
    const unreadable: string[] = [];
    for (const name of await this.files.listDir(ROOT)) {
      if (name.startsWith(STAGING_PREFIX) || name.startsWith(".")) continue;
      try {
        captures.push(await this.read(name));
      } catch {
        unreadable.push(name);
      }
    }
    captures.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.operationId < b.operationId ? 1 : -1));
    return { captures, unreadable };
  }

  pageRel(capture: LocalCapture, page: LocalPage): string {
    return `${this.dir(capture.operationId)}/${page.file}`;
  }

  pageUri(capture: LocalCapture, page: LocalPage): string {
    return this.files.absoluteUri(this.pageRel(capture, page));
  }
}

export function toManifest(capture: LocalCapture): CaptureManifest {
  return {
    schema_version: "1.0",
    client_capture_id: capture.operationId,
    device_id: capture.deviceId,
    captured_at: capture.capturedAt,
    timezone: capture.timezone,
    source_kind: capture.sourceKind,
    context_hint: capture.contextHint,
    pages: capture.pages.map((p) => ({
      client_page_id: p.clientPageId,
      ordinal: p.ordinal,
      media_type: p.mediaType,
      byte_size: p.byteSize,
      sha256: p.sha256,
      original_filename: p.originalFilename,
    })),
  };
}

function parseManifest(text: string): LocalCapture {
  const value = JSON.parse(text) as LocalCapture;
  if (value.schemaVersion !== 1 || !value.operationId || !Array.isArray(value.pages) || value.pages.length === 0) {
    throw new Error("unrecognised manifest");
  }
  return value;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
