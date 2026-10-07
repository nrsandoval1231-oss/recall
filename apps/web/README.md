# Recall web pilot

The adaptive glass-board UI and palette exploration are recorded in [the design archive](../../docs/design/2026-10-glass-ui/README.md). To try the real UI with synthetic services, run `npm run dev --workspace @recall/web -- --host 127.0.0.1` from the repository root and open `/dev/preview.html` on the local Vite server. This development entry makes no production API, provider or email calls and is excluded from the normal production bundle.

The Cloudflare Worker serves the Vite app, turns a clicked Supabase email link into an encrypted `HttpOnly`, `Secure`, `SameSite=Lax` session, and proxies only the fixed `/api/v1/*` route to the existing Recall API. The UI calls this one-time step “Connect this device”; after it succeeds, the rolling session opens Recall directly for up to 90 days of inactivity. It does not replace the canonical Postgres, private storage, or backend.

The connection request sets an `HttpOnly` ten-minute login nonce. The email redirect carries the matching state to `/auth/callback`; its temporary Supabase fragment is posted once to `/auth/session`, validated by Supabase, encrypted in the Worker cookie, and immediately removed from the URL. The link must be opened in the same browser that requested it; another browser cannot establish a session because it lacks that browser's nonce. A revoked provider session, cleared cookies, key rotation, or 90 days without a visit requires connecting the device again. “Disconnect this device” clears this browser's session and requests a local provider sign-out, following [Supabase's sign-out scopes](https://supabase.com/docs/guides/auth/signout).

Build with `npm run build --workspace @recall/web`, then start an authenticated local Worker with:

```powershell
npx wrangler@4 dev --config apps/web/wrangler.toml --port 8787
```

Set ignored local `.dev.vars` values beside `wrangler.toml`: `API_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SITE_ORIGIN`, and a fresh random 32-byte base64url `SESSION_KEY`. Production `SESSION_KEY` must be supplied with `wrangler secret put SESSION_KEY`, never Vite, Git, or a browser setting. Rotating it signs all web sessions out.

Keep public signups disabled. In Supabase, add the exact deployed `https://…/auth/callback` and its scoped `https://…/auth/callback?state=*` pattern to Auth redirect URLs and retain `{{ .ConfirmationURL }}` in the magic-link email template. The Worker requests `create_user: false`, so only provisioned pilot users can sign in.

Supabase's included email service is currently limited to roughly two messages per hour, which is enough for a one-person smoke test but not a larger pilot. Configure reviewed custom SMTP before expanding the pilot; this application never uses admin link generation to bypass the quota.
