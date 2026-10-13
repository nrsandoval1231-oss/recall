# Graphiti acceptance ledger

Status: IN PROGRESS, not production-ready.
Base main: 8f90e5a5ead9dd05b58beaecb6811b2b197088e2. Branch integrate/graphiti.

| Gate | Current evidence |
|---|---|
| Preserve current desktop baseline | npm run test --workspace @recall/desktop: 97 passed / 12 files before implementation |
| Real persistent supported storage | Graphiti0.30.2/FalkorDB real ingestion and retrieval survive service restart in WSL |
| Configured model accessible | Anthropic models API returned claude-sonnet-5-5; no generation implied |
| Graphiti extraction / hybrid retrieval | PASS for authorized synthetic notes with Claude Sonnet5.5 + local384d embeddings; no retained private-corpus acceptance |
| Duplicate/revision/restart/rebuild | Duplicate HTTP submissions and persisted retrieval PASS; revision/interruption controls covered by deterministic tests; graph-loss rebuild control implemented |
| Privacy/deletion/revocation | Real empty foreign scope, unmapped source rejection, deletion rebuild and scope revocation PASS; cancellation covered by deterministic API test |
| Native capture/Ask/Related/correction | Native capture-to-Graphiti source-backed search PASS; graphical app and physical phone verification pending |
| Canonical UI and visualization | OPEN |
| Installed Windows / physical phone | OPEN |
| Independent exact-candidate review | OPEN |
| PR / CI | OPEN |

Owner authorized up to USD2 total provider verification with synthetic notes only. No private captures authorized. Official model documentation checked: input USD2/MTok, output USD10/MTok; forced tool use and non-default temperature unsupported. https://platform.claude.com/docs/en/models/sonnet-5-5/overview

Failure evidence: Win32 embedded falkordblite unsupported; Docker daemon unavailable; WSL recovery proved storage initialization. Kuzu rejected because upstream deprecated/unmaintained. Existing npm install audit reports 22 advisories (15 high/7 moderate), retained baseline release limitation, no blind dependency overrides.

## Controller verification checkpoint
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: exit 0; 238 passed, 1 opt-in live-service test ignored; 31.06s test runtime. Native candidate adf253c9b107a1f785b4d2818a11a8ff253ea750. Pre-existing dead-code warnings retained.
- Real Anthropic structured extraction: PASS with fictional Alice/Project Aurora. 491 input +100 output tokens, USD0.001982 settled. This proves only the configured Sonnet model's structured extraction path, not full Graphiti integration.
- Real local FastEmbed inference: PASS, 384 dimensions; pinned ONNX hash documented in INSPECTION.
- First Graphiti ingestion attempt: FAIL before model use, Pydantic required concrete EmbedderClient and CrossEncoderClient. Repaired runtime subclasses; RRF avoids reranker.
- Second attempt: FAIL before model use, Graphiti add_episode(uuid=...) loads an existing episode rather than assigning a new ID. Fix under validation. No successful graph-ingestion claim yet.
- Budget ledger is retained outside Git at ~/.local/share/recall-graphiti-verification/graph.db.budget.sqlite in WSL. Never reset between probes; USD2 total authorization applies across all probes.
- Controller `npm run check`: exit0; repository lint/typecheck and 262 tests passed (API26, tokens4, sync64, desktop104, mobile9, web55). `npm run build --workspace @recall/desktop`: exit0.
- Real persisted graph inspected after successful ingestion: 1 episode, 3 typed entities and 2 relationships. Initial EMPTY was a correct provenance rejection: Graphiti's attribute pass does not receive original source text. Deterministic episode-to-native-source binding replaced model-generated quote fields.
- Search-only new-process probe returned both persisted relationships, exact current source context and local hybrid retrieval, with no additional paid calls. Blank exploration also returned persisted edges. Empty-scope query raised upstream GroupsEdgesNotFoundError; bounded adapter repair pending. Total actual provider spend USD0.079864; no unknown calls.

## Integrated runtime checkpoint (2026-10-13 UTC)

