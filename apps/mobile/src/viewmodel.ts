import { copy, statusPresentation, type CaptureStatusKey } from "@recall/design-tokens";
import type { ServerCapture } from "@recall/api-client";
import { displayStatus, type LocalCapture } from "@recall/sync";

export interface RecentRow {
  key: string;
  /** Local operation id when this device has the capture; the server id otherwise. */
  localId: string | null;
  serverId: string | null;
  title: string;
  pages: number;
  capturedAt: string;
  status: CaptureStatusKey;
  statusLabel: string;
  statusDetail: string;
  retryable: boolean;
}

/** Rows for "Recent": this device's captures first-class, plus captures uploaded from other devices. */
export function mergeRecent(local: LocalCapture[], remote: ServerCapture[], isActive: (operationId: string) => boolean): RecentRow[] {
  const rows: RecentRow[] = local.map((c) => {
    const status = displayStatus(c, isActive(c.operationId));
    const p = statusPresentation[status];
    const failure = c.sync.lastError;
    return {
      key: c.operationId,
      localId: c.operationId,
      serverId: c.sync.serverCaptureId ?? null,
      title: c.contextHint ?? copy.untitled,
      pages: c.pages.length,
      capturedAt: c.capturedAt,
      status,
      statusLabel: p.label,
      statusDetail: status === "failed" && failure ? `${failure.message} ${failure.retryable ? "Still saved on this device." : "Still saved on this device; this needs attention."}` : p.detail,
      retryable: status === "failed" ? (failure?.retryable ?? true) : false,
    };
  });
  const localIds = new Set(local.map((c) => c.operationId));
  for (const c of remote) {
    if (localIds.has(c.client_capture_id)) continue;
    const status: CaptureStatusKey = c.status === "stored" ? "uploaded" : "incomplete";
    rows.push({
      key: c.capture_id,
      localId: null,
      serverId: c.capture_id,
      title: c.context_hint ?? copy.untitled,
      pages: c.pages.length,
      capturedAt: c.captured_at,
      status,
      statusLabel: statusPresentation[status].label,
      statusDetail: statusPresentation[status].detail,
      retryable: false,
    });
  }
  return rows.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : a.capturedAt > b.capturedAt ? -1 : 0));
}
