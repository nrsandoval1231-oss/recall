import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { handle, relay, resetEnrollmentLimits, type Env } from "./worker";

const site = "https://recall.example.test";
const sessionKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const enrollment = "enr_0123456789abcdefghij";

function env(): Env {
  return {
    SITE_ORIGIN: site,
    API_ORIGIN: "https://api.example.test",
    SESSION_KEY: sessionKey,
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
  };
}

function post(path: string, body?: unknown, extra: Record<string, string> = {}): Request {
  return new Request(`${site}${path}`, {
    method: "POST",
    headers: {
      origin: site,
      "content-type": "application/json",
      "x-recall-enrollment": "1",
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("web Worker enrollment boundary", () => {
  it("turns a same-origin enrollment into an HttpOnly cookie and hides the session token", async () => {
    resetEnrollmentLimits();
    const sessionToken = `rcs_${"a".repeat(24)}`;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ session_token: sessionToken, expires_at: "2030-01-01T00:00:00.000Z" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const response = await handle(post("/auth/enroll", { enrollment_token: enrollment }), env());
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-recall_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain(sessionToken);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.example.test/v1/enrollment/redeem");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-recall-enrollment")).toBe("1");
    fetchMock.mockRestore();
  });

  it("rejects cross-site enrollment before it reaches the API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const request = new Request(`${site}/auth/enroll`, {
      method: "POST",
      headers: { origin: "https://attacker.test", "content-type": "application/json", "x-recall-enrollment": "1" },
      body: JSON.stringify({ enrollment_token: enrollment }),
    });
    await expect(handle(request, env())).resolves.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("rejects a cross-site form that cannot set the enrollment header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const request = new Request(`${site}/auth/enroll`, {
      method: "POST",
      headers: { origin: site, "content-type": "application/json" },
      body: JSON.stringify({ enrollment_token: enrollment }),
    });
    await expect(handle(request, env())).resolves.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("rejects an oversized chunked JSON body without calling the API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(20_001)));
        controller.close();
      },
    });
    const request = new Request(`${site}/auth/enroll`, {
      method: "POST",
      headers: { origin: site, "content-type": "application/json", "x-recall-enrollment": "1" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(handle(request, env())).resolves.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("leaves an unprovisioned browser without a private API call", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await handle(new Request(`${site}/auth/me`), env());
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("This browser is not provisioned.");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("does not provide an arbitrary outbound proxy", async () => {
    const e = env();
    await expect(handle(new Request(`${site}/api/https://attacker.test`), e)).resolves.toMatchObject({ status: 404 });
    expect(e.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("refuses a cross-site mutation even when a session cookie is attached", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const request = new Request(`${site}/api/v1/captures`, {
      method: "POST",
      headers: { origin: "https://attacker.test", cookie: "__Host-recall_session=stolen", "content-type": "application/json" },
      body: "{}",
    });
    await expect(handle(request, env())).resolves.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("adds browser security headers to static assets", async () => {
    const response = await handle(new Request(`${site}/`), env());
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("worker-src 'self'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("keeps authenticated originals private and preserves their integrity header", async () => {
    const upstream = new Response("bytes", {
      headers: { "content-type": "image/jpeg", "x-recall-source-sha256": "a".repeat(64) },
    });
    const response = await relay(
      upstream,
      { session_token: `rcs_${"b".repeat(24)}`, expires_at: 2_000_000_000 },
      env(),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-recall-source-sha256")).toBe("a".repeat(64));
    expect(response.headers.get("set-cookie")).toContain("__Host-recall_session=");
    expect(response.headers.get("set-cookie")).not.toContain(`rcs_${"b".repeat(24)}`);
  });

  it("does not call an email identity provider", () => {
    const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");
    expect(source.toLowerCase()).not.toContain("supabase");
    expect(source).not.toContain("/auth/v1/otp");
    expect(source).not.toContain("/auth/callback");
  });
});
