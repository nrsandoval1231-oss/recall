# Developer setup and real-device acceptance (RCL-001)

## Voice development — native implementation

Follow [VOICE-01](../.agent/VOICE-01.md) over accepted TEXT-FILE-01. F0 and the native architecture gate passed. Follow the native contract for exact dependency/asset pins, supported CPU/input formats, durable recording and transcript provenance; backend/UI remain dependent on the frozen native DTO. Preserve v1-v8 compatibility and exact originals in later product work; machine speech transcription must not be treated as human typed text. Invoke validation wrappers with `pwsh`; run backend mypy from `services/backend` when checking shared contracts.

## Current context development — accepted baseline

Follow [CONTEXT-01](../.agent/CONTEXT-01.md) and its replay addendum. Use synthetic sources and fake provider output only. Verify the shared Unicode request/digest, strict bounded v2 context, new purpose-policy decision, source-first capture, current target checks, v7 historical replay and v1-v6 compatibility. Reconcile real temporary-file external renames; inject interruption during durable link suppression, preserve conflicting editor bytes, and expose pending repair. The atomic related-memory command must verify the source connection, target and original together. UI checks cover stale/missing targets and vault changes during opening. The external HTTPS proxy's total-header compatibility is a deployment gate, not proven by in-process route tests.

## Automatic organization development — accepted baseline

Preserve the accepted [ORGANIZE-01](../.agent/ORGANIZE-01.md) behavior. Use a disposable synthetic vault and fake provider for development. Verify that pre-opt-in captures stay local, future text/photo captures save immediately and queue automatically, and offline processing preserves saved sources. Exercise restart recovery, revocation followed by renewed consent, changed source/revision, and corrections both during and after processing. None may duplicate an unknown paid operation or revive stale semantics.

The separate `RECALL_LOCAL_ORGANIZATION_ENABLED` flag defaults to false. Migration 0011 supplies organization receipts and consent keyed by workspace/device/vault. The service additionally requires the exact protected grant, configured provider/budget and current purpose consent. Enabling the flag alone does not opt in a vault. The desktop settings decision establishes the local future-capture marker only after the scoped service decision succeeds.

Voice-transcript organization (AUDIO-ORG-01, local candidate, not activated) is gated by its own `RECALL_LOCAL_AUDIO_ORGANIZATION_ENABLED` flag (default false). Migration 0012 adds `vault_intelligence_audio_organize_consents` with the same key, owner-only row-level security and epoch semantics as the text/photo table, and purge revokes it. Text/photo consent never authorizes audio and audio consent never authorizes text/photo. Routes: `GET /v1/local-intelligence/audio-organization-capability` and `POST /v1/local-intelligence/audio-organization-consent`; the shared organizations routes accept the `v3.` Binding 3.0 header for transcripts only. See `.agent/AUDIO-ORG-01.md`.

To run the database-backed backend tests on this Windows host, use WSL: `PATH=/usr/lib/postgresql/18/bin:/home/nrsan/.local/recall-backend/bin:$PATH PYTHONPATH=$PWD/src ESBUILD_BINARY_PATH=/home/nrsan/.local/recall-node-tools/node_modules/@esbuild/linux-x64/bin/esbuild python -m pytest -q -p no:cacheprovider` from `services/backend`. Without `initdb` on `PATH` those tests skip silently.

Run migration and real PostgreSQL authorization/receipt tests, native journal/compatibility tests, client checks and the local browser journey before freezing the integrated candidate. The v6 writer must preserve v1–v5 history and rendering compatibility. Record independent review against that exact source/docs digest. A synthetic consent flow does not authorize a real grant, provider call or deployment; actual activation and installed-device acceptance remain separately evidenced.

## Local Ask development and activation boundary

The inference app registers `/v1/local-intelligence/ask`, receipt recovery and capability routes. `RECALL_LOCAL_INTELLIGENCE_ENABLED` defaults to false. Migration 0010, a separately scoped owner/device/vault grant, current versioned Ask consent, configured provider and budget policy are required. Local capture and keyword search do not depend on these services.

On an explicitly authorized secured operator host, `python -m recall.pairing_cli --scope vault_intelligence` supplies the separate invitation/revocation path. Invitation creation also requires owner/workspace/device/vault IDs, the fingerprint prepared by the native settings flow and `--approve`. Separate consent uses `--scope vault_intelligence --ask-consent enable` (or `revoke`) with owner/workspace IDs, exact configured `--policy-version` and `--approve`. The CLI requires the owner-role `RECALL_MIGRATION_DATABASE_URL`; never put that credential in the renderer or vault. These are operator instructions, not authorization to activate or spend. Existing photo-only setup remains unchanged.

