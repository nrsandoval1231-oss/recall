# Developer setup and real-device acceptance (RCL-001)

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

### Local object storage

`RECALL_STORAGE_BACKEND=local` writes originals under `RECALL_LOCAL_STORAGE_DIR` (private dir, write-once, server-assigned keys). For Supabase set `RECALL_STORAGE_BACKEND=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only), and create a **private** bucket named `RECALL_STORAGE_BUCKET`. See [infra/supabase](../infra/supabase/README.md).

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

## Real-device acceptance procedure (RCL-001 exit gate)

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
