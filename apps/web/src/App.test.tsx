// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { BrowserAuth, BrowserSession } from "./auth/session";
import type { Draft } from "./storage";
import type { RecallApiClient } from "@recall/api-client";

const storage = vi.hoisted(() => ({ clearDrafts: vi.fn(async () => undefined), deleteDraft: vi.fn(async () => undefined), draftPage: vi.fn(), listDrafts: vi.fn<(scope: string) => Promise<Draft[]>>(async (_scope) => []), saveDraft: vi.fn(async () => undefined) }));
vi.mock("./storage", () => storage);

const session = (userId: string, workspaceId: string): BrowserSession => ({ userId, workspaceId, email: "pilot@example.com" });
const pendingDraft: Draft = { id: "draft-1", scope: "u1:w1", savedAt: "2026-10-07T00:00:00Z", manifest: { schema_version: "1.0", client_capture_id: "draft-1", device_id: "device", captured_at: "2026-10-07T00:00:00Z", timezone: "UTC", source_kind: "handwritten_note", context_hint: "pending note", pages: [{ client_page_id: "page-1", ordinal: 1, media_type: "image/png", byte_size: 3, sha256: "abc", original_filename: "note.png" }] }, files: { "page-1": new Blob(["abc"], { type: "image/png" }) } };
const capture = { capture_id: "cap-1", client_capture_id: "cap-1", status: "stored", source_kind: "handwritten_note", captured_at: "2026-10-07T00:00:00Z", timezone: "UTC", context_hint: "source note", created_at: "2026-10-07T00:00:00Z", stored_at: "2026-10-07T00:00:00Z", version: 1, memory_id: null, processing: null, pages: [{ source_id: "source-1", client_page_id: "page-1", ordinal: 1, media_type: "image/png", byte_size: 3, declared_sha256: "abc", server_sha256: "abc", upload_state: "verified", original_filename: "note.png" }] };

function makeAuth(initial: BrowserSession | null): BrowserAuth & { emit: (value: BrowserSession | null) => void } {
  let listener: ((value: BrowserSession | null) => void) | undefined;
  return { getSession: vi.fn(async () => initial), requestSignIn: vi.fn(async () => undefined), signOut: vi.fn(async () => undefined), onChange: (callback) => { listener = callback; return () => { listener = undefined; }; }, emit: (value) => listener?.(value) };
}
function makeApi(overrides: Partial<Record<keyof RecallApiClient, unknown>> = {}): RecallApiClient {
  return { me: vi.fn(async () => ({ user_id: "u1", email: "pilot@example.com", workspaces: [{ id: "w1", name: "Pilot", role: "owner" }], active_workspace_id: "w1", capabilities: {} as never, config: {} as never })), listCaptures: vi.fn(async () => ({ items: [], next_cursor: null })), getAiSettings: vi.fn(async () => ({ ai_configured: false, provider: null, policy_version: "v1", enabled: false, consent_outdated: false, decided_at: null, version: 1, explanation: "" })), registerDevice: vi.fn(async () => ({})), createCapture: vi.fn(), authorizeUploads: vi.fn(), putUpload: vi.fn(), finalize: vi.fn(), fetchSource: vi.fn(), ...overrides } as unknown as RecallApiClient;
}

beforeEach(() => { vi.clearAllMocks(); storage.listDrafts.mockResolvedValue([]); storage.draftPage.mockImplementation((scope: string, manifest: Draft["manifest"], page: Draft["manifest"]["pages"][number], file: Blob) => ({ id: manifest.client_capture_id, scope, manifest, files: { [page.client_page_id]: file }, savedAt: "2026-10-07T00:00:00Z" })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("web capture privacy and source boundary", () => {
  it("shows sign-in without invoking private API reads while signed out", async () => { const auth = makeAuth(null); const api = {} as RecallApiClient; render(<App services={{ auth, api }} />); expect(await screen.findByText("Keep what matters.")).toBeTruthy(); });
  it("disables sign out while the durable original is uploading", async () => {
    const auth = makeAuth(session("u1", "w1")); let release: (() => void) | undefined; const api = makeApi({ createCapture: vi.fn(() => new Promise(() => { release = () => undefined; })) }); render(<App services={{ auth, api }} />); await screen.findByText("Choose a photo of your note"); const input = document.getElementById("capture-file")!; fireEvent.change(input, { target: { files: [Object.assign(new File(["abc"], "note.png", { type: "image/png" }), { arrayBuffer: async () => new TextEncoder().encode("abc").buffer })] } }); fireEvent.click(screen.getByRole("button", { name: "Save original" })); await waitFor(() => expect((screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(true)); expect(storage.saveDraft.mock.invocationCallOrder[0]).toBeLessThan((api.createCapture as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? Infinity); release?.(); });
  it("retains pending drafts across logout and hides them from another workspace", async () => {
    const auth = makeAuth(session("u1", "w1")); storage.listDrafts.mockImplementation(async (scope: string) => scope === "u1:w1" ? [pendingDraft] : []); const api = makeApi(); render(<App services={{ auth, api }} />); expect(await screen.findByText("pending note")).toBeTruthy(); auth.emit(null); await screen.findByText("Keep what matters."); expect(storage.clearDrafts).not.toHaveBeenCalled(); auth.emit(session("u2", "w2")); await waitFor(() => expect(screen.queryByText("pending note")).toBeNull()); expect(storage.clearDrafts).not.toHaveBeenCalled(); });
  it("refuses to display an original when the server hash header is absent", async () => {
    const auth = makeAuth(session("u1", "w1")); const api = makeApi({ listCaptures: vi.fn(async () => ({ items: [capture], next_cursor: null })), fetchSource: vi.fn(async () => ({ bytes: new Uint8Array([97, 98, 99]).buffer, mediaType: "image/png", serverSha256: null })) }); render(<App services={{ auth, api }} />); const row = await screen.findByRole("button", { name: /source note/ }); fireEvent.click(row); expect(await screen.findByText("Original integrity hash unavailable.")).toBeTruthy(); expect(screen.queryByAltText("Original note")).toBeNull(); });
  it("removes a pending original only after explicit confirmation", async () => {
    const auth = makeAuth(session("u1", "w1")); let removed = false; storage.listDrafts.mockImplementation(async (scope: string) => scope === "u1:w1" && !removed ? [pendingDraft] : []); storage.deleteDraft.mockImplementation(async () => { removed = true; }); vi.spyOn(window, "confirm").mockReturnValue(true); const api = makeApi(); render(<App services={{ auth, api }} />); expect(await screen.findByText("pending note")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Remove" })); await waitFor(() => expect(screen.queryByText("pending note")).toBeNull()); expect(storage.deleteDraft).toHaveBeenCalledWith("draft-1");
  });

  it("shows the provider rate limit and prevents a second request", async () => {
    sessionStorage.clear(); const auth = makeAuth(null); auth.requestSignIn = vi.fn(async () => { throw new Error("EMAIL_RATE_LIMITED"); }); const api = {} as RecallApiClient; render(<App services={{ auth, api }} />); await screen.findByText("Keep what matters."); fireEvent.change(screen.getByLabelText("Email"), { target: { value: "pilot@example.com" } }); fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" })); expect(await screen.findByText(/Email sign-in is temporarily limited/)).toBeTruthy(); expect(auth.requestSignIn).toHaveBeenCalledTimes(1); expect((screen.getByRole("button", { name: /temporarily limited/ }) as HTMLButtonElement).disabled).toBe(true);
  });

});