- `live-graph-probe.py` with `RECALL_PROBE_MODE=search-only`: exit0, two persisted hybrid results, two exploration edges, foreign scope0 and unknown-source0. Empty-scope handling repaired. No additional provider cost.
- `live-lifecycle-probe.py`: exit0, duplicate snapshot identities stable, incremental second note invalidated the prior exclusive employer at 2026-02-01, deletion rebuilt without the deleted source in any support, revocation returned disabled with zero relationships. This used actual Graphiti/model/storage, not FakeGraph.
- Native first opt-in test failed after120s because text-capture metadata uses an empty-original sentinel; a second failed due an empty text source name. Both preserved originals, made no extraction calls, and are retained as failure evidence. Repair uses verified immutable text SHA and native `{id}.txt` source name, with a real capture regression.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib knowledge::tests::synthetic_loopback_end_to_end_consent_rebuild_and_search -- --ignored --exact --nocapture`: exit0,1passed,9.65s on synthetic vault `vault-20261013-c`. Original source retained; two source-backed inferred relationships.
- Service stopped cleanly and restarted. HTTP search of that native scope returned `ready`, two relationships with the same native source ID. No capture or reingestion required.
- Full WSL backend first run:228passed,2failed due Windows esbuild selected under Linux. Recovery used existing matching Linux0.28.2 binary without modifying node_modules. `ESBUILD_BINARY_PATH=/home/nrsan/.local/recall-node-tools/node_modules/@esbuild/linux-x64/bin/esbuild /home/nrsan/.local/recall-backend/bin/python -m pytest -q` from services/backend: exit0,230passed,30.17s, real PostgreSQL18 exercised. No skips.
- Full backend `ruff check .`, `ruff format --check .`, `mypy src`: exit0;91formatted files,54typed source files.
- Provider ledger after temporal/deletion/revocation test: USD0.185592 actual,32settled calls,0reserved. Later native test spend will be recorded at freeze.

Open product gates: physical phone/installed distribution, private retained-corpus quality, arbitrary-provider compatibility, historical-revision graph retrieval, large-vault scalability, and independent exact-candidate acceptance. Keyword/source retrieval plus inferred facts is not a generative answer engine. Do not represent this candidate as the full production-ready mission while these gates remain open.

## Frozen implementation checks
- Final `npm run check`: exit0,265tests passed (desktop107); lint and all workspace typechecks passed.
- Final `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: exit0,243passed,2opt-in ignored. Both opt-in native tests were separately exercised successfully against the retained synthetic vault (live ingestion9.65s; source reopen0.05s).
- `npx tauri build --debug --no-bundle --config ../../.agent/GRAPHITI-01/tauri-verification.json` from apps/desktop: exit0; actual Windows executable built using isolated application identifier. This does not prove installed distribution acceptance.
- Synthetic full-vault backup:9files including original/history/consent control copied to a separate directory; every SHA256 matched.
- Actual local `recall-phone` binary on127.0.0.1:8789: POST Ask returned HTTP200, fictional Alice facts, inferred graph cards and exact original source links. Chrome UI verified the same result; actual screenshot `screenshots/real-phone-ask.jpg`. This is desktop-browser companion evidence, not a physical iPhone test.
- Automatic approval review rejected the shell-based verification desktop launch with only `blocked by policy`; action stopped. Desktop runtime screenshots remain open. The in-app browser also timed out before tab creation; the independently running companion was inspected in Chrome.
- Provider total after native ingestion:USD0.217044,37settled calls, effectively zero reserved (floating-point residual1.39e-17), no unknown calls. Synthetic records only. Search/restart used local embeddings and incurred no new model calls.
- Current origin/main rechecked:8f90e5a5ead9dd05b58beaecb6811b2b197088e2 unchanged. Original dirty owner checkout untouched.
- Lane: full, Luna bounded builders + Sol contract review + Terra targeted runtime diagnosis. Model tokens/config load identity/aggregate planning and build durations UNKNOWN. Measured command runtimes are recorded above; no speedup or elapsed-to-accepted claim. Independent candidate review pending.

## Independent review and repair

Sol reviewed candidate 9fab143a92c662e6eaac5bb9ad8d9a22cf6de4bb: **FIX**. Findings: oversized source enumeration could block disabling consent; native consent command discarded remote purge failure; model-created endpoint names lacked a deterministic source anchor. Controller direction CORRECT; bounded R1/R2 ownership is recorded in REPAIR-01.md. This candidate is not independently accepted.

Supplemental root verification on that frozen candidate: `npm run test:ui` exit0,42passed,27.5s. These browser tests do not replace the blocked native desktop runtime inspection or physical phone verification.

Next approved product node A1 is a model-selected, exact-quote Ask answer with separate answer-purpose consent, budgeted provider calls, cancellation and native source revalidation. See ASK-PACKET.md. This is implementation scope, not completed capability.

