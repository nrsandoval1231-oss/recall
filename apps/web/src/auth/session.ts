export interface BrowserSession {
  userId: string;
  email: string | null;
  workspaceId: string;
}
export interface BrowserAuth {
  getSession(): Promise<BrowserSession | null>;
  endSession(): Promise<void>;
  enrollmentNotice(): string | null;
  onChange(callback: (session: BrowserSession | null) => void): () => void;
}

const ENROLLMENT = /^enr_[A-Za-z0-9_-]{20,120}$/;

function parseSession(value: unknown): BrowserSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const user = (
    record.user && typeof record.user === "object" ? record.user : record
  ) as Record<string, unknown>;
  const workspace = (
    record.workspace && typeof record.workspace === "object" ? record.workspace : {}
  ) as Record<string, unknown>;
  const workspaces = Array.isArray(record.workspaces) ? record.workspaces : [];
  const firstWorkspace =
    workspaces[0] && typeof workspaces[0] === "object"
      ? (workspaces[0] as Record<string, unknown>)
      : null;
  const userId =
    typeof user.id === "string"
      ? user.id
      : typeof record.user_id === "string"
        ? record.user_id
        : null;
  const workspaceId =
    typeof workspace.id === "string"
      ? workspace.id
      : typeof record.active_workspace_id === "string"
        ? record.active_workspace_id
        : typeof record.workspace_id === "string"
          ? record.workspace_id
          : firstWorkspace && typeof firstWorkspace.id === "string"
            ? firstWorkspace.id
            : null;
  return userId && workspaceId
    ? {
        userId,
        workspaceId,
        email:
          typeof user.email === "string"
            ? user.email
            : typeof record.email === "string"
              ? record.email
              : null,
      }
    : null;
}

/** Read a one-time enrollment fragment and remove it before the app renders. */
export function takeEnrollmentToken(): string | null {
  const locationRef = globalThis.location;
  if (!locationRef) return null;
  const hash = locationRef.hash.startsWith("#") ? locationRef.hash.slice(1) : "";
  const token = ENROLLMENT.test(hash) ? hash : null;
  const path = locationRef.pathname;
  if (locationRef.hash || path === "/enroll" || path === "/auth/callback") {
    globalThis.history.replaceState(null, "", "/");
  }
  return token;
}

export function createBrowserAuth(
  fetchImpl: typeof fetch = fetch,
  basePath = "",
): BrowserAuth {
  const listeners = new Set<(session: BrowserSession | null) => void>();
  const url = (path: string) => `${basePath}${path}`;
  let pending = takeEnrollmentToken();
  let notice: string | null = null;
  let redeeming: Promise<void> | null = null;
  const enrollIfNeeded = (): Promise<void> => {
    if (redeeming) return redeeming;
    const token = pending;
    pending = null;
    if (!token) {
      redeeming = Promise.resolve();
      return redeeming;
    }
    redeeming = (async () => {
      try {
        const enrolled = await fetchImpl(url("/auth/enroll"), {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-recall-enrollment": "1",
          },
          body: JSON.stringify({ enrollment_token: token }),
        });
        if (enrolled.status === 429) {
          notice =
            "Enrollment is temporarily limited. Ask the operator for a fresh link later.";
        } else if (enrolled.status !== 204) {
          notice = "This enrollment link is no longer valid.";
        }
      } catch (failure) {
        pending = token;
        redeeming = null;
        throw failure;
      }
    })();
    return redeeming;
  };
  const getSession = async (): Promise<BrowserSession | null> => {
    await enrollIfNeeded();
    const response = await fetchImpl(url("/auth/me"), { credentials: "include" });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error("Could not check the Recall session.");
    return parseSession(await response.json());
  };
  return {
    getSession,
    async endSession() {
      const response = await fetchImpl(url("/auth/logout"), {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Could not end this device session.");
      listeners.forEach((listener) => listener(null));
    },
    enrollmentNotice: () => notice,
    onChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}
