# First builder handoff — RCL-001

> **HISTORICAL — 2026-10-09 PWA pilot note.** Superseded by the [2026-10-10 amendment](PILOT-CONTRACT.md). The current product center is the desktop Memory Surface, with organized notes in Obsidian and the phone as a capture/ask companion. No login or email-auth UX still applies. PR #16 remains the installable web companion and enrollment transport. The owner visual reference is [memory-surface-reference-2026-10-10.jpg](assets/memory-surface-reference-2026-10-10.jpg).


Status update: RCL-001 has been implemented (see [DEVELOPMENT](DEVELOPMENT.md) and ACCEPTANCE "RCL-001 evidence"). The text below is the original brief and is kept for scope reference. RCL-002 was implemented subsequently; see the dated V1 status ledger.

## Historical web slice (2026-10-10, PR #16)

PR #16 already added the installable `apps/web` PWA and operator enrollment described in [DEVELOPMENT](DEVELOPMENT.md). That code stays. It is an optional companion and enrollment transport. The desktop Memory Surface now writes a local Obsidian vault; how to run it, and what is not device-proven, is in [DEVELOPMENT](DEVELOPMENT.md) and [ACCEPTANCE](ACCEPTANCE.md). Do not deploy the web app as the way to start using Recall. Do not add a sign-in screen to the web companion. Live iPhone Home Screen and Windows browser proof of that companion is still open and is not the launch gate.

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

---

# Packet brief — RCL-002 First Useful Recall

## Vision for this packet

One captured source becomes one **source memory** that can later answer a vague human question, with the original page one tap away, and that says "I don't have evidence for that" instead of guessing. RCL-002 proves the *interpret → retrieve → grounded answer* loop end to end on top of the trusted source layer from RCL-001. It does not try to be smart about identities, time, or corrections yet (RCL-003).

## Outcomes

1. A stored capture is interpreted by one evaluated multimodal configuration into the universal extraction envelope (`extraction.schema.json` v1.1), validated deterministically, and committed as a versioned memory with page transcriptions, summary, mentions, statements, action *suggestions*, and explicit uncertainties.
2. A user can ask in natural language and receive either a grounded answer whose every sentence cites server-issued evidence (with the original page reachable), or an honest `insufficient_evidence` / `ambiguous` / `unavailable`.
3. Nothing reaches a model without workspace consent, server configuration, and an owner-set budget; when any is missing, originals stay fully usable and the UI says why.

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Provider | Anthropic Claude via the official Python SDK, one configuration. Model from `AI_MODEL_ID` (recommended `claude-opus-5-5`, adaptive thinking, effort `high`, structured JSON output, server-side refusal fallback `"default"`). | Strong handwriting/vision + structured output; one configuration per ARCHITECTURE; no model router. Model id is configuration, never hard-coded. |
| Gates | Processing requires (a) workspace AI consent recorded via settings, (b) provider key + model + per-MTok prices configured server-side, (c) daily and monthly USD budgets. | SECURITY "Spend and deployment gates"; consent before private content leaves. |
| Durable work | Postgres `processing_jobs`, `FOR UPDATE SKIP LOCKED` claims, lease token checked at commit, bounded attempts with backoff, unique (capture, input fingerprint, processor version). Separate worker process and least-privilege worker DB role scoped by RLS to the claimed job's workspace. | ARCHITECTURE §5; no Redis/Celery. |
| Model input | Server-made derivatives (EXIF-orientation applied, re-encoded JPEG, metadata stripped, bounded size) from hash-verified originals; originals untouched. | SECURITY "Original storage"; provider limits. |
| Validation | Structural → referential → authority → semantic (verbatim evidence quotes, no new numbers, no invented time words, "?" stays uncertain) → deterministic commit. Hard failures get one repair call per attempt; soft failures drop the item, record why, and mark the capture `needs_review`. | AI-INGESTION validation + trust rules. |
| Retrieval | Postgres full-text (`english` config) over eligible chunks of the current revision with an OR query of the question's lexemes, ranked; no pgvector yet. | ARCHITECTURE §6: keyword first, measure before vectors. |
| Answers | Bounded evidence packet with server citation IDs; structured answer of sentences each citing ≥1 packet ID; server rejects anything else and returns sources. No evidence → abstain without a model call. | AI-INGESTION retrieval; API-CONTRACT Ask. |
| Capture states | `stored → processing → ready | needs_review | failed`, `failed → processing` by explicit bounded retry. A queued-but-unclaimed job leaves the capture `stored` with an honest processing hint. | API-CONTRACT state machine; no optimistic status. |

## In scope

Migration `0002`; worker entrypoint; provider adapter; derivatives; validation/commit; `GET /v1/memories`, `GET /v1/memories/{id}`, `GET /v1/search`, `POST /v1/ask`, `POST /v1/captures/{id}/retry-processing`, `GET|PUT /v1/settings/ai`; capture views with processing state and `memory_id`; mobile + desktop: processing states, memory detail with original, minimal Ask, AI consent setting.

## Out of scope (do not build)

Entity resolution/linking, relationships, corrections, review queue UI, temporal supersession (RCL-003); embeddings/pgvector, offline cache (RCL-004); export/deletion (RCL-005); voice/typed text; proactive anything; multiple models.

## Acceptance targets

A06 clear source → supported interpretation + cited answer with the correct original; A07 ambiguous number/name/"?" stays uncertain; A11 unsupported question abstains; A12 extended to memories/search/Ask; A13 instructions inside a source stay inert; A14 crashed/expired-lease worker cannot commit stale results; A23 vague-recall questions over synthetic multi-domain notes (keyword baseline). **Live-provider quality on real handwriting is a separate, OPEN gate** until an owner-authorized key, budget, and a consented private corpus exist.

## Risks

Model quality on real handwriting is unmeasured; structured-output schema features accepted by the API are unverified live; keyword retrieval will miss paraphrase-only recall (expected; measured before pgvector); per-call cost on 10-page captures; lease expiry on very long calls (lease is generous, no heartbeat yet).
