# CONTEXT-01 bounded packet draft — current related memory

**WAITING on independent ORGANIZE-01 acceptance.** Work Graph node R6C, first slice only. Repo `C:/Users/nrsan/Nucleus/02_Projects/Recall`, branch `implement/owner-device-pairing`, planning base `fa6390be3e9539b68040379e7e81a3a7bc90491d`; establish the new exact candidate/base after ORGANIZE-01's final review. Preserve its dirty accepted source and all vault data. This draft is architecture and dispatch preparation, not active consent, code acceptance or another Tribunal. The [proposal](CONTEXT-01-PROPOSAL.md) explains why historical Ask remains a separate HISTORY-01 packet.

## Objective and authority

A new text/photo capture still commits its immutable source and initial note first. When the owner has **newly opted in** to sharing bounded prior-vault context, the existing organizer's **same single provider call** may propose up to three `related_context` links to current vault memories. These are unreviewed context suggestions with source evidence on both sides, never identity merges or verified relationships. The output becomes a v7 journaled Obsidian note with clickable target-note links and safe lifecycle suppression. Existing v6 source-local organization, Ask, selected-photo manual flow, and historical files keep their accepted behavior. No extra per-capture approval or separate routine provider call.

The present `organize-v1|<ai_policy_version>|<ai_model_id>` consent covers only the submitted source. Sending another memory's excerpt is a material change. Change the **same organize purpose** policy to `organize-v2|<ai_policy_version>|<ai_model_id>` and disclose: up to three current excerpts from this selected vault may accompany each new capture to the configured provider for related-memory suggestions. Existing v1 rows become `outdated` through the current policy comparison; there is **no automatic upgrade**. One explicit owner opt-in (existing POST consent with expected epoch) creates a fresh local future-capture marker. New captures before that marker remain saved locally, not backfilled. Old queued v1 intents never re-enroll under v2; existing published v6 notes remain readable. The accepted server grant, workspace/device/vault consent key, reservation, receipt tombstone, same-operation recovery and local readiness rules remain. No DB migration is needed for this contract: receipt `binding`/`result` are JSONB and policy is versioned text. Feature defaults remain disabled; this packet issues no real grant/consent and makes no live request.

## Wire v2: one header, raw source body, same route

`POST /v1/local-intelligence/organizations` and receipt GET retain the v1 paths, HTTP states and authentication-before-body rule. V1 records/receipts remain version-dispatched and byte compatible; a v1 operation cannot be retried as v2. V2's `X-Recall-Organization` value is ASCII `v2.` followed by **unpadded base64url of strict compact UTF-8 JSON** for the binding below (maximum **3,072 ASCII bytes including the prefix**). V1 keeps its existing raw-JSON header. The media type and HTTP body remain the exact current human UTF-8 text or verified original photo bytes, with the existing limits. This encoding carries Unicode excerpts without relying on non-ASCII HTTP header behavior; the backend decodes strictly, rejects duplicate/unknown keys, noninteger numbers, invalid Unicode and oversized values before reading the source body. Its canonical idempotency SHA-256 remains the existing recursive sorted-key UTF-8 JSON over `{binding, media_type, input_sha256}`; context and coverage are part of `binding`, so changing either under the same operation conflicts. The backend also rechecks exact grant, v2 policy/epoch, input MIME/hash, budget and receipt scope as in v1. **Transport decision:** keep the existing raw-source endpoint and a small header, not a new multipart/envelope parser. The checked-in inference profile listens on loopback behind an externally managed HTTPS proxy whose header cap is not defined in this repo; a 3,072-byte custom header leaves room for the bearer and ordinary headers relative to the existing 4,096-byte v1 binding cap, but deployment acceptance must still prove the exact authorized proxy path with the largest legal v2 header. Do not infer production compatibility from local API tests or change the proxy under this packet.

Synthetic example (fixture representation; `body_utf8` is the raw HTTP body, not a binding field):

```json
{
  "binding": {
    "schema_version": "2.0",
    "operation_id": "00000000-0000-4000-8000-000000000011",
    "vault_id": "00000000-0000-4000-8000-000000000002",
    "memory_id": "00000000-0000-4000-8000-000000000003",
    "source_kind": "text",
    "source_sha256": "ed88c77745c20b52c3742f5b13e6a8d6f04147971ed5aa92d6b23326cc414e56",
    "expected_revision": 1,
    "input_sha256": "ed88c77745c20b52c3742f5b13e6a8d6f04147971ed5aa92d6b23326cc414e56",
    "consent_epoch": 2,
    "captured_at": "2026-10-09T12:00:00Z",
    "context_coverage": {"eligible_count": 1, "selected_count": 1, "limited": false, "truncated_count": 0},
    "context": [{
      "memory_id": "00000000-0000-4000-8000-000000000004",
      "memory_revision": 2,
      "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "evidence_kind": "human_note",
      "epistemic_state": "reported",
      "excerpt": "Project Lantern scope includes backup power."
    }]
  },
  "media_type": "text/plain; charset=utf-8",
  "body_utf8": "Project Lantern meeting: evaluate grid resilience.",
  "payload_sha256": "827a95900e453c12ae41988e4bf679559f38741a1fa5b30ee205f5924bf06eff"
}
```

