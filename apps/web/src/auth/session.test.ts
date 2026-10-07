// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createBrowserAuth, redeemEmailCallback } from "./session";

describe("browser BFF auth", () => {
  it("requests a login email through the BFF and never asks the browser to handle a token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const auth = createBrowserAuth(fetchMock);
    await auth.requestSignIn("pilot@example.com");
    expect(fetchMock).toHaveBeenCalledWith("/auth/request", expect.objectContaining({ method: "POST", credentials: "include" }));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).toBe(JSON.stringify({ email: "pilot@example.com" }));
  });

  it("accepts the ordinary callback session shape from /auth/me", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ user_id: "u1", email: "pilot@example.com", active_workspace_id: "w1", workspaces: [{ id: "w1" }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const session = await createBrowserAuth(fetchMock).getSession();
    expect(session).toEqual({ userId: "u1", email: "pilot@example.com", workspaceId: "w1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/auth/me");
  });

  it("redeems a clicked email link once, then removes tokens from the URL", async () => {
    window.history.replaceState(null, "", "/auth/callback?state=nonce#access_token=access&refresh_token=refresh&expires_at=2000000000&token_type=bearer");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user_id: "u1", active_workspace_id: "w1" }), { status: 200 }));
    const session = await createBrowserAuth(fetchMock).getSession();
    expect(session).toMatchObject({ userId: "u1", workspaceId: "w1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/auth/session");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBe(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_at: 2000000000, state: "nonce" }));
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/");
  });

  it("does not submit malformed callback fragments", async () => {
    window.history.replaceState(null, "", "/auth/callback?state=nonce#access_token=access&refresh_token=refresh");
    const fetchMock = vi.fn<typeof fetch>();
    await expect(redeemEmailCallback(fetchMock)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/");
  });
});
