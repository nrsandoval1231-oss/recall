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
