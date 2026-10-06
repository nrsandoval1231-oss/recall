// @vitest-environment jsdom
import { webcrypto, createHash } from "node:crypto";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AiSettings, AskResponse, MemoryDetail, ServerCapture } from "@recall/api-client";
import { App, type DesktopServices } from "./App";
import { readConfig } from "./config";
import { Viewer } from "./components/Viewer";
import { Settings } from "./components/Settings";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytesA = new TextEncoder().encode("synthetic page one");
const bytesB = new TextEncoder().encode("synthetic page two");

function capture(over: Partial<ServerCapture> = {}): ServerCapture {
  const page = (n: number, b: Uint8Array) => ({ source_id: `src-${n}`, client_page_id: `cp-${n}`, ordinal: n, media_type: "image/jpeg" as const, byte_size: b.length, declared_sha256: sha(b), server_sha256: sha(b), upload_state: "verified" as const, original_filename: `IMG_${n}.jpg` });
  return { capture_id: "cap-1", client_capture_id: "cc-1", status: "stored", source_kind: "photo_document", captured_at: "2026-10-06T14:00:00Z", timezone: "America/Chicago", context_hint: "Standup notes", created_at: "2026-10-06T14:00:01Z", stored_at: "2026-10-06T14:00:02Z", version: 2, memory_id: null, processing: null, pages: [page(1, bytesA), page(2, bytesB)], ...over };
}

function services(items: ServerCapture[], fetchSource?: DesktopServices["api"]["fetchSource"], extra: Partial<DesktopServices["api"]> = {}): DesktopServices {
  return {
    auth: { requestEmailCode: vi.fn(), verifyEmailCode: vi.fn(), signOut: vi.fn(), hasSession: async () => true, onSignedInChange: () => () => undefined },
    api: {
      me: vi.fn(async () => ({}) as never),
      listCaptures: vi.fn(async () => ({ items, next_cursor: null })),
      getCapture: vi.fn(),
      fetchSource: fetchSource ?? (vi.fn(async (id: string) => { const b = id === "src-1" ? bytesA : bytesB; return { bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, mediaType: "image/jpeg", serverSha256: sha(b) }; })),
      ask: vi.fn(),
      getMemory: vi.fn(async () => memory()),
      retryProcessing: vi.fn(async () => ({ capture_id: "cap-1", processing: null })),
      getAiSettings: vi.fn(async () => aiSettings()),
      setAiEnabled: vi.fn(async (enabled: boolean) => aiSettings({ enabled, version: 1 })),
      ...extra,
    },
  };
}

