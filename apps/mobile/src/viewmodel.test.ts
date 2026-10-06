import { describe, expect, it } from "vitest";
import type { ServerCapture } from "@recall/api-client";
import type { LocalCapture } from "@recall/sync";
import { mergeRecent } from "./viewmodel";
import { readConfig } from "./config";

const local = (id: string, over: Partial<LocalCapture["sync"]> = {}, hint: string | null = null, at = "2026-10-06T10:00:00Z"): LocalCapture => ({
  schemaVersion: 1, ownerUserId: "u", operationId: id, deviceId: "d", createdAt: at, capturedAt: at, timezone: "UTC", sourceKind: "photo_document", contextHint: hint,
  pages: [{ clientPageId: "p", ordinal: 1, mediaType: "image/jpeg", byteSize: 1, sha256: "a".repeat(64), originalFilename: null, file: "pages/1.jpg" }],
  sync: { phase: "pending", attempts: 0, lastError: null, ...over },
});
const remote = (id: string, client: string, status: ServerCapture["status"], at: string): ServerCapture => ({
  capture_id: id, client_capture_id: client, status, source_kind: "photo_document", captured_at: at, timezone: "UTC", context_hint: null,
  created_at: at, stored_at: null, version: 1, memory_id: null, pages: [],
});

describe("recent captures view model", () => {
  it("uses honest status words: saved locally, uploading, uploaded, failed", () => {
    const rows = mergeRecent(
      [local("a"), local("b"), local("c", { phase: "finalized" }), local("d", { lastError: { code: "NETWORK", message: "Offline.", retryable: true, at: "x" } })],
      [],
      (id) => id === "b",
    );
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.a?.statusLabel).toBe("Saved on this device");
    expect(by.b?.statusLabel).toBe("Uploading");
    expect(by.c?.statusLabel).toBe("Uploaded");
    expect(by.d?.statusLabel).toBe("Failed — retry available");
    expect(by.d?.retryable).toBe(true);
    expect(by.d?.statusDetail).toContain("Still saved on this device");
  });

  it("does not list a capture twice when it is both local and on the server", () => {
    const rows = mergeRecent([local("a", { phase: "finalized" })], [remote("srv1", "a", "stored", "2026-10-06T10:00:00Z"), remote("srv2", "other", "stored", "2026-10-07T10:00:00Z")], () => false);
    expect(rows.map((r) => r.key)).toEqual(["srv2", "a"]);
    expect(rows[0]?.status).toBe("uploaded");
  });

  it("an incomplete capture from another device is not shown as uploaded", () => {
    const rows = mergeRecent([], [remote("srv", "x", "awaiting_upload", "2026-10-06T10:00:00Z")], () => false);
    expect(rows[0]?.status).toBe("incomplete");
  });

  it("titles are the optional hint, never a required field; empty state is empty", () => {
    expect(mergeRecent([local("a", {}, "Standup notes")], [], () => false)[0]?.title).toBe("Standup notes");
    expect(mergeRecent([local("a")], [], () => false)[0]?.title).toBe("Notebook pages");
    expect(mergeRecent([], [], () => false)).toEqual([]);
  });
});

describe("config", () => {
  it("reports exactly what is missing instead of silently running in a fake mode", () => {
    expect(readConfig({})).toEqual({ missing: ["EXPO_PUBLIC_API_BASE_URL", "EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] });
    const ok = readConfig({ EXPO_PUBLIC_API_BASE_URL: "https://api", EXPO_PUBLIC_SUPABASE_URL: "https://s", EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" });
    expect("config" in ok && ok.config.apiBaseUrl).toBe("https://api");
  });
});