R1/R2 controller affected verification: cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib knowledge::tests -- --nocapture exit0 (8passed,2opt-inignored); desktop memory-surface.test.tsx exit0 (34passed); uv run pytest tests/test_knowledge_service.py -q exit0 (18passed). Repair candidate requires independent re-review after A1 integration; no acceptance implied. R1 regression forces source enumeration failure in a disposable synthetic vault, confirms local disable, unavailable transport fence, then empty reconnect purge payload with pending state.

A1 build observed active at 2026-10-13T05:34:22.5095179Z UTC; exact dispatch and full-mission start times UNKNOWN. Pre-A1 read-only provider ledger audit:37settledcalls,83372inputtokens,5030outputtokens,USD0.217044 actual,69.299s aggregate measured provider-call latency; no UNKNOWN calls. This is provider usage, not agent-model token usage. Shared USD2 cap remains unchanged.

Observed old-service shutdown failure during A1 restart: queue task raised SQLite OperationalError (unable to open database file), and old lifespan skipped graph close. Root cause of transient path access is UNKNOWN; graph/queue/budget files remained present with ample disk. Root checked both SQLite databases integrity_check=ok, then attached the retained graph and saved/closed through GraphAdapter without provider calls. Follow-up repair must report worker failure and always release resources; do not label this a clean restart.

## A1 integrated verification (2026-10-13 UTC)
- Root npm run check: exit0,269tests (API26,tokens4,sync64,desktop111,mobile9,web55), lint/typechecks PASS.
- Root full WSL backend with the documented Linux esbuild override: exit0,246passed,33.06s, no skips. First focused call using graph-only environment failed collection because PyJWT was absent; full backend environment resolves it.
- Root cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib: exit0,251passed,3opt-inignored,32.43s, before final phone hash repair.
- Root npm run test:ui: exit0,42passed,26.9s. Root Ruff check PASS. Windows mypy lacked optional Graphiti dependencies; supported WSL full-backend python -m mypy src: exit0,55sourcefiles. Root diff check PASS (line-ending warnings only).
- Real native quoted-answer opt-in test: exit0,1passed,5.48s; supported source quote and unsupported-question abstention, original bytes unchanged.
- Real synthetic six-note/14-question evaluation:13passed,1failed. Comparison question failed strict model schema/quote validation and returned unavailable with no quotations; exact failure category not retained. Failure retained outside Git; no replay of spent UUID. This is NOT14/14quality acceptance.
- Read-only graph inspection AFTER service stopped cleanly:6persistedepisodes,13entities,6edges. Zero exposed relationships resulted from source-anchor gates rejecting synthesized Decision/Commitment/Meeting labels. Native capture scope retained1episode,3entities,2edges. No model calls during stopped-storage inspection.
- Actual phone browser found stale-validation defect for typed notes: metadata empty-hash sentinel differs from canonical processing snapshot hash. Phone repair uses processing snapshot and adds capture regression; runtime recheck pending.
- Provider cumulative audit before last phone call:USD0.542418,91settledcalls,201564inputtokens,13929outputtokens,196.754s aggregate provider latency, no unknown calls. USD2ledger unchanged.
- Latest service shutdown after SIGINT exited0; graph closed/saved without previous SQLite task exception. Original transient SQLite path failure root cause UNKNOWN; deterministic worker-failure/cleanup regression covers safe failure reporting and resource closure.
- Sol direction for zero visible decision links: require verbatim contiguous entity names through supported Graphiti custom_extraction_instructions. Preserve all exact source gates. Rebuild bounded synthetic scope and verify usefulness; no acceptance by weakening guards.
- Source-span extraction recovery used the same six synthetic notes, generation2 and explicit rebuild. Returned3anchored relationships, including an accepted commitment and DECIDED edge with invalid_at=2026-05-08. Superseding decision edge was still filtered; extraction coverage remains a limitation. New comparison request returned exact quotations from both notes. Original13/14result remains retained, not overwritten as14/14.
- Real phone browser recheck after hash repair: supported answer, exact fictional Alice quotation, revision/hash and inspect-source link. Actual screenshot screenshots/real-phone-quoted-answer.jpg. Physical phone still untested.
- Cumulative provider audit:USD0.771702,127settledcalls,287776inputtokens,19615outputtokens,267.800s aggregate provider-call latency; no unknown calls. No private input and no budget reset.
- No model compatibility claim for Jev or unconfigured providers. Quote-only answer selection does not implement freeform evidence-grounded synthesis. Pilot source and visualization caps are explicit. Full mission remains OPEN.
