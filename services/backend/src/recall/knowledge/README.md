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

The HTTP contract is versioned under `/v1`; requests require the bearer and a
loopback Host/client with no browser Origin. Snapshot and search requests carry
a monotonically increasing generation. Deletions, edits, revocations, and
explicit rebuilds replace the scoped graph; append-only snapshots ingest only
new episodes. Any stale generation is fenced both before and after graph search.

For development, run focused tests from `services/backend` with
`uv run --extra graphiti pytest tests/test_knowledge_service.py`. These tests
use fake graph adapters and do not constitute a real provider/FalkorDB runtime
smoke. Runtime verification should use synthetic notes and an isolated durable
database outside the repository. Never use private vault text for setup or
provider verification.
