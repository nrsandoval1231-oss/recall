/** Stable machine codes from docs/API-CONTRACT.md, plus the transport-level failure. */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId: string | null,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The request never produced an HTTP response (offline, DNS, reset, timeout). Always retryable. */
export class NetworkError extends Error {
  readonly retryable = true;
  constructor(message = "Network unavailable.", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NetworkError";
  }
}

export interface FailureSummary {
  code: string;
  message: string;
  retryable: boolean;
}

/** Classify any thrown value into something safe to persist and show. */
export function summarizeFailure(err: unknown): FailureSummary {
  if (err instanceof ApiError) {
    // 401 is recoverable by signing in again; the local capture is untouched either way.
    const retryable = err.retryable || err.code === "UNAUTHENTICATED" || err.code === "UPLOAD_AUTHORIZATION_EXPIRED";
    return { code: err.code, message: err.message, retryable };
  }
  if (err instanceof NetworkError) return { code: "NETWORK", message: err.message, retryable: true };
  const message = err instanceof Error ? err.message : "Unexpected error.";
  return { code: "UNEXPECTED", message, retryable: true };
}

/** Build an ApiError from a raw HTTP error response (used by native uploaders that bypass fetch). */
export function parseApiError(status: number, bodyText: string): ApiError {
  try {
    const e = (JSON.parse(bodyText) as { error?: { code?: string; message?: string; retryable?: boolean; request_id?: string; details?: Record<string, unknown> } }).error;
    if (e?.code) return new ApiError(e.code, e.message ?? "Request failed.", status, e.retryable ?? false, e.request_id ?? null, e.details);
  } catch {
    /* non-JSON body */
  }
  return new ApiError("HTTP_ERROR", `Request failed (${status}).`, status, status >= 500, null);
}
