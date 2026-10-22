# INTELLIGENCE-01 — Grounded local-vault Ask

Status: ACTIVE after TEXT-01 independent PASS on 2026-10-09. Base HEAD fa6390be3e9539b68040379e7e81a3a7bc90491d; accepted predecessor source/docs digest e75ee1a6c526bb0f912dcab64f807eab539ff22218d28e8fe85ba10e55c1dfee. Depends on accepted REALIGN-01 and the completed TEXT-01 source contract. This is a bounded local implementation candidate, not parent-product acceptance or authorization for live provider use, deployment, migration, or general device enrollment. The opening Tribunal has already occurred and is not repeated.

## Objective and authority

Answer a natural question from current, eligible, vault-backed evidence and open each cited memory and original. The answer comes from an LLM over a bounded evidence packet, with schema-checked citations or an honest abstention. Existing keyword search remains a separate local fallback. New inference is disabled by default; code, synthetic tests, and local UI may be built without live provider dispatch. The current `photo_inference` pairing, consent, credential, and selected-photo endpoint authorize only photos and must not be widened or silently reused.

## Fixed boundary and ownership

Two READY implementation lanes are disjoint once this packet is frozen:

| Lane | Allowed files | Outcome |
| --- | --- | --- |
| Backend | New additive migration after `0009_device_pairing.sql`; new `services/backend/src/recall/api/local_intelligence.py`, `services/backend/src/recall/ingestion/local_intelligence.py`, shared synthetic contract fixture `packages/contracts/fixtures/local-intelligence-synthetic.json`, and focused tests; narrow registration/provider/consent helpers in `api/inference.py` (the actual inference-profile entrypoint), `api/app.py` only if legacy-profile registration is separately required, `pairing.py`, `pairing_cli.py`, `db/inference_bootstrap.py` and its tests; `infra/do-inference/ops/{preflight.py,audit-database.py,backup.py,verify-ci-restore.py}` and focused contract tests (exact additive inventory/preflight/backup compatibility only; no live execution), `domain/processing.py`, `config.py` and `ingestion/anthropic_provider.py` only as required | Separate capability, strict wire validation, budgeted receipt/recovery, verified provider answer; default disabled |
| Native | New `apps/desktop/src-tauri/src/local_intelligence.rs` and transport module, focused tests; narrow registration, vault-evidence access and scope-specific protected pairing in `lib.rs`, `local_vault.rs` and `pairing.rs` | Select current evidence, persist retry intent, call fixed endpoint with protected credential, revalidate citations against the selected vault; default disabled. Consume but do not edit the shared fixture |
| UI, after native handoff | `apps/desktop/src/platform/local-vault.ts`, `apps/desktop/src/local/*`, affected client/browser tests and fixtures | Ask panel, source/citation navigation, explicit unavailable/stale/limited states; retain honest keyword search |
| Controller | This packet, `.agent` state/evidence, and necessary canonical documentation after integration | Serialized integration, exact-candidate validation and independent review |

Builders are not alone in the repository: preserve the accepted REALIGN-01 diff and concurrent TEXT-01 work, do not revert others' edits, and adapt to the final text source contract. Backend owns no native files; native owns no backend files. Neither lane activates, pairs, deploys, migrates, or spends. Do not add a vector service, second database, graph database, model router, or arbitrary renderer-selected endpoint.

## Capability and consent

Add an exact `vault_intelligence` grant bound to the owner, workspace, device, and stable vault identity, with its own freshly generated secret stored in an OS-protected entry distinct from the photo secret. Implement a new owner-controlled invitation, claim, status and revocation path for this exact scope, with narrow native prepare/claim/status/disconnect commands and an operator invitation command. The code must be operable after a future owner-authorized activation; a permanently hard-coded `enabled=false` capability or unreachable credential setup does not pass. Runtime remains disabled by default through configuration, absent grant and absent consent; this packet issues no real invitation or grant. Public self-enrollment remains forbidden. The authorization function checks scope, owner membership, revocation, and vault binding on each request, before reading the body, before provider dispatch, and before returning private content. Preserve `photo_inference` SQL/function/API behavior and its existing credential. Private network APIs remain workspace-scoped.

