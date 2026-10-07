// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError, type Action } from "@recall/api-client";
import { Review } from "./Review";

beforeAll(() => { if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, "crypto", { value: webcrypto }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const action = (status: Action["status"]): Action => ({ action_id: "00000000-0000-0000-0000-000000000001", memory_id: "00000000-0000-0000-0000-000000000002", kind: "action", text: "Send the follow-up", due_text: null, status, version: 4, evidence: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
const scope = { user_id: "00000000-0000-0000-0000-000000000003", workspace_id: "00000000-0000-0000-0000-000000000004" };

describe("Review action lifecycle", () => {
  it("queues completion before the API and supports reopening", async () => {
    let current = action("open"); const enqueue = vi.fn<(scope: unknown, command: unknown) => Promise<void>>(async () => undefined); const updateAction = vi.fn(async (_id: string, update: { status?: Action["status"] }) => (current = { ...current, ...update, version: current.version + 1 }));
    const api = { listActions: vi.fn(async () => ({ items: [current], next_cursor: null })), updateAction };
    render(<Review api={api} cache={{ available: true, enqueue, listRecords: vi.fn() } as never} scope={scope} onClose={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(updateAction).toHaveBeenCalled());
    expect(enqueue).toHaveBeenCalledBefore(updateAction);
    expect(enqueue.mock.calls[0]?.[1]).toMatchObject({ kind: "action.update", target_id: current.action_id, expected_version: 4, payload: { status: "done" } });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Reopen" }));
    expect(enqueue.mock.calls[1]?.[1]).toMatchObject({ payload: { status: "open" }, expected_version: 5 });
  });

  it("does not use cached Review after authorization denial", async () => {
    const listRecords = vi.fn(async () => [{ kind: "action", record_id: "x", version: 1, deleted: false, payload: action("open") }]);
    const listActions = vi.fn(async () => { throw new ApiError("FORBIDDEN", "denied", 403, false, null); });
    render(<Review api={{ listActions, updateAction: vi.fn() }} cache={{ available: true, listRecords } as never} scope={scope} onClose={vi.fn()} />);
    expect(await screen.findByText(/no longer has access/i)).toBeTruthy();
    expect(listRecords).not.toHaveBeenCalled();
  });

  it("does not claim an action was saved when durable enqueue fails", async () => {
    const current = action("open"); const updateAction = vi.fn(); const enqueue = vi.fn(async () => { throw new Error("native unavailable"); });
    render(<Review api={{ listActions: vi.fn(async () => ({ items: [current], next_cursor: null })), updateAction }} cache={{ available: true, enqueue } as never} scope={scope} onClose={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Mark done" }));
    expect(updateAction).not.toHaveBeenCalled(); expect(await screen.findByText(/offline action storage is unavailable/i)).toBeTruthy();
  });
});
