# MONOLITH web companion

This authenticated PWA is part of the cloud checkpoint described in [ARCHITECTURE](../../docs/ARCHITECTURE.md) and [STATUS](../../docs/STATUS.md). Product scope and trust rules are in [VISION](../../docs/VISION.md); requirements and acceptance gates are in [PRD](../../docs/PRD.md).

The Cloudflare Worker serves the Vite app and proxies only `/api/v1/*` to the Recall API. A provisioned browser opens Recall directly. There is no sign-in screen.

An operator issues a single-use enrollment token from the API (`POST /v1/operator/enrollments` with `RECALL_OPERATOR_TOKEN`). Open that token on the device as a URL fragment, for example `https://<site>/#enr_...`. The page removes the fragment before rendering and posts it once to `/auth/enroll`. The Worker asks the API to consume the token and stores the resulting device session in an encrypted `__Host-` cookie: `HttpOnly`, `Secure`, `SameSite=Lax`. The session token is not written into the page, `localStorage`, or the address bar.

The API stores only hashes. Revocation, the workspace kill switch, and the operator kill switch take effect on the next request. Browser reinstall or clearing site data requires a new enrollment. The service worker caches the app shell only; it does not cache `/api/` or `/auth/`, and it does not answer from memory while offline.

Build with `npm run build --workspace @recall/web`, then start a local Worker with:

```powershell
npx wrangler@4 dev --config apps/web/wrangler.toml --port 8787
```

Set ignored local `.dev.vars` beside `wrangler.toml`: `API_ORIGIN`, `SITE_ORIGIN`, and a fresh random 32-byte base64url `SESSION_KEY`. Production `SESSION_KEY` must be supplied with `wrangler secret put SESSION_KEY`, never Vite, Git, or a browser setting. Rotating it ends existing web sessions. The operator token stays on the API, not in the Worker or the client.

Historical note: an earlier pilot path used Supabase email links and `/auth/callback`. That dependency is retired for this web app. The October 2026 email-provider incident records remain in `docs/history/ACCEPTANCE-LOG-2026-10.md`.

iPhone Add to Home Screen and Windows browser use of this URL are still manual acceptance gates. A green build is not that proof.

