import { serverStatusKey as tokensServerStatusKey, statusPresentation, type CaptureStatusKey } from "@recall/design-tokens";
import type { ServerCapture } from "@recall/api-client";

/** Server capture → the shared user-facing status (same words as mobile). */
export function serverStatusKey(capture: Pick<ServerCapture, "status" | "processing">): CaptureStatusKey {
  return tokensServerStatusKey(capture.status, capture.processing);
}

export const statusOf = (capture: Pick<ServerCapture, "status" | "processing">) => statusPresentation[serverStatusKey(capture)];

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export type IntegrityState = { kind: "checking" } | { kind: "verified"; sha256: string } | { kind: "mismatch"; expected: string; actual: string } | { kind: "unverifiable" };

export const epistemicLabel: Record<string, string> = {
  reported: "",
  uncertain: "uncertain",
  question: "question",
  confirmed_by_user: "confirmed by you",
  superseded: "superseded",
  retracted: "retracted",
};
