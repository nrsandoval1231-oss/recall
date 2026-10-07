import { describe, expect, it, vi } from "vitest";
import { handle, relay, type Env } from "./worker";

const site = "https://recall.example.test";
const sessionKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

function env(): Env {
  return {
    SITE_ORIGIN: site,
    API_ORIGIN: "https://api.example.test",
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    SESSION_KEY: sessionKey,
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
  };
}

function post(path: string, body?: unknown, cookie?: string): Request {
  return new Request(`${site}${path}`, {
    method: "POST",
    headers: { origin: site, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("web Worker boundary", () => {
  it("binds email login to a same-origin nonce callback", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const response = await handle(post("/auth/request", { email: "pilot@example.test" }), env());
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("recall_login=");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/auth/v1/otp?redirect_to=");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("%2Fauth%2Fcallback%3Fstate%3D");
    fetchMock.mockRestore();
  });

  it("rejects cross-site mutation before it reaches Supabase", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const request = new Request(`${site}/auth/request`, { method: "POST", headers: { origin: "https://attacker.test", "content-type": "application/json" }, body: JSON.stringify({ email: "pilot@example.test" }) });
    await expect(handle(request, env())).resolves.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("rejects an oversized chunked JSON body without calling Supabase", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(20_001))); controller.close(); } });
    const request = new Request(`${site}/auth/request`, {
      method: "POST", headers: { origin: site, "content-type": "application/json" }, body: stream,
      // Node requires duplex for a streaming Request; Workers ignore this field.
      duplex: "half",
    } as RequestInit);
    await expect(handle(request, env())).resolves.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("requires the HttpOnly login nonce before accepting fragment tokens", async () => {
    const response = await handle(post("/auth/session", { state: "missing", access_token: "a", refresh_token: "r" }), env());
    expect(response.status).toBe(401);
  });

  it("does not provide an arbitrary outbound proxy", async () => {
    const e = env();
    await expect(handle(new Request(`${site}/api/https://attacker.test`), e)).resolves.toMatchObject({ status: 404 });
    expect(e.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("adds browser security headers to static assets", async () => {
    const response = await handle(new Request(`${site}/`), env());
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("keeps authenticated originals private and preserves their integrity header", async () => {
    const upstream = new Response("bytes", { headers: { "content-type": "image/jpeg", "x-recall-source-sha256": "a".repeat(64) } });
    const response = await relay(upstream, { access_token: "access", refresh_token: "refresh", expires_at: 2_000_000_000 }, env());
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-recall-source-sha256")).toBe("a".repeat(64));
    expect(response.headers.get("set-cookie")).toContain("__Host-recall_session=");
  });
});
