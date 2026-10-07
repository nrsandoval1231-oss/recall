// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecallApiClient } from "@recall/api-client";
import { useOriginal } from "./useOriginal";

const hash = vi.hoisted(() => vi.fn<(bytes: ArrayBuffer) => Promise<string>>());
vi.mock("@recall/api-client", async (importActual) => ({ ...(await importActual<typeof import("@recall/api-client")>()), sha256Hex: hash }));

function Probe({ api }: { api: RecallApiClient }) {
  const original = useOriginal(api);
  const [sourceId, setSourceId] = useState("source-a");
  return <>
    <output data-testid="url">{original.url ?? ""}</output>
    <output data-testid="error">{original.error ?? ""}</output>
    <output data-testid="loading">{String(original.loading)}</output>
    <button onClick={() => void original.load(sourceId, "expected")}>Load</button>
    <button onClick={() => setSourceId("source-b")}>Use B</button>
    <button onClick={() => original.close()}>Close</button>
  </>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("useOriginal", () => {
  const createObjectURL = vi.fn<(value: Blob) => string>();
  const revokeObjectURL = vi.fn<(url: string) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    hash.mockResolvedValue("expected");
    createObjectURL.mockReturnValue("blob:original");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  });
  afterEach(() => cleanup());

  it("clears and revokes an already displayed original when closed", async () => {
    const api = { fetchSource: vi.fn(async () => ({ bytes: new Uint8Array([1]).buffer, mediaType: "image/png", serverSha256: "expected" })) } as unknown as RecallApiClient;
    render(<Probe api={api} />);

    await act(async () => { screen.getByRole("button", { name: "Load" }).click(); });
    expect(screen.getByTestId("url").textContent).toBe("blob:original");

    act(() => { screen.getByRole("button", { name: "Close" }).click(); });
    expect(screen.getByTestId("url").textContent).toBe("");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:original");
  });

  it("does not display an original that resolves after close", async () => {
    const pending = deferred<{ bytes: ArrayBuffer; mediaType: string; serverSha256: string }>();
    const api = { fetchSource: vi.fn(() => pending.promise) } as unknown as RecallApiClient;
    render(<Probe api={api} />);

    act(() => { screen.getByRole("button", { name: "Load" }).click(); screen.getByRole("button", { name: "Close" }).click(); });
    await act(async () => { pending.resolve({ bytes: new Uint8Array([1]).buffer, mediaType: "image/png", serverSha256: "expected" }); });

    expect(screen.getByTestId("url").textContent).toBe("");
    expect(screen.getByTestId("error").textContent).toBe("");
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("keeps the most recently requested citation when an earlier request finishes last", async () => {
    const first = deferred<{ bytes: ArrayBuffer; mediaType: string; serverSha256: string }>();
    const second = deferred<{ bytes: ArrayBuffer; mediaType: string; serverSha256: string }>();
    const api = { fetchSource: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) } as unknown as RecallApiClient;
    createObjectURL.mockReturnValue("blob:b");
    render(<Probe api={api} />);

    act(() => { screen.getByRole("button", { name: "Load" }).click(); screen.getByRole("button", { name: "Use B" }).click(); screen.getByRole("button", { name: "Load" }).click(); });
    await act(async () => { second.resolve({ bytes: new Uint8Array([2]).buffer, mediaType: "image/png", serverSha256: "expected" }); });
    await act(async () => { first.resolve({ bytes: new Uint8Array([1]).buffer, mediaType: "image/png", serverSha256: "expected" }); });

    expect(screen.getByTestId("url").textContent).toBe("blob:b");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("rejects missing, server-mismatched, and declaration-mismatched hashes", async () => {
    const api = { fetchSource: vi.fn(async () => ({ bytes: new Uint8Array([1]).buffer, mediaType: "image/png", serverSha256: null })) } as unknown as RecallApiClient;
    render(<Probe api={api} />);

    await act(async () => { screen.getByRole("button", { name: "Load" }).click(); });
    expect(screen.getByTestId("error").textContent).toBe("Original integrity hash unavailable.");

    (api.fetchSource as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ bytes: new Uint8Array([1]).buffer, mediaType: "image/png", serverSha256: "server" });
    await act(async () => { screen.getByRole("button", { name: "Load" }).click(); });
    expect(screen.getByTestId("error").textContent).toBe("Original failed integrity verification.");

    hash.mockResolvedValueOnce("different");
    (api.fetchSource as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ bytes: new Uint8Array([1]).buffer, mediaType: "image/png", serverSha256: "expected" });
    await act(async () => { screen.getByRole("button", { name: "Load" }).click(); });
    expect(screen.getByTestId("error").textContent).toBe("Original failed integrity verification.");
  });
});
