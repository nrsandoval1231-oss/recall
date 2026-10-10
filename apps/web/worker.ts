/** Cloudflare Worker: device-session cookie plus a fixed Recall API proxy. */
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API_ORIGIN: string;
  /** Base64url encoded random 32-byte secret; configure only as a Worker secret. */
  SESSION_KEY: string;
  SITE_ORIGIN: string;
}

type Session = { session_token: string; expires_at: number };
const SESSION = "recall_session";
const FORWARDED = ["content-type", "idempotency-key", "if-match", "x-request-id"];
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_TOKEN_CHARS = 160;
const MAX_SESSION_COOKIE_CHARS = 3_500;
const attempts = new Map<string, { start: number; count: number }>();

export default { fetch: (request: Request, env: Env) => handle(request, env) };

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== origin(env.SITE_ORIGIN)) return message("Invalid site origin.", 500);
  if (url.pathname === "/auth/enroll") return enroll(request, env);
  if (url.pathname === "/auth/me") return me(request, env);
  if (url.pathname === "/auth/logout") return logout(request, env);
  if (url.pathname.startsWith("/api/v1/")) return proxy(request, env);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return message("Not found.", 404);
  return asset(request, env);
}

export function resetEnrollmentLimits(): void {
  attempts.clear();
}

async function enroll(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return notAllowed("POST");
  if (!sameOriginMutation(request, env)) return message("Invalid request origin.", 403);
  if (request.headers.get("x-recall-enrollment") !== "1") return message("Invalid request origin.", 403);
  const key = await clientKey(request);
  if (limited(key)) return message("Too many enrollment attempts. Wait and try again.", 429);
  const body = await readJson<{ enrollment_token?: unknown; device_id?: unknown }>(request);
  if (!body) return message("The enrollment request was not valid.", 400);
  if (typeof body.enrollment_token !== "string" || !enrollmentToken(body.enrollment_token)) {
    return message("This enrollment link is no longer valid.", 401);
  }
  const payload: { enrollment_token: string; device_id?: string } = { enrollment_token: body.enrollment_token };
  if (typeof body.device_id === "string" && /^[0-9a-f-]{36}$/i.test(body.device_id)) payload.device_id = body.device_id;
  const upstream = await fetch(`${origin(env.API_ORIGIN)}/v1/enrollment/redeem`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: origin(env.SITE_ORIGIN),
      "sec-fetch-site": "same-origin",
      "x-recall-enrollment": "1",
      "x-recall-client-key": key,
    },
    body: JSON.stringify(payload),
  });
  if (upstream.status === 429) return message("Too many enrollment attempts. Wait and try again.", 429);
  if (!upstream.ok) return message("This enrollment link is no longer valid.", 401);
  const issued = (await upstream.json()) as { session_token?: unknown; expires_at?: unknown };
  if (typeof issued.session_token !== "string" || typeof issued.expires_at !== "string") {
    return message("This enrollment link is no longer valid.", 401);
  }
  const session = { session_token: issued.session_token, expires_at: Math.floor(Date.parse(issued.expires_at) / 1000) };
  const cookieValue = await sealedCookie(session, env.SESSION_KEY);
  if (!cookieValue) return message("This enrollment link is no longer valid.", 401);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store", "set-cookie": cookieValue } });
}

async function me(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return notAllowed("GET");
  const session = await readSession(request, env);
  if (!session || expired(session)) return message("This browser is not provisioned.", 401, clear(SESSION));
  const upstream = await fetch(`${origin(env.API_ORIGIN)}/v1/me`, {
    headers: { authorization: `Bearer ${session.session_token}` },
    redirect: "manual",
  });
  if (upstream.status === 401) return message("This browser is not provisioned.", 401, clear(SESSION));
  return relay(upstream, session, env);
}

async function logout(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return notAllowed("POST");
  if (!sameOriginMutation(request, env)) return message("Invalid request origin.", 403);
  const session = await readSession(request, env);
  if (session) {
    try {
      await fetch(`${origin(env.API_ORIGIN)}/v1/enrollment/session/revoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.session_token}` },
      });
    } catch {
      // The cookie is cleared either way. The operator kill switch covers a missed revoke.
    }
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store", "set-cookie": clear(SESSION) } });
}

async function proxy(request: Request, env: Env): Promise<Response> {
  if (!ALLOWED_METHODS.has(request.method)) return notAllowed("GET, POST, PUT, PATCH, DELETE");
  if (request.method !== "GET" && !sameOriginMutation(request, env)) return message("Invalid request origin.", 403);
  const session = await readSession(request, env);
  if (!session || expired(session)) return message("This browser is not provisioned.", 401, clear(SESSION));
  const upstream = await api(request, session.session_token, env);
  if (upstream.status === 401) return message("This browser is not provisioned.", 401, clear(SESSION));
  return relay(upstream, session, env);
}

