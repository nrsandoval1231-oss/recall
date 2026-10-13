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
