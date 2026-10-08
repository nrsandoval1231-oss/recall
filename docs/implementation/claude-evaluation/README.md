# Synthetic Claude selected-photo evaluation

This harness exercises Recall's selected-reading HTTP service against five fixed,
full-page synthetic images. The pages are font-rendered pipeline smoke fixtures;
they do not establish human-handwriting accuracy or V1 acceptance. The cases cover
visible numbers and question marks, names and amounts, dense text, a blank page,
and deliberately unreadable marks. Ground truth is retained in the manifest and
result journal and is never included in provider context.

## Safety boundary

The run uses only files in `tests/evaluation/claude-selected-photo/`, a synthetic
device authorizer, an existing throwaway PostgreSQL test environment, and model
`claude-sonnet-5-5`. It does not use production identity, vaults, photos, or data.
The service creates its ordinary selected-reading receipt and accounting rows in
that disposable test database. Results remain `unreviewed` and are not written to
an Obsidian vault.

The installed adapter is constructed with `max_retries=0` and
`refusal_fallback=False`. Each case reserves 24,784 input tokens and 64,000 output
tokens in a durable journal before dispatch. At the verified rates of $2/M input
and $10/M output, five reservations total $3.44784, below the fixed $5 batch cap.
The journal has one fixed identity under the ignored repository-local
`.recall-storage/claude-selected-photo-eval/batch.json`, an exclusive OS file
lock, atomic replacement, and fsync. It is single-use: an in-flight request after
a crash becomes `unknown`, keeps its full hold, and cannot be retried or replaced
by another batch. The exact request binding, fixture hash, and operation ID are
flushed before each reserve and dispatch. Actual provider usage is recorded
separately only when the selected operation creates one correctly modeled usage
row within its token holds. Provider usage estimates are not billing invoices.

## Offline checks

From the repository root:

```powershell
uv run --project services/backend pytest services/backend/tests/test_claude_batch.py -q
```

These tests verify the fixture allowlist and hashes, maximum reserve arithmetic,
exclusive journal access, one-batch lifetime, unknown holds, SDK retry/fallback
and output limits, selected-reading service behavior on throwaway PostgreSQL,
usage accounting, and deterministic transcription/number/uncertainty/blank
metrics. They make no provider network request.

Selected-reading rejection receipts intentionally keep the public
`INVALID_EXTRACTION` error. The backend emits a separate structured log
classification such as `INVALID_JSON`, `SCHEMA_INVALID`, `PAGE_SET_INVALID`,
`UNKNOWN_MENTION_REFERENCE`, `BLANK_UNCERTAINTY_EVIDENCE`, or
`OUTPUT_TOO_LARGE`. When several structural faults occur together, the
classification uses a fixed priority: envelope, page set, duplicate local ID,
unknown mention reference, then unknown evidence page. These codes contain no source text, identifiers, exception
messages, or schema values. The synthetic regression test confirms a schema
rejection can be classified without logging the rejected value. The two
historical live failures remain unattributed because the immutable journal did
not retain their raw outputs or validator reasons; offline reproductions are
new cases and do not identify those causes.

For a separately authorized future run against the same fixed synthetic
allowlist, set `RECALL_EVAL_DIAGNOSTICS=1` in the test process to opt in to
test-harness capture. It verifies each fixture hash, writes bounded raw output
and request bindings to immutable per-case files under the ignored
`.recall-storage/claude-selected-photo-eval/diagnostics/`, then replays the
current deterministic validator and writes a separate immutable findings file.
The helper refuses unlisted fixtures, changed fixture hashes, oversized output,
and replacement of existing files. This flag does not reset or change the
single-use batch journal; the existing used journal still prevents another
dispatch. Raw captures are synthetic test artifacts only and must never be
enabled for production service traffic.

## Controller-owned live dispatch

The builder must not dispatch a paid request. A controller may run the single
gated test only after a compatible Anthropic key is available, the disposable
PostgreSQL test server is available, and the current official model availability
has been checked. The test accepts only a key beginning `sk-ant-`, performs the
read-only model lookup before any billable dispatch, and uses the one fixed
journal path. Never use an OpenAI key. Load `AI_API_KEY` into the process through
an approved ignored local environment file or secret mechanism; never put it in a
command line or repository file.

```powershell
$env:RECALL_EVAL_LIVE = '1'
uv run --project services/backend pytest services/backend/tests/test_claude_batch.py::test_live_synthetic_selected_reading_batch -q
Remove-Item Env:RECALL_EVAL_LIVE
```

The test fails closed when the key is absent or incompatible. Never rerun after
the fixed journal exists, including after a timeout or interruption. Preserve the
journal as evaluation evidence and review the provider receipt and usage before
interpreting quality. The output is a bounded synthetic pipeline result only;
it does not prove true handwriting, mobile/native integration, live production
readiness, or cross-device acceptance.

## DIAG-02: approved two-case diagnostic batch

The controller-only entrypoint `test_live_diag02_synthetic_reading_batch` is
separate from the original five-case run and requires
`RECALL_DIAG02_LIVE=1`. It dispatches exactly `numbers_uncertainty` followed by
`dense_full_page`, after checking their fixed manifest hashes. Diagnostics are
forced on and saved under the ignored
`.recall-storage/claude-selected-photo-eval/diag-02-diagnostics/` directory.
The new single-use journal is fixed at
`.recall-storage/claude-selected-photo-eval/diag-02-batch.json`; it never opens
or resets the original `batch.json` journal.

Each case reserves 24,784 input and 64,000 output tokens ($0.689568 at the
verified Sonnet 5.5 rates), for a maximum two-case reservation of $1.379136
under the $1.50 cap. There is no retry or refusal fallback. A request with an
unknown result or missing/out-of-hold usage retains its full reservation and
stops the batch before another case is sent. The controller must preserve the
journal and diagnostic captures after dispatch. No third case is available in
this entrypoint.

Offline DIAG-02 guard tests do not read a key or contact the provider. For the
authorized run, set `RECALL_DIAG02_LIVE=1` in the approved controller process
and invoke:

```powershell
uv run --project services/backend pytest services/backend/tests/test_claude_batch.py::test_live_diag02_synthetic_reading_batch -q
```

This approval applies only to these synthetic fixtures and does not establish
handwriting accuracy or broader product acceptance.

The retained DIAG-02 outputs isolated a producer-side mismatch: the local
schema requires statement predicates to match `^[a-z][a-z0-9_]*$`, while the
provider's structured-output schema omits unsupported regex keywords. The
interpretation prompt now states this rule explicitly and gives snake_case
examples such as `call_timing` and `budget_limit`. Original wording remains in
the statement text/value and evidence quotes. Local schema validation remains
the hard boundary; predicate normalization and schema relaxation are not used.
This offline prompt repair has not been live-retested, and no additional paid
batch is authorized by this result.

The approved run completed exactly two calls on `c9d29c9`: both were rejected
with `SCHEMA_INVALID` for space-containing predicates. Known token usage estimates
were $0.026542 and $0.060188, totaling $0.086730 (not an invoice). Full holds
remained $1.379136. The original journal hash remained unchanged. Both raw
outputs reproduce their failures offline. A controller-only in-memory experiment
changing only predicate spaces to underscores passed validation for both with
transcriptions unchanged; transformed output is diagnostic evidence only.
The prompt change still requires fresh live evidence before claiming success.
