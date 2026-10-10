# Developer setup and real-device acceptance (RCL-001)

> **HISTORICAL — 2026-10-09 PWA pilot note.** Superseded by the [2026-10-10 amendment](PILOT-CONTRACT.md). The current product center is the desktop Memory Surface, with organized notes in Obsidian and the phone as a capture/ask companion. No login or email-auth UX still applies. PR #16 remains the installable web companion and enrollment transport. The owner visual reference is [memory-surface-reference-2026-10-10.jpg](assets/memory-surface-reference-2026-10-10.jpg).


## V1 deployment, recovery and acceptance

Apply all checksummed migrations with the owner connection; enable pgvector as administrator first. API and worker connections must be least privilege and cannot own tables or bypass RLS. Fill `infra/api.env.example` and `infra/worker.env.example` into ignored private `.env` files. `docker compose -f infra/pilot.compose.yml up --build` runs API and worker against external Supabase. Bind is local-only by default; place HTTPS/authenticated ingress in front of it. No external infrastructure is provisioned by these templates.

For offline acceptance: installed Windows sign-in → sync → open/hash-check original → correct → disconnect → restart → local search/original → supported correction → reconnect → confirm outbox acknowledgment or visible version conflict. Delete on another client and resync; controlled originals must disappear. Export to a disposable selected root, edit a generated Markdown file, re-export and confirm conflict preservation. Run the backup/restore tests and perform a trusted operator restore into fresh staging before using recovery in production.

Linux and Windows CI run native Rust tests; local Windows builds require MSVC/SDK and WebView2. Tests create real isolated PostgreSQL clusters; Windows requires PostgreSQL binaries on PATH. pgvector-specific tests skip honestly where unavailable and must pass in Linux CI. See [V1-STATUS](V1-STATUS.md) for current recorded evidence.


Instructions only. Product scope lives in [PRD](PRD.md); evidence lives in [ACCEPTANCE](ACCEPTANCE.md) ("RCL-001 evidence").

## Prerequisites

