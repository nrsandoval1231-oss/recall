// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { BrowserAuth, BrowserSession } from "./auth/session";
import type { Draft } from "./storage";
import type { AskResponse, RecallApiClient } from "@recall/api-client";

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
  it("shows device connection without invoking private API reads while disconnected", async () => { const auth = makeAuth(null); const api = {} as RecallApiClient; render(<App services={{ auth, api }} />); expect(await screen.findByText("Connect this device.")).toBeTruthy(); });
  it("disables sign out while the durable original is uploading", async () => {
    const auth = makeAuth(session("u1", "w1")); let release: (() => void) | undefined; const api = makeApi({ createCapture: vi.fn(() => new Promise(() => { release = () => undefined; })) }); render(<App services={{ auth, api }} />); fireEvent.click(await screen.findByRole("button", { name: /^Capture$/ })); await screen.findByText("Choose a photo of your note"); const input = document.getElementById("capture-file")!; fireEvent.change(input, { target: { files: [Object.assign(new File(["abc"], "note.png", { type: "image/png" }), { arrayBuffer: async () => new TextEncoder().encode("abc").buffer })] } }); fireEvent.click(screen.getByRole("button", { name: "Save original" })); fireEvent.click(screen.getByRole("button", { name: "Settings" })); await waitFor(() => expect((screen.getByRole("button", { name: "Disconnect this device" }) as HTMLButtonElement).disabled).toBe(true)); expect(storage.saveDraft.mock.invocationCallOrder[0]).toBeLessThan((api.createCapture as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? Infinity); release?.(); });
  it("opens a remembered session directly without the connection form", async () => { const auth = makeAuth(session("u1", "w1")); const api = makeApi(); render(<App services={{ auth, api }} />); expect(await screen.findByLabelText("What are you trying to remember?")).toBeTruthy(); expect(screen.queryByText("Connect this device.")).toBeNull(); expect(auth.requestSignIn).not.toHaveBeenCalled(); });
  it("retains pending drafts across logout and hides them from another workspace", async () => {
    const auth = makeAuth(session("u1", "w1")); storage.listDrafts.mockImplementation(async (scope: string) => scope === "u1:w1" ? [pendingDraft] : []); const api = makeApi(); render(<App services={{ auth, api }} />); fireEvent.click(await screen.findByRole("button", { name: /^Capture$/ })); expect(await screen.findByText("pending note")).toBeTruthy(); auth.emit(null); await screen.findByText("Connect this device."); expect(storage.clearDrafts).not.toHaveBeenCalled(); auth.emit(session("u2", "w2")); await waitFor(() => expect(screen.queryByText("pending note")).toBeNull()); expect(storage.clearDrafts).not.toHaveBeenCalled(); });
  it("refuses to display an original when the server hash header is absent", async () => {
    const auth = makeAuth(session("u1", "w1")); const api = makeApi({ listCaptures: vi.fn(async () => ({ items: [capture], next_cursor: null })), fetchSource: vi.fn(async () => ({ bytes: new Uint8Array([97, 98, 99]).buffer, mediaType: "image/png", serverSha256: null })) }); render(<App services={{ auth, api }} />); fireEvent.click(await screen.findByRole("button", { name: /Explore/ })); const row = await screen.findByRole("button", { name: /source note/ }); fireEvent.click(row); expect(await screen.findByText("Original integrity hash unavailable.")).toBeTruthy(); expect(screen.queryByAltText("Original note")).toBeNull(); });
  it("removes a pending original only after explicit confirmation", async () => {
    const auth = makeAuth(session("u1", "w1")); let removed = false; storage.listDrafts.mockImplementation(async (scope: string) => scope === "u1:w1" && !removed ? [pendingDraft] : []); storage.deleteDraft.mockImplementation(async () => { removed = true; }); vi.spyOn(window, "confirm").mockReturnValue(true); const api = makeApi(); render(<App services={{ auth, api }} />); fireEvent.click(await screen.findByRole("button", { name: /^Capture$/ })); expect(await screen.findByText("pending note")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Remove" })); await waitFor(() => expect(screen.queryByText("pending note")).toBeNull()); expect(storage.deleteDraft).toHaveBeenCalledWith("draft-1");
  });

  it("shows the provider rate limit and prevents a second request", async () => {
    sessionStorage.clear(); const auth = makeAuth(null); auth.requestSignIn = vi.fn(async () => { throw new Error("EMAIL_RATE_LIMITED"); }); const api = {} as RecallApiClient; render(<App services={{ auth, api }} />); await screen.findByText("Connect this device."); fireEvent.change(screen.getByLabelText("Owner email"), { target: { value: "pilot@example.com" } }); fireEvent.click(screen.getByRole("button", { name: "Email me a connection link" })); expect(await screen.findByText(/Device connection is temporarily limited/)).toBeTruthy(); expect(auth.requestSignIn).toHaveBeenCalledTimes(1); expect((screen.getByRole("button", { name: /temporarily limited/ }) as HTMLButtonElement).disabled).toBe(true);
  });

});

const groundedAnswer: AskResponse = {
  question: "Where was the café?", status: "answered", answer: "The synthetic note says Lisbon.", sentences: [],
  citations: [{ citation_id: "citation-1", memory_id: "memory-1", memory_revision: 1, capture_id: "cap-1", source_id: "source-1", page: 2, quote: "Café in Lisbon?", captured_at: "2026-09-18T12:00:00Z", epistemic_state: "uncertain", kind: "transcription" }],
  sources: [], limitations: ["The note leaves the location uncertain."], reason: null, index_as_of: null, mode: "online_grounded",
};

