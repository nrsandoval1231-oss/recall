# First builder handoff — RCL-001

Status update: RCL-001 has been implemented (see [DEVELOPMENT](DEVELOPMENT.md) and ACCEPTANCE "RCL-001 evidence"). The text below is the original brief and is kept for scope reference. RCL-002 has not been started.

This is the bounded first-packet brief. The written foundation still needs owner review; do not interpret the existence of this file as authorization to implement every roadmap item or provision paid infrastructure.

## Mission

Make a real photographed source safely available from phone to cloud to desktop. This packet proves Recall's universal trusted-source boundary; it must contain no consulting, maintenance, mining, or other domain assumptions. Do not implement the LLM, semantic search, Claude/MCP, voice, entity inference, a landing page, or a full dashboard in this packet.

Read [PRD](PRD.md), [ARCHITECTURE](ARCHITECTURE.md), [API-CONTRACT](API-CONTRACT.md), [DATA-MODEL](DATA-MODEL.md), [SECURITY-AND-OPERATIONS](SECURITY-AND-OPERATIONS.md), and [ACCEPTANCE](ACCEPTANCE.md) before coding. Follow the root [AGENTS](../AGENTS.md).

## Required scope

1. Inspect the exact current branch and preserve any work added after this foundation. Initialize real package manifests and supported pinned dependency versions only for components needed now.
2. Create the minimal Expo iPhone app: sign-in, camera/import, ordered pages, durable local Save, upload state, recent captures, and original viewer.
3. Create the minimal Tauri Windows app with the same terminology/tokens: sign-in, recent capture list, and authorized original viewer. No decorative fake data.
4. Implement FastAPI routes for identity/device, capture manifest, upload authorization, finalization, listing, and original access. Reuse a standard authentication provider.
5. Add only required Postgres migrations/roles/policies and private Storage configuration. Supply repeatable local integration setup; cloud provisioning is a separate authorized action.
6. Validate MIME/content/size, hash original bytes server-side, enforce workspace ownership, and use stable idempotency keys through retries.
7. Include local-draft restart recovery and server finalization that cannot report success with missing pages. RCL-001 stops at `stored`; no transcription/searchability is implied.
8. Add automated regression coverage plus documented real-device acceptance steps. Update status with what actually runs.

## Do not take shortcuts here

A temporary camera URI is not a durable saved capture. A client-supplied hash is not server verification. A successful upload callback is not a complete verified capture. A private URL is not authorization. A single-account demo is not workspace isolation.

Do not expose Supabase service-role/database-owner credentials to clients. Do not upload any user's real notes, personal data, customer data, or private sources into GitHub, logs, or public test artifacts. Do not hardcode a fake transcript or an optimistic processing status to make a demo look complete.

## Test-first acceptance targets

A01 ordered capture and original viewing; A02 force-close/reopen; A03 retries/idempotency; A04 incomplete/corrupt/oversized content; A05 offline/permission denial; A12 cross-workspace access including source URLs.

Test creation replay with the same operation ID and with a mismatched payload. Test retry after upload before finalize and after finalize before client acknowledgement. Test original retrieval with an unauthorized workspace and an expired authorization. Test source hash equality across device/cloud/downloaded bytes.

## Completion report

Return exact commit, changed files, runnable commands, migration/setup steps, tests passed/failed/skipped, installed-client evidence, and remaining dependencies. Clearly label any mock-only, simulator-only, unsigned-build, or unprovisioned-provider limitation.

Open a scoped PR rather than implementing future packets inside this one. Do not claim the full Recall app is ready because trusted capture works. RCL-002 owns transcription and the first source-backed answer.