| Tool | Version used | For |
| --- | --- | --- |
| Node + npm | 22 / 10 | all TypeScript packages (npm workspaces) |
| Python + [uv](https://docs.astral.sh/uv/) | 3.12+ (tested 3.13) | backend |
| PostgreSQL server binaries (`initdb`, `pg_ctl`) | 16 | backend tests start a throwaway cluster themselves |
| Docker (optional) | any | `scripts/dev-db.sh` local database |
| Rust + Tauri system libs | stable; Linux: `libwebkit2gtk-4.1-dev libsoup-3.0-dev librsvg2-dev libxdo-dev libssl-dev` | desktop native crate |
| Xcode + Apple developer account (iPhone) / Windows + WebView2 + MSVC build tools | | real-device builds (not needed for tests) |
| A Supabase project (Auth + private Storage) | | live acceptance only (not needed for tests) |

## Install

```bash
npm install                       # workspaces: packages/*, apps/*
cd services/backend && uv sync    # uses uv.lock
```

## Backend

Environment variables are listed in `.env.example` (names only). Minimum for local development:

```bash
scripts/dev-db.sh up              # Docker PG16, roles, migrations; prints the exports below
export DATABASE_URL=...           # recall_api role (NOT the owner)
export RECALL_MIGRATION_DATABASE_URL=...   # recall_owner role
export RECALL_SIGNING_SECRET=...  # >= 32 chars
export RECALL_AUTH_ISSUER=https://<project>.supabase.co/auth/v1
export RECALL_AUTH_JWKS_URL=https://<project>.supabase.co/auth/v1/.well-known/jwks.json
export RECALL_STORAGE_BACKEND=local RECALL_LOCAL_STORAGE_DIR=.recall-storage
cd services/backend
uv run python -m recall.db.migrate                       # apply; add --check to verify nothing is pending
uv run uvicorn recall.api.app:app_factory --factory --port 8000
```

Without Docker, create two login roles yourself in any PostgreSQL 16: an **owner** (`createrole`, owns the database) and an **API role** (`nosuperuser nobypassrls`); run migrations as the owner, then `grant recall_app to <api role>`. The API refuses to start if its role is a superuser, has `BYPASSRLS`, or owns the tables.

Migrations are plain ordered SQL in `services/backend/migrations/`, checksummed in `schema_migrations`; editing an applied file is an error. If `RECALL_AUTO_PROVISION_WORKSPACES=false`, provision a user with `python -m recall.db.provision <auth-user-uuid>`.

## Web companion (installable PWA, no login screen)

`apps/web` is the optional companion from PR #16, not the product center. `npm run build --workspace @recall/web` emits the Vite app, `manifest.webmanifest`, icons, and `sw.js`. The same URL is what iPhone Safari uses for Add to Home Screen and what a Windows browser opens. That manual check is still open; the build does not perform it, and it is not the launch gate.

Set `RECALL_OPERATOR_TOKEN` (at least 32 characters) only on the API. Unset, the operator routes respond 404. Issue a device with:

```bash
curl -s -X POST "$API/v1/operator/enrollments" \
  -H "Authorization: Bearer $RECALL_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"pilot phone"}'
```

The response contains `enrollment_token` once. On the device, open `https://<site>/#<enrollment_token>` and do not put that token in a query string, bookmark, or chat log after it has been used. The page strips the fragment and the Worker stores a revocable session cookie. `RECALL_SITE_ORIGINS` must include the site origin or an `Origin` header is rejected. Revoke one session with `POST /v1/operator/sessions/<id>/revoke`, one workspace with `POST /v1/operator/workspaces/<id>/revoke-sessions`, or every device with `POST /v1/operator/kill-switch`.

Provider JWTs still authenticate the preserved native clients. The web Worker does not call the email identity provider. Supabase in this repository remains the private object-storage option and the historical email-login record, not the pilot sign-in path.

### Local object storage

`RECALL_STORAGE_BACKEND=local` writes originals under `RECALL_LOCAL_STORAGE_DIR` (private dir, write-once, server-assigned keys). For Supabase set `RECALL_STORAGE_BACKEND=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only), and create a **private** bucket named `RECALL_STORAGE_BUCKET`. See [infra/supabase](../infra/supabase/README.md).

## AI processing (RCL-002, optional)

Off unless every `AI_*`/budget variable in `.env.example` is set **and** a workspace turns it on in Settings. Calling a live provider costs money: get the owner's approval and set budgets first.

```bash
# server env (both API and worker): AI_PROVIDER=anthropic AI_MODEL_ID=claude-opus-5-5 AI_API_KEY=... \
#   AI_INPUT_USD_PER_MTOK=... AI_OUTPUT_USD_PER_MTOK=... RECALL_AI_DAILY_BUDGET_USD=... RECALL_AI_MONTHLY_BUDGET_USD=...
export RECALL_WORKER_DATABASE_URL=...   # login role that inherits recall_worker (scripts/dev-db.sh creates recall_worker_login)
cd services/backend && uv run python -m recall.ingestion.worker
```

Prices must be the provider's current published prices for the configured model; they are only used to stop spending at the budget. The worker refuses to start with an owner, superuser, `BYPASSRLS`, or non-`recall_worker` role.

## Mobile (Expo, iPhone)

```bash
cp .env.example apps/mobile/.env   # fill EXPO_PUBLIC_* only (public values)
cd apps/mobile
npx expo start                     # Expo Go cannot be used for the final acceptance; see below
npm run typecheck && npm test
npx expo export --platform ios     # JS bundle check, no device or signing needed
```

Camera, photo import, SecureStore, and the file adapter need a real iPhone build (`npx expo run:ios --device` or an EAS development build; requires an Apple developer account, which this repository does not provision). The app refuses to run without its three `EXPO_PUBLIC_*` values rather than falling back to a fake mode.

## Desktop (Tauri 2, Windows)

```bash
cp .env.example apps/desktop/.env  # fill VITE_* only (public values)
cd apps/desktop
npm run dev          # Vite only (no native secret store)
npx tauri dev        # full app; Windows needs WebView2 and MSVC build tools
npx tauri build      # NSIS installer (unsigned unless you configure signing)
npm run typecheck && npm test
cd src-tauri && cargo test --lib && cargo check
```

Add the desktop origin to the API: `RECALL_CORS_ORIGINS=http://tauri.localhost` (Tauri 2 on Windows). Dev server: `http://localhost:1420`.

## Tests

```bash
cd services/backend && uv run ruff check . && uv run mypy src && uv run pytest -q   # real PG cluster, incl. e2e
npm run lint && npm run typecheck && npm test                                         # all TypeScript packages
```

`services/backend/tests/test_e2e_clients.py` launches a real uvicorn + Postgres and drives the TypeScript sync engine and API client (`tests/e2e/rcl001.e2e.ts`). It skips with a message if `npm install` has not been run.

## Real-device acceptance procedure (web companion, not the launch gate)

This is the open gate for the optional installable web app from PR #16. It is not the way to start using Recall, and it is not satisfied by CI. The host order is the unchecked list in [Real-device deploy checklist](audits/2026-10-10-real-device-deploy-checklist.md). That checklist does not record the gates as passed.

Preconditions: deployed HTTPS API and web origin, `RECALL_OPERATOR_TOKEN` set only on the API, `RECALL_SITE_ORIGINS` set to that origin, private storage, and two provisioned workspaces. Use synthetic or personally owned pages kept outside the repository. Do not call a paid model for this gate.

1. On an iPhone, open the site in Safari, use Add to Home Screen, and launch the icon. Confirm the name Recall, the icon, standalone display, and that the layout clears the notch and home indicator.
2. On Windows, open the same URL in a desktop browser. Confirm it loads the Memory Surface without an install step.
3. Before enrollment, confirm the phone and the Windows browser both stop at the unprovisioned state and do not show email, password, or a sign-in link.
4. Enroll the phone from an operator-issued fragment. Confirm Recall opens into memory, the fragment is gone from the address bar, and refreshing still opens memory.
5. Photograph a note, save it, and confirm the original is on the server with a matching SHA-256. Ask on the enrolled Windows browser and open that same original.
6. Revoke the phone session from the operator API. Confirm the phone loses captures and originals, and the Windows session for the other workspace still cannot read them.
7. Replay the used enrollment fragment and confirm it does not create a second session.

Record device, OS, browser, commit, and every deviation in ACCEPTANCE. Anything not done stays **OPEN**.

## Historical real-device procedure (RCL-001 native exit gate)

The steps below describe the earlier native sign-in build. They are historical email-login steps, not the desktop vault slice.

Preconditions: live Supabase project (signups restricted), deployed or tunneled HTTPS API with private storage, a signed iPhone build, an installed Windows build, and two test accounts. Use **synthetic or personally owned test pages kept outside the repository**.

1. Sign in on the iPhone and on Windows with the same account; confirm the Windows list is honestly empty.
2. On the iPhone, photograph 3 pages (retake one, reorder two, remove one then add it back), add a one-line hint, tap **Save**. Confirm **Saved on this device** appears immediately.
3. Enable airplane mode before step 2 for one run; confirm the capture stays **Saved on this device** and never says Uploaded.
4. Force-close the app right after Save; relaunch; confirm the capture is still there and resumes uploading.
5. Interrupt an upload (toggle airplane mode mid-upload); confirm **Failed — retry available** with the capture intact, then retry to **Uploaded**.
6. On Windows, open the capture: pages in order, **✓ Verified** per page, "Save exact copy" for each page.
7. Compute SHA-256 of the files exported from the iPhone (Files/AirDrop of the original asset) and of the Windows "Save exact copy" outputs; record them next to the server hashes shown in the viewer. All three must match.
8. Sign in as the second account on Windows; confirm none of the first account's captures or sources are visible.
9. Record device models, OS versions, build identifiers, commit SHA, and every observed deviation in ACCEPTANCE.

Report anything not performed as **OPEN**, never as passed.

## Live AI acceptance procedure (RCL-002 exit gate)

Preconditions: owner-approved budget and key, provider retention/training terms reviewed for the account, and a **consented private evaluation set kept outside the repository** (design-partner handwriting plus general-domain pages) with held-out questions written before any tuning.

1. Turn on AI reading in Settings; confirm the explanation names the provider.
2. Capture each evaluation set item; record status (`ready` / `needs_review` / `failed`) and per-capture cost from `ai_usage`.
3. For each page, compare the machine reading with the original: count critical-field errors (numbers, units, names, dates) and any lost "?" or invented certainty (release blockers).
4. Ask each held-out question; record answered/abstained, whether every material sentence is supported by the cited page (entailment), and whether the correct original is cited. Include deliberately unsupported questions; they must abstain.
5. Revoke consent; confirm queued work stops and Ask returns `unavailable` with sources.
6. Record model id, effort, prompt/processor version (`interpret-v1`), dataset version, and results in ACCEPTANCE. Do not tune prompts against the held-out answers.
