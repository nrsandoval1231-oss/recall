import { ApiError, NetworkError } from "./errors";
import type {
  AiSettings,
  AskResponse,
  MemoryDetail,
  MemorySummary,
  ProcessingView,
  SearchResult,
  CaptureList,
  CaptureManifest,
  Device,
  DevicePlatform,
  ExpectedPage,
  Me,
  ServerCapture,
  UploadAuthorization,
} from "./types";

export interface ClientOptions {
  baseUrl: string;
  /** Returns a currently valid access token (the auth provider refreshes it). */
  getAccessToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export interface SourceBytes {
  bytes: ArrayBuffer;
  mediaType: string;
  /** Server-computed SHA-256 advertised by the API. Compare against your own hash of `bytes`. */
  serverSha256: string | null;
}

export class RecallApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  }

  resolve(pathOrUrl: string): string {
    return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
  }

  /** Headers for an authenticated request made by something other than this client (e.g. RN <Image>). */
  async authHeaders(): Promise<Record<string, string>> {
    const token = await this.options.getAccessToken();
    if (!token) throw new ApiError("UNAUTHENTICATED", "Sign in to continue.", 401, false, null);
    return { Authorization: `Bearer ${token}` };
  }

  private async send(method: string, path: string, init: { json?: unknown; headers?: Record<string, string>; body?: BodyInit } = {}): Promise<Response> {
    const headers: Record<string, string> = { ...(await this.authHeaders()), ...init.headers };
    let body: BodyInit | undefined = init.body;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.resolve(path), { method, headers, body });
    } catch (cause) {
      throw new NetworkError("Could not reach Recall. Check your connection.", { cause });
    }
    if (!response.ok) throw await toApiError(response);
    return response;
  }

  private async json<T>(method: string, path: string, init?: Parameters<RecallApiClient["send"]>[2]): Promise<T> {
    return (await (await this.send(method, path, init)).json()) as T;
  }

  me(): Promise<Me> {
    return this.json("GET", "/v1/me");
  }

  registerDevice(device: { device_id: string; platform: DevicePlatform; name?: string | null; app_version?: string | null }): Promise<Device> {
    return this.json("POST", "/v1/devices", { json: device });
  }

  /** `idempotencyKey` must be stable across retries of the same capture (use the capture's UUID). */
  createCapture(manifest: CaptureManifest, idempotencyKey: string): Promise<ServerCapture> {
    return this.json("POST", "/v1/captures", { json: manifest, headers: { "Idempotency-Key": idempotencyKey } });
  }

  listCaptures(params: { limit?: number; cursor?: string | null } = {}): Promise<CaptureList> {
    const query = new URLSearchParams();
    if (params.limit) query.set("limit", String(params.limit));
    if (params.cursor) query.set("cursor", params.cursor);
    const qs = query.toString();
    return this.json("GET", `/v1/captures${qs ? `?${qs}` : ""}`);
  }

  getCapture(captureId: string): Promise<ServerCapture> {
    return this.json("GET", `/v1/captures/${captureId}`);
  }

  async authorizeUploads(captureId: string, sourceIds?: string[]): Promise<UploadAuthorization[]> {
    const result = await this.json<{ authorizations: UploadAuthorization[] }>(
      "POST",
      `/v1/captures/${captureId}/upload-authorizations`,
      sourceIds ? { json: { source_ids: sourceIds } } : {},
    );
    return result.authorizations;
  }

  /** Upload bytes with a server-issued authorization. Mobile uses a native file uploader instead. */
  async putUpload(authorization: UploadAuthorization, body: ArrayBuffer | Uint8Array): Promise<{ sha256: string; byte_size: number }> {
    const response = await this.send("PUT", authorization.url, {
      headers: authorization.required_headers,
      body: body as BodyInit,
    });
    return (await response.json()) as { sha256: string; byte_size: number };
  }

  finalize(captureId: string, expectedPages: ExpectedPage[], idempotencyKey: string): Promise<ServerCapture> {
    return this.json("POST", `/v1/captures/${captureId}/finalize`, {
      json: { expected_pages: expectedPages },
      headers: { "Idempotency-Key": idempotencyKey },
    });
  }

  /** Fetch an original through the authenticated API (no bearer URLs are ever issued). */
  async fetchSource(sourceId: string): Promise<SourceBytes> {
    const response = await this.send("GET", `/v1/sources/${sourceId}/content`);
    return {
      bytes: await response.arrayBuffer(),
      mediaType: response.headers.get("content-type") ?? "application/octet-stream",
      serverSha256: response.headers.get("x-recall-source-sha256"),
    };
  }

  getAiSettings(): Promise<AiSettings> {
    return this.json("GET", "/v1/settings/ai");
  }

  setAiEnabled(enabled: boolean, expectedVersion?: number): Promise<AiSettings> {
    return this.json("PUT", "/v1/settings/ai", { json: { enabled, ...(expectedVersion === undefined ? {} : { expected_version: expectedVersion }) } });
  }

  retryProcessing(captureId: string, idempotencyKey: string): Promise<{ capture_id: string; processing: ProcessingView | null }> {
    return this.json("POST", `/v1/captures/${captureId}/retry-processing`, { headers: { "Idempotency-Key": idempotencyKey } });
  }

  listMemories(params: { limit?: number; cursor?: string | null } = {}): Promise<{ items: MemorySummary[]; next_cursor: string | null }> {
    const query = new URLSearchParams();
    if (params.limit) query.set("limit", String(params.limit));
    if (params.cursor) query.set("cursor", params.cursor);
    const qs = query.toString();
    return this.json("GET", `/v1/memories${qs ? `?${qs}` : ""}`);
  }

  getMemory(memoryId: string): Promise<MemoryDetail> {
    return this.json("GET", `/v1/memories/${memoryId}`);
  }

  search(q: string, limit = 20): Promise<{ query: string; results: SearchResult[] }> {
    return this.json("GET", `/v1/search?${new URLSearchParams({ q, limit: String(limit) }).toString()}`);
  }

  ask(question: string): Promise<AskResponse> {
    return this.json("POST", "/v1/ask", { json: { question } });
  }

  sourceRequest(sourceId: string): { url: string } {
    return { url: this.resolve(`/v1/sources/${sourceId}/content`) };
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string; retryable?: boolean; request_id?: string; details?: Record<string, unknown> } };
    const e = body.error;
    if (e?.code) return new ApiError(e.code, e.message ?? "Request failed.", response.status, e.retryable ?? false, e.request_id ?? null, e.details);
  } catch {
    /* fall through: non-JSON error body (proxy, gateway) */
  }
  return new ApiError("HTTP_ERROR", `Request failed (${response.status}).`, response.status, response.status >= 500, null);
}