`context` is an ordered array of at most **three** distinct **other** current memories. Each excerpt is a nonempty exact UTF-8 substring of eligible effective text, at most **256 bytes**; the whole decoded binding is at most **2,300 UTF-8 bytes** before base64url encoding, which keeps its unpadded base64url header within 3,072 bytes including `v2.`. IDs are canonical UUIDs, revisions positive safe integers, hashes lowercase SHA-256. Evidence kind/status use the accepted Ask vocabulary, but must represent the selected *effective* human note/correction or unsuppressed unreviewed reading/organization. Native under its current selected-session and vault lock uses source verification, journal recovery and reconciliation before selecting. If at most three records are eligible, include all. Otherwise rank deterministically by current supported terms/recency/ID, set `limited=true`, and disclose counts; a truncated excerpt increments `truncated_count` even when record coverage is complete. If three maximum excerpts would exceed the total binding cap, shorten them on UTF-8 boundaries and count truncation, then fail closed if even IDs/metadata do not fit; never silently omit an eligible selected candidate while reporting full coverage. No all-terms gate, automatic identity match, path, credential, attachment bytes or full-vault export enters `context`. Capture's prepared intent remains source-first; before its **first** network dispatch the runner fills and durably binds this exact context packet under the vault lock. After that, restart/recovery never changes selected entries or operation identity.

For v2 the provider receives source plus bounded context in a versioned prompt/schema. Text output is `{ "extraction": <the current semantic-only fields>, "related_context": [...] }`; native/backend attach the exact input transcription as ORGANIZE-01 already does. Photo output is `{ "extraction": <current v1.1 extraction>, "related_context": [...] }`; the derivative, photo checks and source-local extraction validator remain. `related_context` has 0–3 distinct entries, each exactly `{ "target_memory_id", "source_quote", "target_quote" }`. The target ID must be supplied in `context`, `source_quote` a nonblank exact substring of the validated source transcription, and `target_quote` a nonblank exact substring of that target's transmitted excerpt. Quotes and IDs cannot be invented or normalized; no model-supplied path, status, identity ID, category or permissions field is accepted. The only rendered relationship label is fixed by native: **Possibly related (unreviewed)**. A bad link fails the v2 result rather than publishing unsupported context. Source-local extraction remains independently validated and preserves uncertainty; if the provider supplies no defensible link, `related_context=[]` is valid. This validation proves reference integrity, not semantic entailment or real-world identity.

V2 complete receipt remains the current wrapper and adds `related_context` only inside `result`. The example omits the existing photo-only `derivative` because it is text:

```json
{
  "schema_version": "1.0",
  "binding": {
    "schema_version": "2.0",
    "operation_id": "00000000-0000-4000-8000-000000000011",
    "vault_id": "00000000-0000-4000-8000-000000000002",
    "memory_id": "00000000-0000-4000-8000-000000000003",
    "source_kind": "text",
    "source_sha256": "ed88c77745c20b52c3742f5b13e6a8d6f04147971ed5aa92d6b23326cc414e56",
    "expected_revision": 1,
    "input_sha256": "ed88c77745c20b52c3742f5b13e6a8d6f04147971ed5aa92d6b23326cc414e56",
    "consent_epoch": 2,
    "captured_at": "2026-10-09T12:00:00Z",
    "context_coverage": {"eligible_count": 1, "selected_count": 1, "limited": false, "truncated_count": 0},
    "context": [{
      "memory_id": "00000000-0000-4000-8000-000000000004",
      "memory_revision": 2,
      "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "evidence_kind": "human_note",
      "epistemic_state": "reported",
      "excerpt": "Project Lantern scope includes backup power."
    }]
  },
  "payload_sha256": "827a95900e453c12ae41988e4bf679559f38741a1fa5b30ee205f5924bf06eff",
  "state": "complete",
  "result": {
    "provider": "anthropic", "model_id": "configured-model",
    "input_manifest_sha256": "827a95900e453c12ae41988e4bf679559f38741a1fa5b30ee205f5924bf06eff",
    "extraction": {
      "schema_version": "1.1", "capture_id": "00000000-0000-4000-8000-000000000003",
      "input_manifest_sha256": "827a95900e453c12ae41988e4bf679559f38741a1fa5b30ee205f5924bf06eff",
      "summary": "A Project Lantern meeting considered grid resilience.",
      "summary_evidence": [{"page_id":"00000000-0000-4000-8000-000000000003","quote":"Project Lantern meeting: evaluate grid resilience."}],
      "pages": [{"page_id":"00000000-0000-4000-8000-000000000003","ordinal":1,"transcription":"Project Lantern meeting: evaluate grid resilience.","legibility":"clear"}],
      "mentions": [], "statements": [], "action_suggestions": [], "uncertainties": []
    },
    "related_context": [{
      "target_memory_id":"00000000-0000-4000-8000-000000000004",
      "source_quote":"Project Lantern",
      "target_quote":"Project Lantern"
    }],
    "validation_notes": [], "review_state": "unreviewed"
  },
  "error_code": null
}
```

