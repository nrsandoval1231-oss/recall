# Previously authorized processing recovery — 2026-10-13

Continuation of #54/#55/#56. No PR was merged. This implements the interrupted-processing recovery gap discovered while exercising the native phone journey.

A saved memory can now **Resume previously authorized processing** after desktop restart. The native endpoint reloads existing source-specific authorization, validates library identity, original hash, original revision and absence of human corrections, then reuses the same deterministic Jev, Claude and publication operation IDs. It cannot grant new consent. Unknown provider delivery still stops at the existing native uncertainty gate; resuming does not authorize another billable attempt. Corrected, changed or unconsented sources require desktop review. Existing source bytes are unchanged.

Phone workers are capped at four per process, duplicate in-flight work is suppressed, and slots release on completion/error. Durable engine receipts remain the authority for deduplication across restart. There is no automatic sweep or unbounded retry loop. Pending requests use the same receipt/inspection page; a missing provider remains honestly pending, not organized.

The real browser restart workflow exposed an inspection race with the worker's short file lock. Saved-memory inspection now retries only that exact contention error, at most four 25 ms waits per read. It does not retry provider calls or mutation requests. A longer failure offers refresh without falsely saying that an already running provider was never called.

## Verification

- Endpoint regression failed first (405 instead of the required refusal for absent consent).
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: **268 passed**. New cases cover existing consent/library scope, corrected-source refusal, restored authorization, uncertain provider replay (one fake transport call across two runs), worker bounds/deduplication/released capacity, and a real brief native writer lock during inspection.
- `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin recall-phone --bin recall-desktop`: passed, Linux.
- `npm run check`: lint, typechecks and **273 workspace tests** passed.
- `npm run build -w @recall/desktop`: passed.
- `RECALL_CHROMIUM=/usr/bin/chromium npm run test:phone`: **9 passed**. Compiled native companion, actual browser storage/HTTP/filesystem, synthetic data. The new case captures with consent, stops/restarts the companion, resumes from the saved page with provider credentials explicitly empty, checks honest pending state, one unchanged original and one capture history entry. Prior offline/retrieval cases remain green. Final review added regressions for short names/units/numbers in Ask and removing stale inspection links after switching libraries with no pending captures. Both failed first, were repaired, and pass in the final suites.
- Initial verification retained two failures: a stale status-wording assertion, and a real browser/native lock-contention race. Both were repaired and the full native/browser suites rerun.

This advances criterion 5 and strengthens 11/13 in the [journey ledger](../native-evidence-retrieval/README.md). It does not establish live Jev/Claude or handwriting quality. No real providers were called; fake transport assertions are explicitly distinguished from live evidence. Physical iPhone/Tailscale, installed Windows, broad semantic retrieval and generative answer quality remain open. No independent reviewer acceptance is claimed. Previous exact-commit evidence remains unchanged in the earlier slice reports.
