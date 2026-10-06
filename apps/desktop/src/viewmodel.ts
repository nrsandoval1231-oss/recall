import { statusPresentation, type CaptureStatusKey } from "@recall/design-tokens";
import type { ServerCapture } from "@recall/api-client";

/** Server status → the shared user-facing words (same terms as mobile). */
export function serverStatusKey(status: ServerCapture["status"]): CaptureStatusKey {
  return status === "stored" ? "uploaded" : "incomplete";
}

export const statusLabel = (status: ServerCapture["status"]) => statusPresentation[serverStatusKey(status)].label;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export type IntegrityState = { kind: "checking" } | { kind: "verified"; sha256: string } | { kind: "mismatch"; expected: string; actual: string } | { kind: "unverifiable" };
