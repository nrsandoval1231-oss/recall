/** Cloudflare Worker: encrypted browser session plus a fixed Recall API proxy. */
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API_ORIGIN: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  /** Base64url encoded random 32-byte secret; configure only as a Worker secret. */
  SESSION_KEY: string;
  SITE_ORIGIN: string;
}

type Session = { access_token: string; refresh_token: string; expires_at: number };
const SESSION = "recall_session";
const PENDING = "recall_login";
const FORWARDED = ["content-type", "idempotency-key", "if-match", "x-request-id"];
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_TOKEN_CHARS = 2_048;
const MAX_SESSION_COOKIE_CHARS = 3_500;
const refreshes = new Map<string, Promise<Session | null>>();

export default { fetch: (request: Request, env: Env) => handle(request, env) };

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== origin(env.SITE_ORIGIN)) return message("Invalid site origin.", 500);
  if (url.pathname === "/auth/request") return requestLogin(request, env);
  if (url.pathname === "/auth/session") return request.method === "GET" ? me(request, env) : establishSession(request, env);
  if (url.pathname === "/auth/me") return me(request, env);
  if (url.pathname === "/auth/logout") return logout(request, env);
  if (url.pathname.startsWith("/api/v1/")) return proxy(request, env);
  if (url.pathname.startsWith("/api/")) return message("Not found.", 404);
  return asset(request, env);
}

async function requestLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return notAllowed("POST");
  if (!fromSite(request, env)) return message("Invalid request origin.", 403);
  const body = await readJson<{ email?: unknown }>(request);
  if (!body || typeof body.email !== "string" || !email(body.email)) return message("Enter a valid email address.", 400);
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const callback = `${origin(env.SITE_ORIGIN)}/auth/callback?state=${encodeURIComponent(nonce)}`;
  const upstream = await fetch(`${origin(env.SUPABASE_URL)}/auth/v1/otp?redirect_to=${encodeURIComponent(callback)}`, {
    method: "POST",
    headers: supabaseHeaders(env),
    body: JSON.stringify({ email: body.email.trim(), create_user: false }),
  });
  if (!upstream.ok) return message("We could not send a sign-in email. Please wait and try again.", upstream.status === 429 ? 429 : 400);
  return new Response(null, { status: 204, headers: { "set-cookie": pendingCookie(nonce) } });
}

async function establishSession(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return notAllowed("POST");
  if (!fromSite(request, env)) return message("Invalid request origin.", 403);
  const body = await readJson<{ access_token?: unknown; refresh_token?: unknown; expires_at?: unknown; state?: unknown }>(request);
  const nonce = cookie(request.headers.get("cookie"), PENDING);
  if (!body || typeof body.access_token !== "string" || typeof body.refresh_token !== "string" || typeof body.state !== "string" || body.access_token.length > MAX_TOKEN_CHARS || body.refresh_token.length > MAX_TOKEN_CHARS || !nonce || !same(body.state, nonce)) return message("This sign-in link is invalid.", 401, clear(PENDING));
  // A clicked email link can establish exactly one session in the browser that requested it.
  const valid = await verifyToken(body.access_token, env);
  if (!valid) return message("This sign-in link is no longer valid.", 401, clear(PENDING));
  const expiresAt = typeof body.expires_at === "number" && Number.isFinite(body.expires_at) ? Math.floor(body.expires_at) : Math.floor(Date.now() / 1000) + 300;
  const session = { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: expiresAt };
  const cookieValue = await sealedCookie(session, env.SESSION_KEY);
  if (!cookieValue) return message("This sign-in session is too large.", 400, clear(PENDING));
  const headers = new Headers();
  headers.append("set-cookie", cookieValue);
  headers.append("set-cookie", clear(PENDING));
  return new Response(null, { status: 204, headers });
}