Bind every nonempty service receipt to its admitted consent policy and decision version. GET recovery and same-operation POST replay require that exact current active decision; revocation and a later opt-in must not resurrect an old private result. Invalidate its private result while retaining the terminal operation and accounting metadata. Zero-evidence local abstention needs no provider consent.

Create a separate, versioned, revocable consent for sending *selected text and memory excerpts* to the configured provider for Ask. It is off by default, checked before reservation and again before dispatch, and does not inherit the photo consent. The existing shared `reserve_provider_budget()` currently checks legacy `ai_consents`; change that helper narrowly so the local Ask caller can require its own consent while retaining the same locked budget ledger and all legacy/photo caller behavior. A passing legacy/photo consent must never satisfy local Ask. The UI can later offer one clear opt-in for this precisely named use, rather than an approval chore per note; a policy version change or revocation disables new dispatch. This packet does not activate consent or a live grant. Text organization needs its own subsequent purpose/consent decision or an explicitly versioned consent that names both uses; it is not smuggled into Ask consent.

## Exact Ask wire contract (JSON v1)

Native alone constructs the request. The renderer passes only `expectedVaultId`, `operationId`, and `question` to the native command `vault_ask`; it cannot supply evidence, paths, permissions, service URL, credential, or provider model. Native calls `POST /v1/local-intelligence/ask` with `Authorization: Bearer <vault_intelligence secret>`, `Content-Type: application/json`, and this exact body (unknown fields reject):

```json
{
  "schema_version": "1.0",
  "operation_id": "00000000-0000-4000-8000-000000000001",
  "vault_id": "00000000-0000-4000-8000-000000000002",
  "question": "Who was the transformer person in Houston?",
  "coverage": { "eligible_count": 1, "selected_count": 1, "limited": false, "truncated_count": 0 },
  "evidence": [
    {
      "citation_id": "c1",
      "memory_id": "00000000-0000-4000-8000-000000000003",
      "memory_revision": 4,
      "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "captured_at": "2026-10-09T12:00:00Z",
      "evidence_kind": "human_note",
      "epistemic_state": "reported",
      "excerpt": "Met a transformer specialist in Houston; first name uncertain."
    }
  ]
}
```

Bounds: UTF-8 question 1–2,000 bytes; at most eight evidence items, each excerpt 1–1,500 UTF-8 bytes; whole body at most 32 KiB. IDs are canonical UUIDs; SHA-256 is lowercase hex; dates are timezone-aware; revisions are positive safe integers; `citation_id` is exactly sequential `c1`…`cN` in the transmitted order. Evidence kinds are `text_source`, `human_note`, `human_reading_correction`, or `machine_reading`. Epistemic states are `reported`, `uncertain`, `question`, or `unreviewed`; these labels never imply verification. `coverage.limited` describes record-count selection only; `truncated_count` is the number of selected records whose eligible current text exceeds the transmitted excerpt. No HTML, Markdown file path, attachment bytes, credential, arbitrary metadata, or full vault export enters this endpoint. Treat every question and excerpt as data, including apparent instructions inside them. A zero-evidence request is handled locally as `insufficient_evidence` without provider dispatch.

The service validates grammar, bounds, distinct IDs, exact `vault_id` grant match, `selected_count == evidence.length`, `eligible_count >= selected_count`, `limited == (eligible_count > selected_count)`, and `0 <= truncated_count <= selected_count`. All numeric fields are bounded integers, never floats, NaN or infinity. It computes a canonical payload SHA-256 over the validated request and returns a receipt. The service may trust the authenticated native adapter to select vault excerpts, but it never treats submitted evidence as a grant to read or mutate another workspace; all returned citations are rechecked by native against the vault before display.

