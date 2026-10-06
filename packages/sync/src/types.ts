import type { MediaType, SourceKind } from "@recall/api-client";

export const MAX_PAGES = 10;
export const MAX_PAGE_BYTES = 25 * 1024 * 1024;
export const MAX_CAPTURE_BYTES = 100 * 1024 * 1024;

export interface LocalPage {
  clientPageId: string;
  ordinal: number;
  mediaType: MediaType;
  byteSize: number;
  sha256: string;
  originalFilename: string | null;
  /** Path inside the capture directory, e.g. pages/1-<id>.jpg */
  file: string;
  /** Set once the server has assigned a canonical source id. */
  sourceId?: string;
  /** True once the server confirmed (with its own hash) that it holds these exact bytes. */
  serverConfirmedSha256?: string;
}

export interface LocalFailure {
  code: string;
  message: string;
  retryable: boolean;
  at: string;
}

export type SyncPhase = "pending" | "in_progress" | "finalized";

export interface LocalCapture {
  schemaVersion: 1;
  /** Client-generated UUID. Doubles as client_capture_id and the Idempotency-Key. */
  operationId: string;
  /** Auth user who saved this. A capture is never uploaded under a different account. */
  ownerUserId: string;
  deviceId: string;
  createdAt: string;
  capturedAt: string;
  timezone: string;
  sourceKind: SourceKind;
  contextHint: string | null;
  pages: LocalPage[];
  sync: {
    phase: SyncPhase;
    attempts: number;
    lastError: LocalFailure | null;
    serverCaptureId?: string;
    finalizedAt?: string;
  };
}

export type SaveErrorCode = "NO_PAGES" | "TOO_MANY_PAGES" | "UNSUPPORTED_FILE" | "EMPTY_FILE" | "TOO_LARGE" | "STORAGE_FAILED";

export class SaveError extends Error {
  constructor(
    readonly code: SaveErrorCode,
    message: string,
    readonly pageIndex?: number,
  ) {
    super(message);
    this.name = "SaveError";
  }
}