async function me(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return notAllowed("GET");
  let session = await readSession(request, env);
  if (!session) return message("Sign in again.", 401, clear(SESSION));
  if (session.expires_at <= Math.floor(Date.now() / 1000) + 60) session = await refresh(session, env);
  if (!session) return message("Sign in again.", 401, clear(SESSION));
  let upstream = await fetch(`${origin(env.API_ORIGIN)}/v1/me`, { headers: { authorization: `Bearer ${session.access_token}` }, redirect: "manual" });
  if (upstream.status === 401) {
    session = await refresh(session, env);
    if (!session) return message("Sign in again.", 401, clear(SESSION));
    upstream = await fetch(`${origin(env.API_ORIGIN)}/v1/me`, { headers: { authorization: `Bearer ${session.access_token}` }, redirect: "manual" });
  }
  if (upstream.status === 401) return message("Sign in again.", 401, clear(SESSION));
  return relay(upstream, session, env);
}

async function logout(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return notAllowed("POST");
  if (!fromSite(request, env)) return message("Invalid request origin.", 403);
  const session = await readSession(request, env);
  if (session) {
    // Best effort: local deletion always proceeds, while a valid provider session is revoked too.
    try {
      await fetch(`${origin(env.SUPABASE_URL)}/auth/v1/logout`, { method: "POST", headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${session.access_token}` } });
    } catch {
      // Local revocation must remain reliable when the provider is unavailable.
    }
  }
  return new Response(null, { status: 204, headers: { "set-cookie": clear(SESSION) } });
}

async function proxy(request: Request, env: Env): Promise<Response> {
  if (!ALLOWED_METHODS.has(request.method)) return notAllowed("GET, POST, PUT, PATCH, DELETE");
  if (request.method !== "GET" && !fromSite(request, env)) return message("Invalid request origin.", 403);
  let session = await readSession(request, env);
  if (!session) return message("Sign in again.", 401, clear(SESSION));
  if (session.expires_at <= Math.floor(Date.now() / 1000) + 60) session = await refresh(session, env);
  if (!session) return message("Sign in again.", 401, clear(SESSION));
  let upstream = await api(request, session.access_token, env);
  if (upstream.status === 401 && request.method === "GET") {
    session = await refresh(session, env);
    if (!session) return message("Sign in again.", 401, clear(SESSION));
    upstream = await api(request, session.access_token, env);
  }
  return relay(upstream, session, env);
}

async function api(request: Request, accessToken: string, env: Env): Promise<Response> {
  const source = new URL(request.url);
  const target = `${origin(env.API_ORIGIN)}${source.pathname.slice(4)}${source.search}`;
  const headers = new Headers({ authorization: `Bearer ${accessToken}` });
  for (const name of FORWARDED) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  return fetch(target, { method: request.method, headers, body: request.method === "GET" ? undefined : request.body, redirect: "manual" });
}

export async function relay(upstream: Response, session: Session, env: Env): Promise<Response> {
  if (upstream.status >= 300 && upstream.status < 400) return message("Upstream response rejected.", 502);
  const headers = new Headers({ "cache-control": "private, no-store" });
  headers.set("x-content-type-options", "nosniff");
  headers.set("cross-origin-resource-policy", "same-origin");
  for (const name of ["content-type", "content-disposition", "etag", "x-request-id", "x-recall-source-sha256"]) { const value = upstream.headers.get(name); if (value) headers.set(name, value); }
  const cookieValue = await sealedCookie(session, env.SESSION_KEY);
  if (!cookieValue) return message("Sign in again.", 401, clear(SESSION));
  headers.set("set-cookie", cookieValue);
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function readSession(request: Request, env: Env): Promise<Session | null> { const value = cookie(request.headers.get("cookie"), SESSION); return value ? unseal(value, env.SESSION_KEY) : null; }
async function refresh(session: Session, env: Env): Promise<Session | null> {
  const active = refreshes.get(session.refresh_token);
  if (active) return active;
  const operation = (async () => {
    const response = await fetch(`${origin(env.SUPABASE_URL)}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: supabaseHeaders(env), body: JSON.stringify({ refresh_token: session.refresh_token }) });
    if (!response.ok) return null;
    const value = await response.json() as Partial<Session>;
    return validSession(value) ? value : null;
  })();
  refreshes.set(session.refresh_token, operation);
  try { return await operation; } finally { refreshes.delete(session.refresh_token); }
}
async function verifyToken(token: string, env: Env): Promise<boolean> { return (await fetch(`${origin(env.SUPABASE_URL)}/auth/v1/user`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` } })).ok; }
function supabaseHeaders(env: Env): HeadersInit { return { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`, "content-type": "application/json" }; }

function sessionCookie(value: string): string { return `__Host-${SESSION}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`; }
function pendingCookie(value: string): string { return `${PENDING}=${value}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`; }
function clear(name: string): string { const prefix = name === SESSION ? "__Host-" : ""; return `${prefix}${name}=; Path=${name === PENDING ? "/auth" : "/"}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
function cookie(header: string | null, name: string): string | null { const actual = `${name === SESSION ? "__Host-" : ""}${name}=`; return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(actual))?.slice(actual.length) ?? null; }
function origin(value: string): string { return new URL(value).origin; }
function fromSite(request: Request, env: Env): boolean { return request.headers.get("origin") === origin(env.SITE_ORIGIN); }
function email(value: string): boolean { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function same(left: string, right: string): boolean { if (left.length !== right.length) return false; let result = 0; for (let i = 0; i < left.length; i += 1) result |= left.charCodeAt(i) ^ right.charCodeAt(i); return result === 0; }
function notAllowed(allow: string): Response { return message("Method not allowed.", 405, undefined, { allow }); }
function message(body: string, status: number, setCookie?: string, other: Record<string, string> = {}): Response { const headers = new Headers({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...other }); if (setCookie) headers.set("set-cookie", setCookie); return new Response(body, { status, headers }); }
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
      if (length > 20_000) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } catch { return null; }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as T; } catch { return null; }
}
function base64url(bytes: Uint8Array): string { let raw = ""; for (const byte of bytes) raw += String.fromCharCode(byte); return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, ""); }
function fromBase64url(value: string): Uint8Array | null { try { const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)); return Uint8Array.from(raw, (char) => char.charCodeAt(0)); } catch { return null; } }
async function key(secret: string): Promise<CryptoKey | null> { const bytes = fromBase64url(secret); if (!bytes || bytes.length !== 32) return null; const raw = new Uint8Array(bytes); return crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, "AES-GCM", false, ["encrypt", "decrypt"]); }
async function seal(value: Session, secret: string): Promise<string> { const cryptoKey = await key(secret); if (!cryptoKey) throw new Error("Invalid SESSION_KEY"); const iv = crypto.getRandomValues(new Uint8Array(12)); const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, new TextEncoder().encode(JSON.stringify(value)))); const joined = new Uint8Array(iv.length + cipher.length); joined.set(iv); joined.set(cipher, iv.length); return base64url(joined); }
function validSession(value: Partial<Session>): value is Session { return typeof value.access_token === "string" && value.access_token.length <= MAX_TOKEN_CHARS && typeof value.refresh_token === "string" && value.refresh_token.length <= MAX_TOKEN_CHARS && typeof value.expires_at === "number" && Number.isSafeInteger(value.expires_at) && value.expires_at > 0; }
async function sealedCookie(session: Session, secret: string): Promise<string | null> { if (!validSession(session)) return null; const sealed = await seal(session, secret); return sealed.length <= MAX_SESSION_COOKIE_CHARS ? sessionCookie(sealed) : null; }
async function unseal(value: string, secret: string): Promise<Session | null> { const cryptoKey = await key(secret); const bytes = fromBase64url(value); if (!cryptoKey || !bytes || bytes.length <= 28) return null; try { const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, cryptoKey, bytes.slice(12)); const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<Session>; return validSession(parsed) ? parsed : null; } catch { return null; } }

async function asset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("permissions-policy", "camera=(self), geolocation=(), microphone=()");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
