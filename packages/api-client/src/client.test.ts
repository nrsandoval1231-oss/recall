import { describe, expect, it } from "vitest";
import { ApiError, NetworkError, RecallApiClient, summarizeFailure, chunkedSecretStorage, sha256Hex } from "./index";

function client(fetchImpl: typeof fetch, token: string | null = "tok") {
  return new RecallApiClient({ baseUrl: "http://api.test/", getAccessToken: async () => token, fetch: fetchImpl });
}

describe("RecallApiClient", () => {
  it("sends the bearer token and Idempotency-Key, never a workspace id", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const c = client(async (url, init) => {
      seen = { url: String(url), init: init as RequestInit };
      return new Response(JSON.stringify({ capture_id: "c1" }), { status: 201 });
    });
    await c.createCapture({ schema_version: "1.0" } as never, "op-12345678");
    const headers = seen!.init.headers as Record<string, string>;
    expect(seen!.url).toBe("http://api.test/v1/captures");
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Idempotency-Key"]).toBe("op-12345678");
    expect(JSON.stringify(headers).toLowerCase()).not.toContain("workspace");
  });

  it("maps the error envelope to ApiError with the stable code", async () => {
    const c = client(async () =>
      new Response(JSON.stringify({ error: { code: "UPLOAD_INCOMPLETE", message: "m", retryable: true, request_id: "r1", details: { missing_source_ids: ["s"] } } }), { status: 409 }),
    );
    const err = await c.getCapture("x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "UPLOAD_INCOMPLETE", status: 409, retryable: true, requestId: "r1" });
    expect(err.details).toEqual({ missing_source_ids: ["s"] });
  });

  it("turns a transport failure into a retryable NetworkError", async () => {
    const c = client(async () => {
      throw new TypeError("Network request failed");
    });
    const err = await c.me().catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(summarizeFailure(err)).toEqual({ code: "NETWORK", message: expect.any(String), retryable: true });
  });

  it("refuses to call the API without a session", async () => {
    const c = client(async () => new Response("{}"), null);
    await expect(c.me()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("copes with non-JSON gateway errors", async () => {
    const c = client(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(c.me()).rejects.toMatchObject({ code: "HTTP_ERROR", status: 502, retryable: true });
  });

  it("classifies failures for persistence", () => {
    const expired = new ApiError("UPLOAD_AUTHORIZATION_EXPIRED", "x", 403, true, null);
    const invalid = new ApiError("UNSUPPORTED_MEDIA", "x", 415, false, null);
    const signedOut = new ApiError("UNAUTHENTICATED", "x", 401, false, null);
    expect(summarizeFailure(expired).retryable).toBe(true);
    expect(summarizeFailure(invalid).retryable).toBe(false);
    expect(summarizeFailure(signedOut).retryable).toBe(true);
  });

  it("authorizeUploads without ids sends no body (= every pending page), with ids sends exactly those", async () => {
    const bodies: (string | undefined)[] = [];
    const c = client(async (_url, init) => {
      bodies.push((init as RequestInit).body as string | undefined);
      return new Response(JSON.stringify({ authorizations: [] }));
    });
    await c.authorizeUploads("cap");
    await c.authorizeUploads("cap", ["s1"]);
    expect(bodies).toEqual([undefined, JSON.stringify({ source_ids: ["s1"] })]);
  });

  it("RCL-002 calls hit the documented routes", async () => {
    const calls: string[] = [];
    const c = client(async (url, init) => {
      calls.push(`${(init as RequestInit).method} ${String(url).replace("http://api.test", "")}`);
      return new Response(JSON.stringify({}));
    });
    await c.ask("where is the key?");
    await c.search("solar guy", 5);
    await c.getMemory("m1");
    await c.setAiEnabled(true, 2);
    await c.retryProcessing("cap1", "retry-key-1234");
    expect(calls).toEqual(["POST /v1/ask", "GET /v1/search?q=solar+guy&limit=5", "GET /v1/memories/m1", "PUT /v1/settings/ai", "POST /v1/captures/cap1/retry-processing"]);
  });

  it("resolves relative upload URLs against the base", () => {
    expect(client(fetch).resolve("/v1/uploads/abc")).toBe("http://api.test/v1/uploads/abc");
  });
});

describe("sha256Hex", () => {
  it("matches the known vector", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("chunkedSecretStorage", () => {
  const memory = () => {
    const map = new Map<string, string>();
    return { map, backend: { get: async (k: string) => map.get(k) ?? null, set: async (k: string, v: string) => void map.set(k, v), remove: async (k: string) => void map.delete(k) } };
  };

  it("round-trips values larger than one chunk and never exceeds the chunk size", async () => {
    const { map, backend } = memory();
    const store = chunkedSecretStorage(backend, 100);
    const session = JSON.stringify({ access_token: "a".repeat(950), refresh_token: "r".repeat(120), user: { id: "ü-✓" } });
    await store.setItem("s", session);
    expect(await store.getItem("s")).toBe(session);
    expect([...map.entries()].filter(([k]) => !k.endsWith(".n")).every(([, v]) => v.length <= 100)).toBe(true);
  });

  it("shrinking a value leaves no stale chunks and removal clears everything", async () => {
    const { map, backend } = memory();
    const store = chunkedSecretStorage(backend, 10);
    await store.setItem("s", "x".repeat(95));
    await store.setItem("s", "short");
    expect(await store.getItem("s")).toBe("short");
    expect(map.size).toBe(2);
    await store.removeItem("s");
    expect(map.size).toBe(0);
    expect(await store.getItem("s")).toBeNull();
  });

  it("treats a torn write (missing chunk) as absent rather than corrupt", async () => {
    const { map, backend } = memory();
    const store = chunkedSecretStorage(backend, 10);
    await store.setItem("s", "y".repeat(35));
    map.delete("s.2");
    expect(await store.getItem("s")).toBeNull();
  });
});