async function api(request: Request, sessionToken: string, env: Env): Promise<Response> {
  const source = new URL(request.url);
  const target = `${origin(env.API_ORIGIN)}${source.pathname.slice(4)}${source.search}`;
  const headers = new Headers({ authorization: `Bearer ${sessionToken}` });
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" ? undefined : request.body,
    redirect: "manual",
  });
}

export async function relay(upstream: Response, session: Session, env: Env): Promise<Response> {
  if (upstream.status >= 300 && upstream.status < 400) return message("Upstream response rejected.", 502);
  const headers = new Headers({ "cache-control": "private, no-store" });
  headers.set("x-content-type-options", "nosniff");
  headers.set("cross-origin-resource-policy", "same-origin");
  for (const name of ["content-type", "content-disposition", "etag", "x-request-id", "x-recall-source-sha256"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookieValue = await sealedCookie(session, env.SESSION_KEY);
  if (!cookieValue) return message("This browser is not provisioned.", 401, clear(SESSION));
  headers.set("set-cookie", cookieValue);
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function readSession(request: Request, env: Env): Promise<Session | null> {
  const value = cookie(request.headers.get("cookie"), SESSION);
  return value ? unseal(value, env.SESSION_KEY) : null;
}

function sessionCookie(value: string, maxAge: number): string {
  return `__Host-${SESSION}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function clear(name: string): string {
  return `__Host-${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
function cookie(header: string | null, name: string): string | null {
  const actual = `__Host-${name}=`;
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(actual))?.slice(actual.length) ?? null;
}
function origin(value: string): string {
  return new URL(value).origin;
}
function fromSite(request: Request, env: Env): boolean {
  return request.headers.get("origin") === origin(env.SITE_ORIGIN);
}
function sameOriginMutation(request: Request, env: Env): boolean {
  return fromSite(request, env) && request.headers.get("sec-fetch-site")?.toLowerCase() !== "cross-site";
}
function expired(session: Session): boolean {
  return session.expires_at <= Math.floor(Date.now() / 1000) + 30;
}
function enrollmentToken(value: string): boolean {
  return value.length <= MAX_TOKEN_CHARS && /^enr_[A-Za-z0-9_-]{20,120}$/.test(value);
}
function notAllowed(allow: string): Response {
  return message("Method not allowed.", 405, undefined, { allow });
}
function message(body: string, status: number, setCookie?: string, other: Record<string, string> = {}): Response {
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...other });
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(body, { status, headers });
}
async function readJson<T>(request: Request): Promise<T | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength > 20_000 || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 20_000) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}
function base64url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function fromBase64url(value: string): Uint8Array | null {
  try {
    const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4));
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
async function key(secret: string): Promise<CryptoKey | null> {
  const bytes = fromBase64url(secret);
  if (!bytes || bytes.length !== 32) return null;
  const raw = new Uint8Array(bytes);
  return crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(value: Session, secret: string): Promise<string> {
  const cryptoKey = await key(secret);
  if (!cryptoKey) throw new Error("Invalid SESSION_KEY");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, new TextEncoder().encode(JSON.stringify(value))),
  );
  const joined = new Uint8Array(iv.length + cipher.length);
  joined.set(iv);
  joined.set(cipher, iv.length);
  return base64url(joined);
}
function validSession(value: Partial<Session>): value is Session {
  return (
    typeof value.session_token === "string" &&
    value.session_token.startsWith("rcs_") &&
    value.session_token.length <= MAX_TOKEN_CHARS &&
    typeof value.expires_at === "number" &&
    Number.isSafeInteger(value.expires_at) &&
    value.expires_at > 0
  );
}
async function sealedCookie(session: Session, secret: string): Promise<string | null> {
  if (!validSession(session)) return null;
  const sealed = await seal(session, secret);
  const remaining = Math.min(604_800, session.expires_at - Math.floor(Date.now() / 1000));
  return sealed.length <= MAX_SESSION_COOKIE_CHARS && remaining > 30 ? sessionCookie(sealed, remaining) : null;
}
async function unseal(value: string, secret: string): Promise<Session | null> {
  const cryptoKey = await key(secret);
  const bytes = fromBase64url(value);
  if (!cryptoKey || !bytes || bytes.length <= 28) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, cryptoKey, bytes.slice(12));
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<Session>;
    return validSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
async function clientKey(request: Request): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`recall-enroll:${ip}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function limited(bucket: string): boolean {
  const now = Date.now();
  if (attempts.size > 1_000) attempts.clear();
  const slot = attempts.get(bucket);
  if (!slot || now - slot.start > 600_000) {
    attempts.set(bucket, { start: now, count: 1 });
    return false;
  }
  slot.count += 1;
  return slot.count > 8;
}

async function asset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set(
    "content-security-policy",
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'",
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("permissions-policy", "camera=(self), geolocation=(), microphone=()");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