Windows native checks use the MSVC Rust toolchain. WSL backend tests use real temporary PostgreSQL/pgvector; cross-platform Node tests require an esbuild executable matching the host OS and repository version. Do not replace existing Windows `node_modules` with Linux dependencies. An isolated Linux binary can be selected with `ESBUILD_BINARY_PATH`. Docker Compose configuration validation is offline and can run on Windows when the WSL Docker Desktop wrapper is unavailable. Record split-platform results and actual skips explicitly.

TEXT-01 local check: choose a disposable synthetic vault, write or paste a note, save, reload, search, edit the current note, and open its original. The `.txt` original must retain the exact submitted bytes after correction; photo reading must be unavailable for that source. Exercise failed-save retry with the same operation and text. V5 writes require the current native binary; existing v1-v4 notes/history remain byte-compatible. This is local text capture, not AI text interpretation or natural-language Ask. Exact candidate results are in `.agent/FINISH-02/TEXT-COMPLETION.json`.

## Local-only desktop foundation

Requires Node 22+, npm, Rust 1.89+ and Tauri platform prerequisites. Windows needs MSVC/Windows SDK and WebView2; Linux needs GTK/WebKit development libraries listed below. From the repository root:

```bash
npm ci
npm run tauri -w @recall/desktop -- dev
```

No API, Supabase, AI key, account, `.env`, or cloud configuration is needed for local capture, annotation, evidence and keyword search. Choose a disposable vault folder through the native picker, import a clearly synthetic PNG/JPEG/WebP and optionally add a human note; then search words from the note or filename, view the original, correct the note and inspect History. Optional selected-photo reading requires an owner-associated inference connection, choosing **Read this photo with Claude**, and confirming cloud processing for that photo. A completed proposal appears as an automatically organized Obsidian note candidate; no reading is dispatched merely by opening, searching or importing. For direct Obsidian edits, change only the trailing **Human annotation** region and preserve generated properties, reading sections and the source link. Changes to generated content conflict instead of being overwritten; use **Correct reading** for transcription. Cancelled folder/photo pickers preserve drafts. A correction racing an external annotation edit requires reload and explicit review before saving again.

`npm run dev -w @recall/desktop` runs only the browser preview: it cannot persist a native vault. `npm run build -w @recall/desktop` builds renderer assets; `npm run tauri -w @recall/desktop -- build` builds the native bundle. PR11 CI successfully emitted unsigned artifact `11521925107` in run `37708945255` without cloud variables, with seven-day retention. The lifecycle slice retains this configuration, but needs its own exact-head CI/artifact verification. Neither artifact is a signed release or proof of installation acceptance.

