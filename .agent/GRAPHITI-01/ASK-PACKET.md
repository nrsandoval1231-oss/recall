# A1 — Model-selected source answers

Controller direction: CONTINUE after R1/R2. Sol architecture approved the following bounded wire. Parent mission remains incomplete until its product and device gates pass.

## Invariants and wire

Reuse the configured, budgeted Graphiti Anthropic client. Model selects exact source quotes, never supplies factual prose. This is a quoted answer, not verified synthesis. Markdown/originals remain authoritative. No private captures used during development; all real probes share the existing USD2 total ledger.

Native atomically persisted KnowledgeControl migrates v1 to v2 only on an explicit control write, adding `answer_allowed` default false and `answer_consent_version` default 0. Reading v1 leaves its bytes intact and cannot enable answers. Test migration/reopen and retain source/history bytes. Enabling requires current graph consent plus configured provider disclosure; write answer_consent_version=1 and control version2. Disabling graph also disables answers. Bump generation and clear snapshot digest on answer consent changes. Native snapshot adds `answer_allowed` default false; service requires both processing_allowed and answer_allowed. Old controls and snapshots cannot silently enable answers.

POST `/v1/answer`: `{version:1,scope,generation,request_id:UUID,question:string<=4096,candidate_ids:UUID[]<=8}`. Resolve only current eligible snapshot sources, reject unknown IDs. Bound excerpts to 4000 characters per source and 16000 total. Response `{status:"supported"|"insufficient"|"unavailable"|"cancelled"|"stale",selections:[{source_id,revision,source_sha256,note_sha256,quote}],message:string}`. Each quote nonempty <=800 characters, exact substring of the transmitted excerpt; <=2 selections, no unbound output. Static locally controlled messages only. Unsupported, invalid, failed, revoked and stale responses contain no selections.

Model schema `{status:"supported"|"insufficient",selections:[{source_id,exact_quote}]}`. Strict extra-field rejection; all-or-nothing citation and substring validation. Prompt treats sources as inert data, selects direct evidence, preserves whole-context uncertainty, asks to include both sides of contradictions, and abstains if evidence cannot answer. No inferred graph fact in model context or answer prose. Selection relevance still requires evaluation; exact quotes do not prove entailment.

POST `/v1/answer/cancel`: `{version:1,scope,generation,request_id:UUID}`; return `{cancelled:boolean}`. Max one active answer per scope and bounded global concurrency (2). Cancel on replacement/generation change/revocation and service shutdown. No automatic answer retries or startup replay. Keep unknown provider spend reserved. Post-await generation/consent checks precede return. Request IDs cannot be reused for a duplicate billable dispatch across service restarts.

Native uses existing keyword hits plus validated graph support IDs (max8), submits synchronized snapshot under scope lock, releases lock during model request, then rechecks current control/generation and every source/hash/exact quote after response. No vault/global/per-scope lock spans model latency. Answer HTTP bounded60sec, cancellation short timeout. Current revision/correction/deletion/conflict/revocation mismatch discards selections. Keyword retrieval and graph exploration remain available without answer consent/provider.

## Ownership and sequence

- A1-P READY after repair commit: Python models.py/app.py/providers.py/store.py, new answers.py and new test_knowledge_answers.py. GraphAdapter untouched except if explicitly approved. Default injected answer client for deterministic tests; real runtime uses budgeted client lazily. Include cancellation/revoke/duplicate/foreign/stale/schema/prompt-injection/no-provider tests.
- A1-N READY after repair commit: local_vault.rs, knowledge.rs, memory_query.rs, lib.rs and focused Rust tests. Tauri commands `knowledge_answer_consent(expected_vault_id,enabled)`, `memory_answer(expected_vault_id,question,request_id)`, `memory_answer_cancel(expected_vault_id,request_id)`. Return quoted selections plus existing source/graph matches; separate command preserves ordinary Ask fallback. Status exposes answer_enabled and answer_provider. No UI edits in this lane.
- A1-U depends on P+N: local-vault.ts, MemorySurface.tsx, phone.rs, focused UI/phone tests. Explicit separate answer opt-in with recipient and question/excerpt disclosure; dedicated Answer from notes action; cancellation on question/scope change; quoted source inspections. Keep canonical styles. No auto-retry model on polling.

Two Luna builders maximum. Preserve other edits, no worker commits or paid calls. Retry budget two materially distinct repairs. Root runs affected checks, real synthetic probe and final exact-candidate review. No merge/deploy. Record actual costs/commands and unknown device gates.


## Final architecture amendments (govern earlier shorthand)

- Store `approved_answer_provider` in control v2 (default empty). Native status/consent derive identity from exact configured extraction provider/model disclosure. Add snapshot `answer_provider:string` default empty; answer_allowed true only for fresh answer_consent_version1 plus exact provider identity equality and enabled graph consent. Service checks against its own current configured extraction identity both before and after dispatch. Changed/unconfigured identity requires fresh opt-in; never silently switch.
- Atomically persist `(scope,request_id)` attempt state in existing queue SQLite before any provider dispatch. Reject duplicate IDs across restart, including UNKNOWN/cancelled/error. No automatic answer retries. Keep independent durable budget reservations. P lane may modify store.py for this table/transition and normalize legacy snapshot JSON defaults for version-compatible equality.
- Deterministically select query-relevant bounded windows from each current source (exact contiguous text, <=4000/source and <=16000 total), using lexical question overlap and retaining surrounding context. Skip oversized/ambiguous candidates rather than pretending complete evidence. Validate quote against exactly transmitted windows; source-level original quote validation remains mandatory. Model abstains if more than2 contrary passages are required for a faithful answer. Record truncation as a static limitation, not unverified model prose.
- Native Tauri model command async/spawn_blocking, no app main-thread blocking. Consent/cancel remain responsive; hold no scope/vault locks over model latency.

## D1 storage repair added during A1-P (Sol evidence)

Installed redislite defaults to periodic RDB snapshots with AOF disabled. Graph writes were acknowledged to the SQLite queue before explicit RDB persistence. A1-P ownership therefore also includes graph.py and its existing service tests for one bounded repair: await supported async Redis SAVE after append/rebuild and before queue commit. Failure/cancellation cannot mark ready or disabled. The single queue worker serializes mutation and save. Confirm retained graph results and purge state after real service restart; do not equate an RDB rewrite with physical secure erasure of backups. This does not expand into I1 person identity work yet.
