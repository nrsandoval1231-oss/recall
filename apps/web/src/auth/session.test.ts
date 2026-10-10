// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createBrowserAuth, takeEnrollmentToken } from "./session";

describe("browser enrollment", () => {
  it("redeems a fragment once, strips it from the URL, and does not store it", async () => {
    window.history.replaceState(null, "", "/enroll#enr_0123456789abcdefghij");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ user_id: "u1", active_workspace_id: "w1" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const session = await createBrowserAuth(fetchMock).getSession();
    expect(session).toMatchObject({ userId: "u1", workspaceId: "w1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/auth/enroll");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe("include");
    expect(init.body).toBe(
      JSON.stringify({ enrollment_token: "enr_0123456789abcdefghij" }),
    );
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/",
    );
    expect(window.localStorage.getItem("enr_0123456789abcdefghij")).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toContain("enr_0123456789abcdefghij");
  });

  it("reads /auth/me without sending a bearer from the browser", async () => {
    window.history.replaceState(null, "", "/");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          user_id: "u1",
          email: null,
          active_workspace_id: "w1",
          workspaces: [{ id: "w1" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const session = await createBrowserAuth(fetchMock).getSession();
    expect(session).toEqual({ userId: "u1", email: null, workspaceId: "w1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/auth/me");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops a legacy email callback without posting its tokens", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/callback?state=nonce#access_token=access&refresh_token=refresh&token_type=bearer",
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(createBrowserAuth(fetchMock).getSession()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/auth/me");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/");
  });

  it("posts one enrollment when two session checks overlap", async () => {
    window.history.replaceState(null, "", "/#enr_0123456789abcdefghij");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (input === "/auth/enroll") {
        await gate;
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify({ user_id: "u1", active_workspace_id: "w1" }),
        { status: 200 },
      );
    });
    const auth = createBrowserAuth(fetchMock);
    const first = auth.getSession();
    const second = auth.getSession();
    release();
    await Promise.all([first, second]);
    expect(fetchMock.mock.calls.filter((call) => call[0] === "/auth/enroll")).toHaveLength(1);
  });

  it("retries an enrollment request that never reached the server", async () => {
    window.history.replaceState(null, "", "/#enr_0123456789abcdefghij");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user_id: "u1", active_workspace_id: "w1" }), {
          status: 200,
        }),
      );
    const auth = createBrowserAuth(fetchMock);
    await expect(auth.getSession()).rejects.toThrow("offline");
    await expect(auth.getSession()).resolves.toMatchObject({ userId: "u1", workspaceId: "w1" });
    expect(fetchMock.mock.calls.filter((call) => call[0] === "/auth/enroll")).toHaveLength(2);
  });

  it("reports a dead enrollment link and an unprovisioned browser", async () => {
    window.history.replaceState(null, "", "/#enr_0123456789abcdefghij");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("no", { status: 401 }))
      .mockResolvedValueOnce(new Response("no", { status: 401 }));
    const auth = createBrowserAuth(fetchMock);
    await expect(auth.getSession()).resolves.toBeNull();
    expect(auth.enrollmentNotice()).toBe("This enrollment link is no longer valid.");
    expect(takeEnrollmentToken()).toBeNull();
  });
});