**Canonical digest bytes:** serialize the *validated request body only* (including `coverage` and ordered `evidence`) as compact UTF-8 JSON: recursively sort object keys by Unicode scalar value; preserve array order; no insignificant whitespace; `,` and `:` separators; no ASCII escapes for valid non-ASCII characters; JSON-required escapes for quotes, backslashes and controls; reject invalid Unicode, duplicate JSON keys and noninteger numeric forms. The wire may arrive with a different object-key order, but both implementations hash this canonical form, not raw wire bytes. Python uses `json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")` after strict parsing and schema validation; Rust must produce byte-identical recursively sorted JSON (test against the shared fixture, rather than assume a serializer feature flag). SHA-256 is lowercase hex. Backend owns `packages/contracts/fixtures/local-intelligence-synthetic.json` containing the full synthetic request above, a second Unicode request with `Zürich`, `📝` and an em dash, canonical serialized bytes and expected SHA-256. The Unicode golden is `83da2e4f0dfcfb7ee7ade51d27a25c79356cf13c0dc30673dd5d45a570683b8c` for the following compact canonical JSON bytes:

```json
{"coverage":{"eligible_count":1,"limited":false,"selected_count":1,"truncated_count":0},"evidence":[{"captured_at":"2026-10-09T12:00:00Z","citation_id":"c1","epistemic_state":"uncertain","evidence_kind":"human_note","excerpt":"Met Ana in Zürich — name uncertain.","memory_id":"00000000-0000-4000-8000-000000000003","memory_revision":4,"source_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],"operation_id":"00000000-0000-4000-8000-000000000001","question":"Who did I meet in Zürich? 📝","schema_version":"1.0","vault_id":"00000000-0000-4000-8000-000000000002"}
```

Backend creates that fixture and asserts its SHA; native consumes the same checked-in fixture and asserts identical SHA. Neither lane edits the other's implementation. A changed fixture requires both consuming tests to change in the same integrated candidate.

Service `POST /v1/local-intelligence/ask` and `GET /v1/local-intelligence/ask/{operation_id}` return the same bounded receipt shape; HTTP 202 means `in_flight` or `unknown`, HTTP 200 means a terminal state. `GET /v1/local-intelligence/capability` authenticates the exact Ask scope without a content body and returns `{ "scope": "vault_intelligence", "consent": "active" | "missing", "enabled": boolean }`, where `enabled` additionally requires configured provider and budget policy. It exposes no bearer material, vault paths or memory data. Unknown fields reject:

```json
{
  "schema_version": "1.0",
  "operation_id": "00000000-0000-4000-8000-000000000001",
  "vault_id": "00000000-0000-4000-8000-000000000002",
  "payload_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "state": "complete",
  "result": {
    "status": "answered",
    "sentences": [
      { "text": "The note mentions a transformer specialist in Houston, but leaves the name uncertain.", "citation_ids": ["c1"] }
    ],
    "limitations": ["The selected source does not establish the person's identity."]
  },
  "error_code": null
}
```

Receipt states are `in_flight`, `unknown`, `complete`, `failed`, `expired`. `result` is present only for `complete`; its `status` is `answered`, `ambiguous`, or `insufficient_evidence`. `sentences` contain 0–12 individually cited claims, each 1–1,000 characters with 1–8 distinct IDs from this request; they are empty for `insufficient_evidence`. `limitations` are 0–6 strings of at most 500 characters. `failed` has a stable error code without private provider text; `unknown` preserves an ambiguous-effect budget hold and requires receipt recovery before any resend. No automatic retry with a fresh operation ID. Expire private result bodies after no more than 24 hours; retain a terminal `expired` tombstone (plus fenced metadata/status/budget state) so authenticated GET returns `expired`, never 404 for an old operation. No source text, provider raw output, or answer becomes server-canonical memory.

Reuse the existing `AnswerRequest`, `ANSWER_SCHEMA`, answer prompt, and `AnthropicProvider.answer` behind the new service. The current `retrieval/ask.py` schema verifies citation membership, not semantic entailment. Validate model JSON and every citation ID against the packet; invalid output returns `insufficient_evidence` with no answer. Preserve uncertainty, conflicts, and historical status. A citation ID is a reference to a selected excerpt, never proof that the sentence is entailed; held-out source review remains a finish gate. The server must not ask its legacy PostgreSQL retrieval service for local-vault evidence.