describe("desktop", () => {
  it("an empty account looks honestly empty (no fake memories, dashboards, or AI)", async () => {
    render(<App services={services([])} />);
    expect(await screen.findByText(/Nothing captured yet/)).toBeTruthy();
    // Ask is offered (UX-SPEC), but nothing is fabricated: no summaries, insights, dashboards, or items.
    expect(screen.queryByText(/summary|insight|dashboard|trending|today's brief/i)).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows recent captures with the shared status words", async () => {
    render(<App services={services([capture(), capture({ capture_id: "cap-2", status: "awaiting_upload", context_hint: null })])} />);
    expect(await screen.findByText("Standup notes")).toBeTruthy();
    expect(screen.getByText(/Uploaded/)).toBeTruthy();
    expect(screen.getByText(/Upload incomplete/)).toBeTruthy();
    expect(screen.getByText("Notebook pages")).toBeTruthy();
  });

  it("opens the original and marks it verified only after its own SHA-256 matches", async () => {
    const user = userEvent.setup();
    render(<App services={services([capture()])} />);
    await user.click(await screen.findByRole("button", { name: /Standup notes/ }));
    await waitFor(() => expect(screen.getByTestId("integrity").textContent).toMatch(/✓ Verified/));
    expect(screen.getByRole("img", { name: /Original page 1 of 2/ })).toBeTruthy();
    expect(screen.getByText(/Page 1 of 2/, { selector: "h3" })).toBeTruthy();
  });

  it("navigates pages with the keyboard and verifies each page", async () => {
    const user = userEvent.setup();
    render(<Viewer api={services([]).api} capture={capture()} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("integrity").textContent).toMatch(/Verified/));
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByText(/Page 2 of 2/, { selector: "h3" })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("integrity").textContent).toMatch(/Verified/));
    await user.keyboard("{ArrowLeft}");
    expect(await screen.findByText(/Page 1 of 2/, { selector: "h3" })).toBeTruthy();
  });

  it("refuses to claim verification when the downloaded bytes differ from the stored hash", async () => {
    const tampered = new TextEncoder().encode("TAMPERED bytes");
    const api = services([], async () => ({ bytes: tampered.buffer.slice(tampered.byteOffset, tampered.byteOffset + tampered.byteLength) as ArrayBuffer, mediaType: "image/jpeg", serverSha256: sha(bytesA) })).api;
    render(<Viewer api={api} capture={capture()} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("integrity").textContent).toMatch(/Does NOT match/));
    expect(screen.getByTestId("integrity").textContent).not.toMatch(/Verified/);
  });

  it("does not try to show originals of an incomplete upload", async () => {
    const api = services([]).api;
    render(<Viewer api={api} capture={capture({ status: "awaiting_upload", stored_at: null })} onClose={() => undefined} />);
    expect(await screen.findByText(/upload isn't complete/)).toBeTruthy();
    expect(api.fetchSource).not.toHaveBeenCalled();
  });

  it("reports connectivity problems without implying data loss", async () => {
    const s = services([]);
    (s.api.listCaptures as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
    render(<App services={s} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nothing here has been lost/);
  });
});

function memory(): MemoryDetail {
  return {
    memory_id: "mem-1", capture_id: "cap-1", revision: 1, status: "needs_review", summary: "Standup notes about the release", context_hint: "Standup notes",
    captured_at: "2026-10-06T14:00:00Z", page_count: 2, model_id: "m", created_at: "x", timezone: "America/Chicago", processor_version: "interpret-v1", revised_at: "x",
    interpretation: {
      summary: "Standup notes about the release", summary_evidence: [],
      pages: [{ page_id: "src-1", ordinal: 1, transcription: "Release Thursday?\nShip 3 builds", legibility: "clear" }, { page_id: "src-2", ordinal: 2, transcription: "", legibility: "unreadable" }],
      mentions: [],
      statements: [
        { local_id: "s1", kind: "observation", text: "Release Thursday?", value_text: null, epistemic_state: "uncertain", temporal_text: "Thursday", attribution_text: null, evidence: [{ page_id: "src-1", quote: "Release Thursday?" }] },
        { local_id: "s2", kind: "observation", text: "Ship 3 builds", value_text: "3", epistemic_state: "reported", temporal_text: null, attribution_text: null, evidence: [{ page_id: "src-1", quote: "Ship 3 builds" }] },
      ],
      action_suggestions: [{ local_id: "a1", kind: "action", text: "Ship 3 builds", due_text: null, evidence: [{ page_id: "src-1", quote: "Ship 3 builds" }] }],
      uncertainties: [],
    },
    validation_notes: [{ code: "PAGE_UNREADABLE", detail: "page 2 could not be read" }],
    labels: { transcription: "Machine reading of the original. Check the original for anything important.", action_suggestions: "Suggestions only. Nothing has been scheduled or sent." },
  };
}

function aiSettings(over: Partial<AiSettings> = {}): AiSettings {
  return { ai_configured: true, provider: "anthropic", policy_version: "anthropic-v1", enabled: false, consent_outdated: false, decided_at: null, version: 0, explanation: "When on, Recall sends a processed copy of each saved page to the configured AI provider.", ...over };
}

function askResponse(over: Partial<AskResponse>): AskResponse {
  const cite = { citation_id: "c1", memory_id: "mem-1", memory_revision: 1, capture_id: "cap-1", source_id: "src-2", page: 2, quote: "Dev runs a solar company", captured_at: "2026-10-06T14:00:00Z", epistemic_state: "reported" as const, kind: "transcription" as const };
  return { question: "q", status: "answered", answer: "Dev runs a solar company.", sentences: [{ text: "Dev runs a solar company.", citation_ids: ["c1"] }], citations: [cite], limitations: [], sources: [{ ...cite, citation_id: "s1" }], reason: null, index_as_of: null, mode: "online_grounded", ...over };
}

describe("RCL-002 desktop", () => {
  it("shows processing states in the shared words", async () => {
    const items = [
      capture({ capture_id: "a", status: "processing", context_hint: "A", processing: { state: "running", attempts: 1, max_attempts: 3, blocked_reason: null, last_error_code: null, retry_available: false } }),
      capture({ capture_id: "b", status: "needs_review", context_hint: "B", memory_id: "m" }),
      capture({ capture_id: "c", status: "failed", context_hint: "C", processing: { state: "failed", attempts: 3, max_attempts: 3, blocked_reason: null, last_error_code: "EXTRACTION_INVALID", retry_available: true } }),
      capture({ capture_id: "d", status: "stored", context_hint: "D", processing: { state: "queued", attempts: 0, max_attempts: 3, blocked_reason: null, last_error_code: null, retry_available: false } }),
    ];
    render(<App services={services(items)} />);
    expect(await screen.findByText(/Reading…/)).toBeTruthy();
    expect(screen.getByText(/Ready · check details/)).toBeTruthy();
    expect(screen.getByText(/Couldn't read · original is safe/)).toBeTruthy();
    expect(screen.getByText(/waiting to be read/)).toBeTruthy();
  });

  it("an answer cites its sources and a citation opens the exact original page", async () => {
    const user = userEvent.setup();
    const s = services([], undefined, { ask: vi.fn(async () => askResponse({})), getCapture: vi.fn(async () => capture({ memory_id: "mem-1", status: "needs_review" })) });
    render(<App services={s} />);
    await user.type(await screen.findByLabelText(/What are you trying to remember/), "who did solar?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(/Dev runs a solar company\./)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Open source for/ }));
    expect(await screen.findByText(/Page 2 of 2/, { selector: "h3" })).toBeTruthy(); // opened at the cited page
    expect(s.api.getCapture).toHaveBeenCalledWith("cap-1");
  });

  it.each([
    ["insufficient_evidence", /couldn't find anything/],
    ["ambiguous", /More than one thing/],
    ["unavailable", /Answers are off/],
  ] as const)("renders %s honestly, never as an answer", async (status, text) => {
    const user = userEvent.setup();
    const s = services([], undefined, { ask: vi.fn(async () => askResponse({ status, answer: null, sentences: [], citations: [] })) });
    render(<App services={s} />);
    await user.type(await screen.findByLabelText(/What are you trying to remember/), "anything");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open source for/ })).toBeNull();
    expect(screen.getByRole("list", { name: "Matching sources" })).toBeTruthy();
  });

  it("shows the machine reading beside the original, labelled, with uncertainty and suggestions", async () => {
    render(<Viewer api={services([]).api} capture={capture({ memory_id: "mem-1", status: "needs_review" })} onClose={() => undefined} />);
    expect((await screen.findByTestId("transcription")).textContent).toContain("Release Thursday?");
    expect(screen.getByText(/Machine reading of the original/)).toBeTruthy();
    expect(screen.getByText("uncertain")).toBeTruthy();
    expect(screen.getByText(/Suggestions only/)).toBeTruthy();
    expect(screen.getByText(/1 thing\(s\) Recall couldn't confirm/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("integrity").textContent).toMatch(/Verified/)); // original still verified
  });

  it("offers a retry for a failed reading", async () => {
    const user = userEvent.setup();
    const s = services([]);
    render(<Viewer api={s.api} capture={capture({ status: "failed", processing: { state: "failed", attempts: 3, max_attempts: 3, blocked_reason: null, last_error_code: "X", retry_available: true } })} onClose={() => undefined} />);
    await user.click(await screen.findByRole("button", { name: /Try reading again/ }));
    expect(await screen.findByText(/Queued to be read again/)).toBeTruthy();
    expect(s.api.retryProcessing).toHaveBeenCalled();
  });

  it("AI reading is opt-in with an explanation, and honest when the server isn't set up", async () => {
    const user = userEvent.setup();
    const s = services([]);
    const { unmount } = render(<Settings api={s.api} onClose={() => undefined} />);
    expect(await screen.findByText(/sends a processed copy/)).toBeTruthy();
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(false);
    await user.click(box);
    expect(s.api.setAiEnabled).toHaveBeenCalledWith(true, 0);
    expect(await screen.findByText("On")).toBeTruthy();
    unmount();
    render(<Settings api={services([], undefined, { getAiSettings: vi.fn(async () => aiSettings({ ai_configured: false })) }).api} onClose={() => undefined} />);
    expect(await screen.findByText(/isn't set up on this Recall server/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("config", () => {
  it("names what is missing", () => {
    expect(readConfig({})).toEqual({ missing: ["VITE_API_BASE_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"] });
  });
});