```bash
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:ui
npm run test:local-vault
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

On Windows, WSL2 is an optional way to run the native Rust unit suite when the Windows Rust toolchain is unavailable. From the repository root, run `wsl.exe -- bash -c 'cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml'` with Cargo installed in that WSL distribution. The tests use synthetic fixtures and temporary directories; they do not need a vault path, API key or other user secret. This Linux check does not build or verify the Windows/Tauri application.

Set `RECALL_CHROMIUM=/path/to/chromium` to use a system browser. The separate local suite starts a fresh Vite server on `127.0.0.1:1422` with desktop `VITE_*` cloud settings explicitly empty and injects synthetic Tauri command responses only in tests. It never reuses the regular port-1420 dev server. Rust tests separately exercise native filesystem behavior. Local keyword search over human annotation/filename is not natural-language Ask; selected-photo Claude reading is a separate explicit, connected path and is not OCR or offline generation. See [evidence and limits](implementation/local-vault/README.md). Lifecycle removal/tombstones and explicit missing-note restore retain files/history and provide no secure purge or undelete. Phone-to-vault synchronization, QR pairing, real-data migration and full semantic reconstruction remain open. Failed correction drafts survive the current focus session and cancelled vault selection, but not application restart or deliberate memory/vault exit. Pending import intents persist for explicit retry. Corrupt intent/metadata and publication conflicts can require owner-managed recovery; never delete recovery files to conceal an error.

## Local lifecycle checks and compatibility

On a disposable synthetic vault, a unique Markdown rename must stay directly inside `Recall/Memories`; preserve its stable-ID header and source link. Refresh or rebuild, search the new basename, and confirm corrections keep that name. Nested moves are unsupported; a nested directory may cause conservative conflict rather than a restore option. Duplicate IDs, changed headers and occupied paths must remain diagnostics.

When a note is missing, Recall offers explicit **Restore missing note** or **Remove from Recall**. Removal requires confirmation, appends a logical tombstone and retains original/Markdown/history files. **Removed items** exposes retained history; removed memories are excluded from active keyword search and source viewing. There is no in-app undelete or secure purge. **Rebuild local search** revalidates annotation records, not OCR/AI/semantic memory; failure keeps the prior rows labeled unverified.

Failed restore/removal keeps its original revision/state/operation for **Retry same**. **Reload current state** permits explicit review of a new decision or closing the old one. Decisions survive focus navigation and cancelled selection in that session, but are not persisted across application restart. A stale capture/correction receipt returns current deleted state and must not claim a new save. Interrupted restore after note publication can remain a preserved conflict requiring manual recovery; do not delete journals or originals to hide it.

Unchanged v1 vaults remain readable byte-for-byte. The first v2 mutation retains the old manifest and installs an older-writer refusal fence; reopening v2 with the PR11 binary must fail closed. Downgrade is unsupported. [Future synthetic installed-Windows checklist](ACCEPTANCE.md#future-installed-windows-lifecycle-checklist--blocked) is documentation only: the authorized device is offline, and no other desktop is authorized. PR11 installer/instructions were already delivered; no repeat installation request is needed. Preserve PR11 artifact `11521925107`, run `37708945255`, ZIP reference `file_0000000099f081f599ed9c8fa1be3aa9`; the lifecycle artifact is pending exact-head CI and cannot be replaced by the older installer as evidence.

## Legacy cloud procedures, not local onboarding

Sign-in and provider setup below verify the preserved legacy cloud implementation only. The target requires no account/password/email-link sign-in, including first use; local-only use needs no remote account. PAIR-01 authorizes one manually owner-associated photo-inference device; QR and general synchronization remain out of scope. See the [RCL-005B proposal](superpowers/specs/2026-10-07-rcl-005b-no-signin-vault-design.md). Do not bypass existing private API authentication or change deployed configuration to simulate this target.

## V1 deployment, recovery and acceptance

Apply all checksummed migrations with the owner connection; enable pgvector as administrator first. API and worker connections must be least privilege and cannot own tables or bypass RLS. Fill `infra/api.env.example` and `infra/worker.env.example` into ignored private `.env` files. `docker compose -f infra/pilot.compose.yml up --build` runs API and worker against external Supabase. Bind is local-only by default; place HTTPS/authenticated ingress in front of it. No external infrastructure is provisioned by these templates.

For offline acceptance: installed Windows sign-in → sync → open/hash-check original → correct → disconnect → restart → local search/original → supported correction → reconnect → confirm outbox acknowledgment or visible version conflict. Delete on another client and resync; controlled originals must disappear. Export to a disposable selected root, edit a generated Markdown file, re-export and confirm conflict preservation. Run the backup/restore tests and perform a trusted operator restore into fresh staging before using recovery in production.

Linux and Windows CI run native Rust tests; local Windows builds require MSVC/SDK and WebView2. Tests create real isolated PostgreSQL clusters; Windows requires PostgreSQL binaries on PATH. pgvector-specific tests skip honestly where unavailable and must pass in Linux CI. See [V1-STATUS](V1-STATUS.md) for current recorded evidence and explicit platform/live limits.


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
npm ci                            # workspaces: packages/*, apps/*
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

## Live AI acceptance procedure (RCL-002 exit gate)

Preconditions: owner-approved budget and key, provider retention/training terms reviewed for the account, and a **consented private evaluation set kept outside the repository** (design-partner handwriting plus general-domain pages) with held-out questions written before any tuning.

1. Turn on AI reading in Settings; confirm the explanation names the provider.
2. Capture each evaluation set item; record status (`ready` / `needs_review` / `failed`) and per-capture cost from `ai_usage`.
3. For each page, compare the machine reading with the original: count critical-field errors (numbers, units, names, dates) and any lost "?" or invented certainty (release blockers).
4. Ask each held-out question; record answered/abstained, whether every material sentence is supported by the cited page (entailment), and whether the correct original is cited. Include deliberately unsupported questions; they must abstain.
5. Revoke consent; confirm queued work stops and Ask returns `unavailable` with sources.
6. Record model id, effort, prompt/processor version (`interpret-v1`), dataset version, and results in ACCEPTANCE. Do not tune prompts against the held-out answers.