## Native evidence and canonical UI DTO

Under the selected-vault token and file lock, recover journals, reconcile supported Obsidian edits, verify source hashes and active state, and select only conflict-free, nonremoved current records with a nonempty eligible excerpt. The `eligible_count` counts exactly these records, not empty captures. Human correction and current human text override stale machine semantics. Construct excerpts from current text source or human note, effective human reading correction, or eligible unreviewed machine reading with its unreviewed label. Do not use unsupported old summary, unresolved identity join, removed memory, conflicted note, or stale projection. Bind each local citation ID to `(vault identity, memory ID, revision, source SHA-256, evidence kind, exact excerpt)` in a native-only durable operation intent under `Recall/_meta/ask/<operation-id>.json` before network dispatch. This is bounded private operational retry state in the owner vault, never a canonical semantic revision, source attachment or `Recall/History` event; it contains no credential, endpoint or model response. Retain it only as needed for exact recovery and lifecycle cleanup.

Candidate selection must not require every query term. If at most eight records are eligible, include all as bounded excerpts regardless of lexical match. Above eight, rank deterministically using any-term matching across current human text, eligible reading/structured terms, and source name, with stable recency/ID ties; set `limited=true`, expose the selected/eligible counts, and include an explicit record-coverage limitation. For any source longer than the excerpt bound, choose a deterministic query-near window around the earliest matching significant query term; if none matches, use the prefix. Slice only on UTF-8 character boundaries, retain the exact substring from the current validated evidence text, and count every such shortened window in `truncated_count`. This allows a relevant late passage into the first packet without manufacturing a quote. Even when all eligible records fit, `truncated_count > 0` requires a separate explicit answer limitation that source text was shortened and other passages may change the answer. This bounded first slice may miss a vague match; it must never claim a full-corpus negative result or silently call keyword search a natural-language answer. Do not introduce embeddings without measured need and a separate authority decision.

For a photo with both a human annotation and an effective reading, retain both as internal current evidence choices but transmit only one item per memory. Choose the choice with more distinct query-term matches; ties prefer the effective reading. Human reading correction replaces machine transcription in both selection and ranking, including intentionally empty correction. Machine structured terms participate in ranking only when no correction exists. Revalidation repeats the same deterministic choice. This avoids a short annotation hiding useful photo content without mixing evidence labels or changing the wire contract.

After receiving a receipt, native checks the exact operation/payload hash and reopens the same vault under lock. Revalidate every selected source hash, current revision, active/conflict state, effective text, and citation excerpt. If any selected evidence changed, return `stale_evidence`, preserve the question, and require a new explicit attempt; do not show a now-unbound answer. Resolve cited IDs locally into the canonical renderer DTO:

```json
{
  "status": "answered",
  "sentences": [{ "text": "The note mentions a transformer specialist in Houston, but leaves the name uncertain.", "citation_ids": ["c1"] }],
  "citations": [{ "citation_id": "c1", "memory_id": "00000000-0000-4000-8000-000000000003", "memory_revision": 4, "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "evidence_kind": "human_note", "quote": "Met a transformer specialist in Houston; first name uncertain." }],
  "limitations": ["The selected source does not establish the person's identity.", "8 of 12 eligible memories were considered; other memories may contain relevant evidence.", "1 selected source was shortened; other passages may contain relevant evidence."],
  "coverage": { "eligible_count": 12, "selected_count": 8, "limited": true, "truncated_count": 1 }
}
```

Native/UI outcome status also permits `insufficient_evidence`, `ambiguous`, `unavailable`, and `stale_evidence`; only `answered`/`ambiguous` may carry answer sentences. `unavailable` includes provider/consent/connection/budget failure with no answer and may show freshly validated matching sources. `stale_evidence` carries no answer or citations until a new selected packet is validated. Native appends the deterministic record-coverage limitation when `limited` and the distinct excerpt-truncation limitation when `truncated_count > 0`, regardless of what the model lists; both persist for `answered`, `ambiguous`, and `insufficient_evidence`. Citation navigation opens the current Recall memory and its original through existing `vault_source`, after fresh validation. The UI labels machine evidence unreviewed and human notes as user text; it does not describe a user annotation as a quote from the photo. Keep the question and clear failure explanation on disconnect, revocation, stale source, unknown receipt, or vault switch. Do not display a cached answer while current eligibility is unknown. Keyword search remains labeled as keyword search.

