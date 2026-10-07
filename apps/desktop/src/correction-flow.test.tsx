// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError, type MemoryDetail, type ServerCapture } from "@recall/api-client";
import { assertNativeExportSize } from "./platform/native-cache";
import { Library } from "./components/Library";
import { managedExportNotice } from "./App";
import { Ask } from "./components/Ask";
import { MemoryPanel } from "./components/MemoryPanel";
import { Viewer } from "./components/Viewer";

beforeAll(() => { if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, "crypto", { value: webcrypto }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const memory = (): MemoryDetail => ({ memory_id: "00000000-0000-0000-0000-000000000001", capture_id: "00000000-0000-0000-0000-000000000002", revision: 2, status: "ready", summary: "x", context_hint: null, page_count: 1, model_id: "m", created_at: "2026-01-01T00:00:00Z", captured_at: "2026-01-01T00:00:00Z", timezone: "UTC", processor_version: "p", revised_at: "2026-01-01T00:00:00Z", interpretation: { summary: "x", summary_evidence: [], pages: [{ page_id: "00000000-0000-0000-0000-000000000003", ordinal: 1, transcription: "note", legibility: "clear" }], mentions: [], statements: [], action_suggestions: [], uncertainties: [] }, validation_notes: [], labels: { transcription: "read", action_suggestions: "suggestions" }, claims: [{ claim_id: "00000000-0000-0000-0000-000000000004", memory_id: "00000000-0000-0000-0000-000000000001", text: "Claim", kind: "observation", epistemic_state: "reported", temporal_text: null, valid_from: null, valid_to: null, evidence: [], version: 1 }], mentions: [{ mention_id: "00000000-0000-0000-0000-000000000005", text: "Sam", kind: "person", entity_id: "00000000-0000-0000-0000-000000000006", resolution: "unresolved", evidence: [], version: 1 }] });
const cache = (enqueue = vi.fn<(scope: unknown, command: unknown) => Promise<void>>()) => ({ available: true, enqueue, getRecord: vi.fn(), pending: vi.fn() }) as unknown as import("./platform/native-cache").NativeCache;

describe("desktop correction and destructive flow regressions", () => {
  it("queues an offline correction before the API attempt and preserves the operation", async () => {
    const enqueue = vi.fn(async () => undefined); const correctMemory = vi.fn(async () => { throw new Error("offline"); }); const current = memory();
    render(<MemoryPanel api={{ getMemory: vi.fn(async () => current), correctMemory }} memoryId={current.memory_id} pageId="00000000-0000-0000-0000-000000000003" cache={cache(enqueue)} scope={{ user_id: "00000000-0000-0000-0000-000000000007", workspace_id: "00000000-0000-0000-0000-000000000008" }} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Correct" })); await userEvent.setup().click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(correctMemory).toHaveBeenCalled());
    expect(enqueue).toHaveBeenCalledBefore(correctMemory);
    const queued = enqueue.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(queued[1]).toMatchObject({ kind: "memory.correction", target_id: current.memory_id, expected_version: 2 });
  });

  it("shows a version conflict without discarding the correction", async () => {
    const enqueue = vi.fn(async () => undefined); const correctMemory = vi.fn(async () => { throw new ApiError("VERSION_CONFLICT", "changed", 409, false, null); }); const current = memory();
    render(<MemoryPanel api={{ getMemory: vi.fn(async () => current), correctMemory }} memoryId={current.memory_id} pageId="00000000-0000-0000-0000-000000000003" cache={cache(enqueue)} scope={{ user_id: "00000000-0000-0000-0000-000000000007", workspace_id: "00000000-0000-0000-0000-000000000008" }} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Correct" })); await userEvent.setup().click(screen.getByRole("button", { name: "Save correction" }));
    expect(await screen.findByText(/changed elsewhere/)).toBeTruthy(); expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("sends mention rejection and claim status/date fields in guarded corrections", async () => {
    const correctMemory = vi.fn(async () => memory()); const current = memory(); const user = userEvent.setup();
    render(<MemoryPanel api={{ getMemory: vi.fn(async () => current), correctMemory }} memoryId={current.memory_id} pageId="00000000-0000-0000-0000-000000000003" />);
    await user.click((await screen.findAllByRole("button", { name: "Reject identity" }))[0]!);
    expect(correctMemory).toHaveBeenCalledWith(current.memory_id, expect.objectContaining({ target: "mention_identity", resolution: "rejected", mention_id: "00000000-0000-0000-0000-000000000005" }), expect.any(String), 2);
    await user.click(screen.getByRole("button", { name: "Correct" }));
    await user.selectOptions(screen.getByLabelText("Status"), "confirmed_by_user"); await user.type(screen.getAllByPlaceholderText("RFC 3339 timestamp")[0]!, "2026-01-01T00:00:00Z"); await user.click(screen.getByRole("button", { name: "Save correction" }));
    expect(correctMemory).toHaveBeenLastCalledWith(current.memory_id, expect.objectContaining({ epistemic_state: "confirmed_by_user", valid_from: "2026-01-01T00:00:00Z" }), expect.any(String), 2);
  });

  it("does not delete a capture until confirmation", async () => {
    const deleteCapture = vi.fn(); const capture = { capture_id: "00000000-0000-0000-0000-000000000009", context_hint: "x", status: "ready", version: 3, captured_at: "2026-01-01T00:00:00Z", timezone: "UTC", pages: [], source_kind: "photo_document", client_capture_id: "c", created_at: "2026-01-01T00:00:00Z", stored_at: null, memory_id: null, processing: null } as unknown as ServerCapture;
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Viewer api={{ fetchSource: vi.fn(), getMemory: vi.fn(), retryProcessing: vi.fn(), deleteCapture }} capture={capture} onClose={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Delete capture" })); expect(deleteCapture).not.toHaveBeenCalled();
  });

  it("preserves managed Markdown conflict messaging and guards oversized native exports", () => {
    expect(managedExportNotice({ written: [], conflicts: [{ record_id: "id", reason: "locally edited" }] })).toContain("1 Markdown conflict");
    expect(() => assertNativeExportSize(new ArrayBuffer(32 * 1024 * 1024 + 1))).toThrow(/32 MiB/);
  });

  it("does not fall back to cached Library entities after authorization denial", async () => {
    const listEntities = vi.fn(async () => { throw new ApiError("FORBIDDEN", "denied", 403, false, null); });
    const listRecords = vi.fn(async () => []);
    render(<Library api={{ listEntities, getEntity: vi.fn() }} cache={{ available: true, listRecords } as never} scope={{ user_id: "u", workspace_id: "w" }} onClose={vi.fn()} />);
    expect(await screen.findByText(/no longer has access/i)).toBeTruthy();
    expect(listRecords).not.toHaveBeenCalled();
  });

  it("never loads cached interpretations after authorization denial", async () => {
    const getRecord = vi.fn(async () => ({ payload: memory() }));
    render(<MemoryPanel api={{ getMemory: vi.fn(async () => { throw new ApiError("FORBIDDEN", "denied", 403, false, null); }) }} memoryId="m" pageId={undefined} cache={{ available: true, getRecord } as never} scope={{ user_id: "u", workspace_id: "w" }} />);
    expect(await screen.findByText(/couldn't be loaded/i)).toBeTruthy();
    expect(getRecord).not.toHaveBeenCalled();
    expect(screen.queryByText("Claim")).toBeNull();
  });

  it("does not claim a correction is saved when durable enqueue fails", async () => {
    const current = memory(); const correctMemory = vi.fn();
    render(<MemoryPanel api={{ getMemory: vi.fn(async () => current), correctMemory }} memoryId={current.memory_id} pageId={undefined} cache={cache(vi.fn(async () => { throw new Error("disk full"); }))} scope={{ user_id: "u", workspace_id: "w" }} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Correct" }));
    await user.click(screen.getByRole("button", { name: "Save correction" }));
    expect(await screen.findByText(/storage is unavailable/i)).toBeTruthy();
    expect(correctMemory).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved locally/i)).toBeNull();
  });

  it("sends the optional historical As of date and never falls back on Ask authorization denial", async () => {
    const ask = vi.fn(async () => { throw new ApiError("FORBIDDEN", "denied", 403, false, null); }); const search = vi.fn(async () => []); const user = userEvent.setup();
    render(<Ask api={{ ask }} cache={{ available: true, search } as never} scope={{ user_id: "u", workspace_id: "w" }} onOpenCitation={vi.fn()} />);
    await user.type(screen.getByLabelText("What are you trying to remember?"), "what happened?"); await user.type(screen.getByLabelText("As of date"), "2026-01-15"); await user.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(ask).toHaveBeenCalledWith("what happened?", { as_of: "2026-01-15T23:59:59.000Z" }));
    expect(search).not.toHaveBeenCalled(); expect(await screen.findByText(/no longer has access/i)).toBeTruthy();
  });
});