describe("adaptive glass-board interactions (synthetic)", () => {
  it("does not restore an old session after an authoritative sign-out event", async () => {
    const auth = makeAuth(null);
    let finish!: (value: BrowserSession | null) => void;
    auth.getSession = vi.fn(() => new Promise<BrowserSession | null>((resolve) => { finish = resolve; }));
    const api = makeApi();
    render(<App services={{ auth, api }} />);
    await act(async () => { auth.emit(null); });
    expect(await screen.findByText("Connect this device.")).toBeTruthy();
    await act(async () => { finish(session("u1", "w1")); });
    expect(screen.getByText("Connect this device.")).toBeTruthy();
    expect(api.me).not.toHaveBeenCalled();
  });
  it("keeps device disconnect inside Settings", async () => { const auth = makeAuth(session("u1", "w1")); const api = makeApi(); render(<App services={{ auth, api }} />); fireEvent.click(await screen.findByRole("button", { name: "Settings" })); fireEvent.click(screen.getByRole("button", { name: "Disconnect this device" })); await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1)); });
  it("surfaces a disconnect failure without dropping the active session", async () => { const auth = makeAuth(session("u1", "w1")); auth.signOut = vi.fn(async () => { throw new Error("Provider unavailable."); }); const api = makeApi(); render(<App services={{ auth, api }} />); fireEvent.click(await screen.findByRole("button", { name: "Settings" })); fireEvent.click(screen.getByRole("button", { name: "Disconnect this device" })); expect(await screen.findByText("Provider unavailable.")).toBeTruthy(); expect(screen.getByLabelText("What are you trying to remember?")).toBeTruthy(); });

  it("keeps a failed upload retryable without allowing a duplicate Save", async () => {
    const createCapture = vi.fn(async () => { throw new Error("Offline."); });
    storage.listDrafts.mockResolvedValue([pendingDraft]);
    render(<App services={{ auth: makeAuth(session("u1", "w1")), api: makeApi({ createCapture }) }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Capture" }));
    const file = Object.assign(new File(["abc"], "synthetic.png", { type: "image/png" }), { arrayBuffer: async () => new TextEncoder().encode("abc").buffer });
    fireEvent.change(document.getElementById("capture-file")!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save original" }));
    expect(await screen.findByText(/Offline.*original remains saved/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save original" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Retry upload" })).toBeTruthy();
    expect(createCapture).toHaveBeenCalledTimes(1);
  });

  it("preserves the selected file and context when changing activities", async () => {
    const auth = makeAuth(session("u1", "w1"));
    render(<App services={{ auth, api: makeApi() }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Capture" }));
    const file = new File(["synthetic"], "synthetic.png", { type: "image/png" });
    fireEvent.change(document.getElementById("capture-file")!, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText(/Context/), { target: { value: "Synthetic travel" } });
    fireEvent.click(screen.getByRole("button", { name: "Explore" }));
    expect(screen.queryByLabelText(/Context/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    expect((screen.getByLabelText(/Context/) as HTMLTextAreaElement).value).toBe("Synthetic travel");
    expect(screen.getByText("synthetic.png")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save original" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("discards a pending answer after the question changes and permits a new request", async () => {
    let finish!: (answer: AskResponse) => void;
    const ask = vi.fn().mockImplementationOnce(() => new Promise<AskResponse>((resolve) => { finish = resolve; })).mockResolvedValueOnce({ ...groundedAnswer, question: "New question" });
    render(<App services={{ auth: makeAuth(session("u1", "w1")), api: makeApi({ ask }) }} />);
    const input = await screen.findByLabelText("What are you trying to remember?");
    fireEvent.change(input, { target: { value: "Old question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Recall" }));
    fireEvent.change(input, { target: { value: "New question" } });
    await act(async () => { finish(groundedAnswer); });
    expect(screen.queryByText(groundedAnswer.answer!)).toBeNull();
    expect((screen.getByRole("button", { name: "Ask Recall" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Ask Recall" }));
    expect(await screen.findByText(groundedAnswer.answer!)).toBeTruthy();
    expect(ask).toHaveBeenLastCalledWith("New question");
  });

  it("focuses an answer and opens evidence only on explicit action, retaining uncertainty", async () => {
    const fetchSource = vi.fn(async () => ({ bytes: new Uint8Array([1]).buffer, mediaType: "image/png", serverSha256: null }));
    render(<App services={{ auth: makeAuth(session("u1", "w1")), api: makeApi({ ask: vi.fn(async () => groundedAnswer), fetchSource }) }} />);
    fireEvent.change(await screen.findByLabelText("What are you trying to remember?"), { target: { value: groundedAnswer.question } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Recall" }));
    expect(await screen.findByText(groundedAnswer.answer!)).toBeTruthy();
    expect(screen.getByText(groundedAnswer.limitations[0]!)).toBeTruthy();
    expect(fetchSource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Focus answer" }));
    expect(screen.getByRole("button", { name: "Show sources" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /View evidence/ }));
    expect(fetchSource).toHaveBeenCalledWith("source-1");
    expect(await screen.findByText("Original integrity hash unavailable.")).toBeTruthy();
    expect(screen.queryByAltText("Cited original")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close evidence" }));
    expect(screen.queryByText("Original integrity hash unavailable.")).toBeNull();
    fireEvent.change(screen.getByLabelText("What are you trying to remember?"), { target: { value: "Different" } });
    expect(screen.queryByText(groundedAnswer.answer!)).toBeNull();
  });

  it("keeps an unprocessed source's review state honest", async () => {
    render(<App services={{ auth: makeAuth(session("u1", "w1")), api: makeApi({ listCaptures: vi.fn(async () => ({ items: [{ ...capture, status: "needs_review" }], next_cursor: null })) }) }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Explore" }));
    expect(await screen.findByText("Needs review")).toBeTruthy();
    expect(screen.queryByText("Ready")).toBeNull();
  });
});