Native command DTOs are fixed for UI integration: `vault_intelligence_capability(expectedVaultId) -> { enabled: boolean, scope: "vault_intelligence", consent: "active" | "missing" | "unknown", explanation: string }`; `vault_ask(expectedVaultId, operationId, question) -> AskOutcome`; `vault_recover_ask(expectedVaultId, operationId) -> AskOutcome`. `AskOutcome` is `{ operation: { operation_id, state: "prepared" | "in_flight" | "unknown" | "complete" | "failed" | "expired", error_code: string | null }, answer: <canonical UI DTO above> | null }`. `answer` is nonnull only after a `complete` receipt and native revalidation, or for the local zero-evidence `insufficient_evidence` result. Capability requires the separately scoped grant and Ask consent to be confirmed, not merely a locally stored secret. A disabled or unknown capability explains the state without sending evidence. Prepare/claim/status/disconnect commands for the separate protected connection may remain in the settings disclosure, but must be testable and callable after future authorized activation.

## Durability, recovery and validation

Service receipt key is `(workspace_id, device_id, vault_id, operation_id)` with exact payload digest. Same key+digest returns the prior receipt without a second provider call; different digest is a conflict. Reserve the existing shared provider budget for purpose `answer` in a transaction that also records `in_flight`, then dispatch outside locks. Recheck grant and versioned consent before dispatch and again before returning content; settle measured usage or retain an uncertain reservation. Never infer that timeout means the provider did not run. Native intent binds the selected session, protected connection fingerprint, question, evidence digest, and operation ID; a switched vault, revoked grant, changed credential, changed source, or cancellation blocks promotion/display. Retry first performs GET recovery; only a scoped, authenticated 404 proving *no receipt exists* permits POST resend of the identical body after fresh native revalidation. `expired` is a terminal tombstone, never a resend signal; `unknown` and failed network GET are also not resend signals. The GET route authenticates the exact Ask scope before lookup and rechecks it before returning private content; POST authenticates before reading any body. No new operation ID is generated by a retry button.

Meaningful tests: photo-only grant denied on Ask before body read; intelligence grant denied on photo endpoint; wrong vault/workspace/revoked/changed consent denied; no provider call for zero evidence or budget denial; duplicate op digest and conflict; timeout/unknown receipt recovery without double billing; malformed/oversized packets; invented citation and unsupported/uncertain source response; <=8 all eligible selection on a vague query; >8 deterministic ranking and visible limited record coverage; <=8 with a long note reports excerpt truncation despite full record coverage; query-near excerpt includes late relevant text at valid UTF-8 boundaries and remains an exact source substring; human correction suppresses stale machine semantics; direct edit/rename/remove/hash damage between selection and response produces `stale_evidence` without leaked answer; vault switch and revoked connection; UI citation opens the correct original and error states retain the question. Use synthetic data only. Validate backend format/lint/typecheck/pytest and migration/RLS behavior; native fmt/test/check on a real filesystem; client typecheck/unit/build and local browser journey. Freeze source and explanatory docs once, rerun affected and repository gates on that exact candidate, then independent Sol review. Live provider, installed Windows/iPhone, held-out relevance/entailment, deployment, merge, and any real vault migration remain open until separately proved.

## Next direction

After this bounded Ask result, assess held-out retrieval failures and context coverage. Then implement text organization through the same new capability with a distinct purpose, strict text-source quote validation, and a journaled proposal revision that cannot override a human correction. Voice/files and phone transport follow the same source and authority boundaries in later packets. A green INTELLIGENCE-01 candidate alone does not complete the Finish Contract.
