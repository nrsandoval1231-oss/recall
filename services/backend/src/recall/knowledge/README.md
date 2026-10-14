# Recall local Graphiti service

This optional local service powers the desktop knowledge graph. It runs in WSL
because the persistent Graphiti/FalkorDB runtime is supported there. It binds
only to `127.0.0.1`; never expose its port to a LAN or public interface. The
vault remains authoritative. Graph rows are rebuildable derived data.

Install the backend with its optional extra (`uv sync --extra graphiti`). Start
the service with `recall-knowledge` after setting these WSL environment values:

| Variable | Requirement |
| --- | --- |
| `RECALL_GRAPH_TOKEN` | Random bearer token, at least 32 bytes. Share it with the native local service through the owner-controlled secret channel. |
| `RECALL_GRAPH_DB_PATH` | Absolute persistent file path outside this repository, e.g. `~/.local/share/recall-graphiti/graph.db`. SQLite queue and provider-budget ledgers are stored beside it. |
| `RECALL_GRAPH_LLM_PROVIDER` | Explicitly `anthropic`; there is no implicit provider fallback. |
| `RECALL_GRAPH_ANTHROPIC_API_KEY` | Anthropic key delivered through the local secret channel; never put it in source, shell history, or logs. |
| `RECALL_GRAPH_ANTHROPIC_MODEL` | Explicit supported Anthropic model id. Sonnet 5.5 is sent with auto tool choice and low-effort between-tools thinking. |
| `RECALL_GRAPH_BUDGET_USD` | Explicit finite positive spend limit for this persistent ledger. It is not enabled by default. Reservations are made before calls; ambiguous failures remain reserved as unknown spend. |
| `RECALL_GRAPH_INPUT_USD_PER_MTOK`, `RECALL_GRAPH_OUTPUT_USD_PER_MTOK` | Explicit finite positive price values for the configured model. |
| `RECALL_GRAPH_EMBED_CACHE` | Optional persistent FastEmbed cache path. Defaults to `~/.cache/recall-graphiti-models`. |

The local embedder is pinned to `Qdrant/bge-small-en-v1.5-onnx-Q` revision
`aa8f8b060edb00e03bfdd08813a2949946c8ba55` and checks the 66,465,124-byte ONNX
file SHA-256 `51f1bd0addd6e859e42c2c8021a5e5461385bb676a649f4b269aa445449f2431`
before loading. Initial setup may download this public model, but it runs locally
and receives no note text over a network. The 384-dimensional model is part of
the graph index identity: changing its revision requires rebuilding derived
embeddings. The reranker is local reciprocal-rank fusion; no external reranking
provider is used.

Processing is disabled until an explicit snapshot authorizes it. Private note
text is sent to the explicitly configured extraction provider only when that
consent is active. Source text is kept in the local queue ledger only while
needed for processing/current authorized snapshot; graph episodes do not retain
raw note bodies. Provider SDK retries are disabled and graph concurrency is one.
No credentials, source text, or provider response content are written to logs.

Extraction and answer processing disclose provider identities through
`GET /v1/health`: the Anthropic model, the local FastEmbed model, and local
reciprocal-rank fusion. Graph processing consent is separate from answer
consent. A snapshot must set `answer_allowed: true` and copy the current exact
configured extraction identity into `answer_provider`; both flags must be
current for an answer to run. Answer consent defaults off and is invalidated
when the provider identity changes. Answer questions and the selected bounded
note excerpts are sent to that configured Anthropic model. Embeddings remain
local, and reranking uses no external provider.

`POST /v1/answer` accepts a scope, current generation, unique request UUID,
question (up to 4,096 characters), and up to eight current eligible source
UUIDs. It considers exact contiguous note windows, at most 4,000 characters
per source and 16,000 characters in total. Long notes without a bounded
question-word overlap, or with matching passages too far apart, are skipped;
the response uses a static limitation message when notes were partial or
skipped. The model may return at most two quotations, each at most 800
characters. Every quote must be an exact substring of both the excerpt sent
and its current source. Model prose, unsupported IDs, malformed schema, and
unmatched quotes are rejected. Responses use `supported`, `insufficient`,
`unavailable`, `cancelled`, or `stale` status and locally controlled messages.
Quoted text is source material, not a verified answer or proof of entailment;
retain context for negation, uncertainty, dates, and qualifications.

`POST /v1/answer/cancel` accepts the same scope, generation, and request UUID.
Cancellation is recorded durably even if it arrives before answer dispatch.
Answer request IDs cannot be reused for another billable attempt, including
after restart; unknown/interrupted calls are not replayed. Provider usage and
cost are reserved before dispatch. If a call's outcome is ambiguous, its full
reservation remains unknown spend rather than being refunded or retried. The
configured budget is an operator-set persistent ledger limit, not a default
spend authorization.

Graph mutations, including consent revocation purges, issue an awaited
FalkorDB `SAVE` before the queue reports the generation ready or disabled. A
failed save does not commit success. If the queue worker encounters a storage
failure or uncertain operation, health/search/snapshot report a sanitized
restart-required failure; the service does not blindly replay a possibly
partial operation. Shutdown still attempts to close the worker, provider
clients, and graph database; resource-close failures produce fixed sanitized
diagnostics.

Person identity is deliberately conservative. Person node IDs exposed to the
desktop are source-local, even when Graphiti reused one node for matching names
in several notes. Any Person relationship supported by multiple current notes
is suppressed before endpoint filtering. A same-name mention is not proof of
identity, and human cross-note identity approval is not implemented. Other
ontology node types retain their scoped Graphiti IDs. All relationships remain
inferred proposals.

This is a bounded local pilot: each graph append batch accepts at most 100
sources, and each source is limited to 32 KiB of UTF-8 text. A full rebuild
validates every eligible source before clearing the derived graph, then ingests
batches of at most 100. Oversized individual sources fail explicitly without
clearing the previous graph or silently truncating saved originals.

The HTTP contract is versioned under `/v1`; requests require the bearer and a
loopback Host/client with no browser Origin. Snapshot and search requests carry
a monotonically increasing generation. Deletions, edits, revocations, and
explicit rebuilds replace the scoped graph; append-only snapshots ingest only
new episodes. Any stale generation is fenced both before and after graph search.

For development, run focused tests from `services/backend` with
`uv run --extra graphiti pytest tests/test_knowledge_service.py
tests/test_knowledge_answers.py`. The deterministic service/answer tests use
injected fake clients and do not constitute a real provider/FalkorDB runtime
smoke. Runtime verification should use synthetic notes and an isolated durable
database outside the repository. Never use private vault text for setup or
provider verification.
