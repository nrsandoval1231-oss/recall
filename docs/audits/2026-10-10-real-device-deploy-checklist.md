# Real-device deploy checklist (PR #16)

> **HISTORICAL WEB-COMPANION GATE.** The [2026-10-10 amendment](../PILOT-CONTRACT.md) says not to run this checklist as the way to start using Recall. PR #16 stays. This list is only for a later optional browser companion. See [the realignment audit](2026-10-10-obsidian-desktop-realignment.md).

Date: 2026-10-10. Audience: Nick Sandoval.

This is the manual gate for the installable web companion after [PR #16](https://github.com/nrsandoval1231-oss/recall/pull/16) is merged. Automated tests in that PR do not check these boxes. **This PR does not claim any item below is already passed.** Leave each box unchecked until that step is done on the real host and devices, then record device, OS, browser, commit, and deviations in [ACCEPTANCE](../ACCEPTANCE.md).

Do not write secret values, enrollment tokens, or session cookies into git, the PR, or this file. Do not call a paid model for this gate.

## Checklist

- [ ] **1. Set the host secrets by name.** On the API host, in the ignored `infra/api.env` (see `infra/api.env.example`), set `RECALL_OPERATOR_TOKEN` (at least 32 characters, API only) and `RECALL_SITE_ORIGINS` to the exact HTTPS origin of the site. On Cloudflare, set `SESSION_KEY` with `npx wrangler@4 secret put SESSION_KEY` from `apps/web` (32-byte base64url, Worker secret only). `RECALL_OPERATOR_TOKEN` stays off the Worker and out of the client. `SESSION_KEY` stays out of `wrangler.toml`, Vite, and git. Rotating `SESSION_KEY` ends existing web sessions.

- [ ] **2. Deploy web and API on the existing path.** Apply pending migrations, including `0008_device_enrollment.sql`, with the owner connection (`python -m recall.db.migrate`) on the existing API database. Redeploy the API from `infra/` with the existing Compose files in [infra/README.md](../../infra/README.md) (`pilot.compose.yml` and `pilot.https.compose.yml`). The current API hostname is `recall.159-203-35-38.sslip.io`. Build the web app with `npm run build --workspace @recall/web`, then deploy the existing Worker with `npx wrangler@4 deploy --config apps/web/wrangler.toml` (`name = "recall-web"`). `API_ORIGIN` in that file already points at the API host. Confirm the deployed site origin matches `RECALL_SITE_ORIGINS` and `SITE_ORIGIN`.

- [ ] **3. Issue one enrollment and open it on a fresh browser.** From the operator machine, `POST /v1/operator/enrollments` with `Authorization: Bearer` and the operator token. On a browser that has never had a Recall cookie, open the site first and confirm the unprovisioned screen: no email field, password, passkey, magic link, OTP, or sign-in button. Then open `https://<site>/#<enrollment_token>` once. Confirm Recall opens into the Memory Surface, the fragment is gone from the address bar, and a refresh still opens memory. Discard the token after use. Do not put it in a query string, bookmark, or chat log.

- [ ] **4. iPhone Safari Add to Home Screen.** In Safari, open the deployed URL, use Add to Home Screen, and launch the icon. Confirm the icon, the name Recall, and standalone display (the Safari address bar is gone). Confirm the layout clears the notch and the home indicator.

- [ ] **5. Windows browser smoke.** Open the same URL in a Windows desktop browser. Confirm the page loads without an Expo, Tauri, or NSIS install. Confirm an unprovisioned window shows the same unprovisioned screen and no login UI. Install or pin only if that browser offers it; record what it offered.

- [ ] **6. Negative checks.** Revoke the enrolled session with `POST /v1/operator/sessions/<id>/revoke` and confirm the next request on that device is denied and the UI returns to the unprovisioned screen. On a second browser that was never enrolled, confirm access is denied. From the enrolled device, confirm a capture or original that belongs to another workspace is denied (the session stays on its enrolled workspace).

- [ ] **7. Record the result honestly.** This file and PR #16 do not mark items 1–6 passed. After they are done, add a dated ACCEPTANCE note with the commit that was deployed. Anything skipped stays **OPEN**.
