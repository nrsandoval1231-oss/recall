import { describe, expect, it } from "vitest";
import { color, contrastRatio, statusPresentation, toneColor } from "./index";

describe("design tokens", () => {
  it("body text and status colors meet WCAG AA (4.5:1) on the paper background", () => {
    expect(contrastRatio(color.ink, color.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.inkMuted, color.paper)).toBeGreaterThanOrEqual(4.5);
    for (const tone of Object.values(toneColor)) {
      expect(contrastRatio(tone, color.paper)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(color.accentText, color.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("every status has a text label and a non-color glyph, and labels are distinct", () => {
    const labels = Object.values(statusPresentation).map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const s of Object.values(statusPresentation)) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.glyph.length).toBeGreaterThan(0);
    }
  });

  it("maps every server state to an honest status (never 'ready' before reading finishes)", async () => {
    const { serverStatusKey } = await import("./index");
    expect(serverStatusKey("awaiting_upload", null)).toBe("incomplete");
    expect(serverStatusKey("stored", null)).toBe("uploaded");
    expect(serverStatusKey("stored", { state: "queued" })).toBe("queued");
    expect(serverStatusKey("stored", { state: "cancelled" })).toBe("paused");
    expect(serverStatusKey("stored", { state: "queued", blocked_reason: "budget_exhausted" })).toBe("paused");
    expect(serverStatusKey("processing", { state: "retrying", blocked_reason: "budget_exhausted" })).toBe("paused");
    expect(serverStatusKey("processing", { state: "running" })).toBe("processing");
    expect(serverStatusKey("ready", { state: "succeeded" })).toBe("ready");
    expect(serverStatusKey("needs_review", null)).toBe("needs_review");
    expect(serverStatusKey("failed", { state: "failed" })).toBe("processing_failed");
    expect(statusPresentation.processing_failed.label).toMatch(/original is safe/);
  });

  it("uses the contract's honest terminology", () => {
    expect(statusPresentation.saved_locally.label).toBe("Saved on this device");
    expect(statusPresentation.uploading.label).toBe("Uploading");
    expect(statusPresentation.uploaded.label).toBe("Uploaded");
    expect(statusPresentation.failed.label).toMatch(/^Failed/);
  });
});