The backend-owned shared fixture must contain this actual binding, exact canonical bytes/hash and a Unicode example. V2 `in_flight/unknown/failed/expired` wrappers keep the v1 receipt state rules and no private `result`. Receipt/result bounds and budget estimate include all transmitted context bytes and prompt/schema overhead; do not retain raw provider output or unrelated originals. Source and every selected context revision/hash/excerpt must still be current before promoting any v2 result, even if the provider returned zero links, because it saw that context.

## V7 durable projection and link lifecycle

Keep the existing optional `VaultMemory.organization` field. For **v7 organization events only**, it may carry `binding.schema_version=2.0` with `context_coverage` and `context`, and `result.related_context` as above. No new top-level graph/entity table or arbitrary link map. `kind=organization`, `format=recall-local-vault-v7`, and a new writer fence/version-specific payload hash cover the complete v2 proposal. V1–v6 stored event JSON, history, manifest and Markdown replay must remain byte-identical. A v7 renderer adds a short `Related memory` block with fixed unreviewed wording, exact two-sided quote context and a Markdown link to the **current target note path resolved by native**, never a model path. UI navigation uses stable target ID and rechecks current target/original. The target path is derived at publication, not stored as authority; the stored binding keeps target stable ID/revision/hash and excerpt.

For a supported native **target rename**, find incoming current v7 links and journal their suppression before changing the target path; if a dependent note has an Obsidian conflict or journal error, abort that rename with a clear repair state instead of knowingly publishing a broken link. A crash after suppression but before rename loses a suggestion safely. **Human correction and removal must not be blocked by a machine link:** commit the human/tombstone event, make all links to the changed target immediately ineligible by current-target revision/state validation in search/UI/promotion, then journal managed-link suppression. If that rewrite is interrupted or conflicts, report a pending link repair and never show the stale link as current; preserve the human action and its history. Direct Obsidian target edits/renames are detected on reconciliation and use the same fail-closed eligibility and repair path. Source human edit/correction also suppresses its own v7 machine proposal. Promotion rejects changed selected vault/session, grant/fingerprint, marker/epoch, source, any selected target, receipt or conflict. An interrupted provider result can only recover the same operation and bound context; no automatic new paid request.

## Ownership, sequence and acceptance

1. **Backend contract first** (one bounded builder): `services/backend/src/recall/ingestion/{local_organization.py,provider.py,anthropic_provider.py,prompts.py}`, `services/backend/src/recall/api/local_organization.py`, `services/backend/src/recall/config.py`, focused `services/backend/tests/test_local_organization.py`, and backend-owned `packages/contracts/fixtures/local-context-synthetic.json`. Change `api/inference.py` only if route registration actually requires it; do not touch migration/legacy cloud/Ask. Freeze v1/v2 schema, payload digest, context-aware budget and receipt examples. Focused backend auth, strict wire, provider output, scope/epoch and unknown-effect tests.
2. **Native after wire freeze** (one builder): `apps/desktop/src-tauri/src/{local_organization.rs,local_vault.rs,local_vault_tests.rs,lib.rs}`, focused native tests and read-only consumption of backend fixture. `reading_storage.rs` only for existing source/reference validation reuse. Extend selected-session guarded operation, candidate selection, v7 journal/renderer/lifecycle and exact revalidation. No independent source fetch chosen by UI and no second routine provider call. Prove v1–v6 fixture bytes, direct-edit conflict, source/target correction, rename/remove, crash and retry invariants.
3. **UI after native DTO** (one builder): `apps/desktop/src/platform/{local-vault.ts,local-vault.test.ts}`, `apps/desktop/src/local/{Organization.tsx,LocalVaultApp.tsx,local-app.test.tsx,local.css}` and focused `tests/local-vault/{fixture.ts,journey.spec.ts}`. Extend the existing disclosure once per v2 policy, show related link/evidence and coverage limits, and preserve immediate source-save/unknown/offline status. Use invocation session token for commands and stable identity for response checks. No user filing or per-note approval.
4. Controller integrates serially, updates only necessary canonical examples/status after source freeze, runs affected and required final gates against one exact candidate, and obtains independent Sol review. Default two materially different repair attempts; retain failures and `UNKNOWN` external effects. Handoffs record changed files, exact SHA, commands/exit codes, UTC times, measured/UNKNOWN usage and skipped live/platform gates.

Acceptance: synthetic two-source case yields one cautious v7 link and opens the current note/original; same-name ambiguous case never asserts identity; empty/limited/truncated context is disclosed; a target/source change or revoked/outdated consent never publishes stale context; unsupported/error/oversize still saves local source; v1–v6 bytes and selected-photo/Ask remain unchanged. A maximum legal header with bearer passes the local API transport test, and a one-byte-over-limit v2 header rejects before the source body is read; the unknown external HTTPS proxy cap remains an explicit later deployment gate. No live grant, provider call, paid processing, deployment, push, merge, signing, real-data migration or completion claim is authorized. Historical/as-of Ask, vague retrieval quality, voice/files, phone and installed/live acceptance remain open under the Finish Contract.
