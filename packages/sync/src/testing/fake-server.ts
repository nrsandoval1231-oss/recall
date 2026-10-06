/**
 * In-memory stand-in for the Recall API, used ONLY for fast unit tests of the client engine's
 * retry/idempotency behaviour with failure injection. It computes real SHA-256s from real bytes.
 * Server correctness is established separately: services/backend tests + tests/e2e (real server).
 */
import { ApiError, NetworkError, type ExpectedPage, type ServerCapture, type UploadAuthorization, type CaptureManifest } from "@recall/api-client";
import type { FileUploader, LocalFiles } from "../ports";
import type { SyncApi } from "../syncer";

interface Page { source_id: string; m: CaptureManifest["pages"][number]; received: string | null; verified: boolean }
interface Cap { id: string; manifest: CaptureManifest; pages: Page[]; stored: boolean; digest: string }

export class FakeServer implements SyncApi, FileUploader {
  captures = new Map<string, Cap>();
  puts = 0;
  creates = 0;
  finalizes = 0;
  objects = new Map<string, Buffer>();
  /** Set to make the next call of that kind do its work and THEN fail (a lost acknowledgement). */
  loseAckOnce = new Set<"create" | "finalize" | "put">();
  /** Set to fail the next call of that kind BEFORE doing any work (offline / refused). */
  failOnce = new Map<"create" | "finalize" | "put" | "authorize", () => Error>();
  expireNextAuthorization = false;
  online = true;
  tokenValid = true;
  onPut?: (n: number, rel: string) => void | Promise<void>;
  /** Server-side tamper hook for hash-mismatch tests. */
  corruptOnReceive = false;
  /** What a stored capture reports (RCL-002 can move it on to processing/ready/... after finalize). */
  storedStatus: "stored" | "processing" | "ready" | "needs_review" | "failed" = "stored";
  private next = 0;
  private ids = new Map<string, string>();

  constructor(private readonly files: LocalFiles) {}

  private id(name: string) {
    if (!this.ids.has(name)) this.ids.set(name, `00000000-0000-4000-8000-${String(++this.next).padStart(12, "0")}`);
    return this.ids.get(name) as string;
  }
  private gate(kind: "create" | "finalize" | "put" | "authorize") {
    if (!this.online) throw new NetworkError("offline");
    if (!this.tokenValid) throw new ApiError("UNAUTHENTICATED", "Sign in again.", 401, false, null);
    const f = this.failOnce.get(kind);
    if (f) {
      this.failOnce.delete(kind);
      throw f();
    }
  }
  private view(c: Cap): ServerCapture {
    return {
      capture_id: c.id, client_capture_id: c.manifest.client_capture_id, status: c.stored ? this.storedStatus : "awaiting_upload",
      source_kind: c.manifest.source_kind, captured_at: c.manifest.captured_at, timezone: c.manifest.timezone,
      context_hint: c.manifest.context_hint, created_at: "2026-10-06T00:00:00Z", stored_at: c.stored ? "2026-10-06T00:00:01Z" : null,
      version: c.stored ? 2 : 1, memory_id: null, processing: null,
      pages: c.pages.map((p) => ({
        source_id: p.source_id, client_page_id: p.m.client_page_id, ordinal: p.m.ordinal, media_type: p.m.media_type,
        byte_size: p.m.byte_size, declared_sha256: p.m.sha256, server_sha256: p.received,
        upload_state: p.verified ? "verified" : p.received ? "received" : "pending", original_filename: p.m.original_filename,
      })),
    };
  }
  private lose(kind: "create" | "finalize" | "put") {
    if (this.loseAckOnce.delete(kind)) throw new NetworkError("connection reset after the server processed the request");
  }

  async createCapture(manifest: CaptureManifest, key: string): Promise<ServerCapture> {
    this.gate("create");
    this.creates++;
    const digest = JSON.stringify(manifest);
    let cap = this.captures.get(key);
    if (cap && cap.digest !== digest) throw new ApiError("IDEMPOTENCY_CONFLICT", "conflict", 409, false, null);
    if (!cap) {
      cap = { id: this.id(`cap:${key}`), manifest, digest, stored: false, pages: manifest.pages.map((m) => ({ source_id: this.id(`src:${m.client_page_id}`), m, received: null, verified: false })) };
      this.captures.set(key, cap);
    }
    this.lose("create");
    return this.view(cap);
  }

  async authorizeUploads(captureId: string, sourceIds?: string[]): Promise<UploadAuthorization[]> {
    this.gate("authorize");
    const cap = [...this.captures.values()].find((c) => c.id === captureId);
    if (!cap) throw new ApiError("NOT_FOUND", "nf", 404, false, null);
    const expired = this.expireNextAuthorization;
    this.expireNextAuthorization = false;
    return cap.pages.filter((p) => !p.verified && (!sourceIds || sourceIds.includes(p.source_id))).map((p) => ({
      source_id: p.source_id, method: "PUT" as const, url: `/v1/uploads/${expired ? "EXPIRED" : "ok"}.${p.source_id}`,
      expires_at: "2099-01-01T00:00:00Z", required_headers: { "Content-Type": p.m.media_type }, max_bytes: p.m.byte_size,
    }));
  }

  async putFile(request: { url: string; headers: Record<string, string> }, rel: string) {
    this.gate("put");
    this.puts++;
    await this.onPut?.(this.puts, rel);
    const [state, sourceId] = request.url.split("/v1/uploads/")[1]!.split(".") as [string, string];
    if (state === "EXPIRED") return { status: 403, bodyText: JSON.stringify({ error: { code: "UPLOAD_AUTHORIZATION_EXPIRED", message: "expired", retryable: true, request_id: "r" } }) };
    const page = [...this.captures.values()].flatMap((c) => c.pages).find((p) => p.source_id === sourceId)!;
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(this.files.absoluteUri(rel));
    const { createHash } = await import("node:crypto");
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== page.m.sha256) return { status: 422, bodyText: JSON.stringify({ error: { code: "HASH_MISMATCH", message: "mismatch", retryable: false, request_id: "r" } }) };
    page.received = this.corruptOnReceive ? "f".repeat(64) : actual;
    this.objects.set(sourceId, bytes);
    this.lose("put");
    return { status: 200, bodyText: JSON.stringify({ source_id: sourceId, sha256: page.received, byte_size: bytes.length }) };
  }

  async finalize(captureId: string, expected: ExpectedPage[], _key: string): Promise<ServerCapture> {
    this.gate("finalize");
    this.finalizes++;
    const cap = [...this.captures.values()].find((c) => c.id === captureId)!;
    const missing = cap.pages.filter((p) => !p.received || !this.objects.has(p.source_id)).map((p) => p.source_id);
    if (!cap.stored && missing.length) throw new ApiError("UPLOAD_INCOMPLETE", "incomplete", 409, true, null, { missing_source_ids: missing });
    for (const e of expected) if (cap.pages.find((p) => p.source_id === e.source_id)?.received !== e.sha256 && !this.corruptOnReceive) throw new ApiError("HASH_MISMATCH", "hash", 422, false, null);
    cap.pages.forEach((p) => (p.verified = true));
    cap.stored = true;
    this.lose("finalize");
    return this.view(cap);
  }

  async authHeaders() {
    return { Authorization: "Bearer test" };
  }
  resolve(p: string) {
    return p;
  }
}
