export interface BrowserSession { userId: string; email: string | null; workspaceId: string; }
export interface BrowserAuth {
  getSession(): Promise<BrowserSession | null>;
  requestSignIn(email: string): Promise<void>;
  signOut(): Promise<void>;
  onChange(callback: (session: BrowserSession | null) => void): () => void;
}

function parseSession(value: unknown): BrowserSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>; const user = (record.user && typeof record.user === "object" ? record.user : record) as Record<string, unknown>; const workspace = (record.workspace && typeof record.workspace === "object" ? record.workspace : {}) as Record<string, unknown>;
  const workspaces = Array.isArray(record.workspaces) ? record.workspaces : []; const firstWorkspace = workspaces[0] && typeof workspaces[0] === "object" ? workspaces[0] as Record<string, unknown> : null;
  const userId = typeof user.id === "string" ? user.id : typeof record.user_id === "string" ? record.user_id : null; const workspaceId = typeof workspace.id === "string" ? workspace.id : typeof record.active_workspace_id === "string" ? record.active_workspace_id : typeof record.workspace_id === "string" ? record.workspace_id : firstWorkspace && typeof firstWorkspace.id === "string" ? firstWorkspace.id : null;
  return userId && workspaceId ? { userId, workspaceId, email: typeof user.email === "string" ? user.email : typeof record.email === "string" ? record.email : null } : null;
}

export function createBrowserAuth(fetchImpl: typeof fetch = fetch, basePath = ""): BrowserAuth {
  const listeners = new Set<(session: BrowserSession | null) => void>();
  const url = (path: string) => `${basePath}${path}`;
  const getSession = async (): Promise<BrowserSession | null> => {
    if (globalThis.location?.pathname === "/auth/callback") await redeemEmailCallback(fetchImpl, basePath);
    const response = await fetchImpl(url("/auth/me"), { credentials: "include" });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error("Could not check the Recall session.");
    return parseSession(await response.json());
  };
  return {
    getSession,
    async requestSignIn(email) {
      const response = await fetchImpl(url("/auth/request"), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      if (!response.ok) throw new Error("Could not send the sign-in email.");
    },
    async signOut() {
      const response = await fetchImpl(url("/auth/logout"), { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Could not sign out.");
      listeners.forEach((listener) => listener(null));
    },
    onChange(callback) { listeners.add(callback); return () => listeners.delete(callback); },
  };
}

/** Redeem the one-time email-link fragment without persisting tokens in browser storage. */
export async function redeemEmailCallback(fetchImpl: typeof fetch = fetch, basePath = ""): Promise<boolean> {
  const query = new URLSearchParams(globalThis.location.search);
  const fragment = new URLSearchParams(globalThis.location.hash.slice(1));
  const state = one(query, "state");
  const accessToken = one(fragment, "access_token");
  const refreshToken = one(fragment, "refresh_token");
  const expiresAt = one(fragment, "expires_at");
  const tokenType = one(fragment, "token_type");

  // Remove bearer material before the first network request or application render.
  globalThis.history.replaceState(null, "", "/");
  if (!state || !accessToken || !refreshToken || tokenType?.toLowerCase() !== "bearer" || accessToken.length > 10_000 || refreshToken.length > 10_000) return false;
  const parsedExpiry = expiresAt === null ? null : Number(expiresAt);
  if (parsedExpiry !== null && (!Number.isSafeInteger(parsedExpiry) || parsedExpiry <= 0)) return false;
  const response = await fetchImpl(`${basePath}/auth/session`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, ...(parsedExpiry === null ? {} : { expires_at: parsedExpiry }), state }),
  });
  return response.status === 204;
}

function one(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] ?? null : null;
}
