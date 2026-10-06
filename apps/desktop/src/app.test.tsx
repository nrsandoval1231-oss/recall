// @vitest-environment jsdom
import { webcrypto, createHash } from "node:crypto";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ServerCapture } from "@recall/api-client";
import { App, type DesktopServices } from "./App";
import { readConfig } from "./config";
import { Viewer } from "./components/Viewer";

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
  return { capture_id: "cap-1", client_capture_id: "cc-1", status: "stored", source_kind: "photo_document", captured_at: "2026-10-06T14:00:00Z", timezone: "America/Chicago", context_hint: "Standup notes", created_at: "2026-10-06T14:00:01Z", stored_at: "2026-10-06T14:00:02Z", version: 2, memory_id: null, pages: [page(1, bytesA), page(2, bytesB)], ...over };
}

function services(items: ServerCapture[], fetchSource?: DesktopServices["api"]["fetchSource"]): DesktopServices {
  return {
    auth: { requestEmailCode: vi.fn(), verifyEmailCode: vi.fn(), signOut: vi.fn(), hasSession: async () => true, onSignedInChange: () => () => undefined },
    api: {
      me: vi.fn(async () => ({}) as never),
      listCaptures: vi.fn(async () => ({ items, next_cursor: null })),
      getCapture: vi.fn(),
      fetchSource: fetchSource ?? (vi.fn(async (id: string) => { const b = id === "src-1" ? bytesA : bytesB; return { bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, mediaType: "image/jpeg", serverSha256: sha(b) }; })),
    },
  };
}

describe("desktop", () => {
  it("an empty account looks honestly empty (no fake memories, dashboards, or AI)", async () => {
    render(<App services={services([])} />);
    expect(await screen.findByText(/Nothing captured yet/)).toBeTruthy();
    expect(screen.queryByText(/summary|memories|insight|ask/i)).toBeNull();
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

describe("config", () => {
  it("names what is missing", () => {
    expect(readConfig({})).toEqual({ missing: ["VITE_API_BASE_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"] });
  });
});
