# Selected-photo Claude reading — bounded implementation evidence

October 8, 2026. Implements the authorized [design](../../superpowers/specs/2026-10-08-claude-vault-reading-design.md) and [plan](../../superpowers/plans/2026-10-08-claude-vault-reading.md) over preserved local foundation/lifecycle work. New local records remain vault-authoritative; legacy cloud data remains database-authoritative and unmigrated. Claude full-page vision is the primary photo-reading path. This slice does not complete RCL-005B, semantic Ask, phone transport or installed-device acceptance.

## Implemented behavior

- Capture saves exact original PNG/JPEG/WebP bytes before processing. Optional annotation remains human prose. Opening/listing/searching a memory, importing a photo and reloading never dispatch a reading automatically.
- **Read this photo with Claude** applies to a selected eligible memory and opens a confirmation naming the photo and explaining the private-service/Claude boundary, potential mistakes and cancellation/cost limits. **Keep it local** sends nothing. The actual send gesture supplies only selected-session/memory/revision/operation IDs to native code.
- Missing/invalid protected connection is disconnected by default. Capture, local keyword search, original inspection, annotation and saved-reading correction remain usable without remote accounts or email-link sign-in. No renderer origin/credential field, enrollment or connection setter exists.
- Completed reading appears beside the physical original, before optional annotation/metadata. The glass reading board shows **Unreviewed machine reading**, uncertainty, provider/model and expandable hash/derivative provenance. Model strings render literally, including crafted Markdown/HTML. Image decode success is required before claiming the original is readable; late source replies/errors cannot replace a newer revision.
- **Correct reading** creates a separate human transcription correction. Its text, including intentional emptiness, governs effective local keyword search and survives rereading. Machine proposals, uncertainty and human corrections remain distinct in History; annotation and original bytes remain separate.
- Pending, unknown and cancelled operations disclose possible send/processing/charge. **Retry or recover reading** keeps the same operation and explains that a missing service receipt can cause the same photo to be resent. Admitted in-flight/unknown provider work is not submitted again. A retained complete receipt can commit locally while disconnected. Failed/expired/cancelled work never automatically creates another operation.
- Navigation/vault selection initiates native cancellation for unfinished work and invalidates renderer responses. Native cancellation cannot undo an already committed reading or a provider charge. Cancelled/failed folder selection retains correction drafts; source/capability/history/reading replies from departed contexts cannot expose old text. Native durable status determines what actually happened on reopen.
- Submitted corrections freeze text, operation and revision. A stale correction retains its draft, reloads authoritative current state, and requires explicit review before a new save. Missing, deleted, conflicted and revision-zero current states disable correction. Unsaved drafts survive returning between reading and correction within the focused memory; drafts are not persisted across a complete application restart or switching to a different vault.
- Storage labels say **Stored on this device** rather than implying the photo never left the device. Completed state uses a concise processed-photo disclosure; the full cancellation/possible-charge explanation stays on pending/unknown/cancelled work.

## Native/server boundaries

The [HTTP contract](../../API-CONTRACT.md) authenticates an injected scoped device principal before reading photo bytes, derives operational workspace membership server-side, reuses the existing derivative/provider/extraction validation and consent/budget ledger, and stores bounded operational receipts without canonical cloud captures. Authorization defaults to deny. A missing or uncertain provider usage result retains a budget hold; no automatic refund is promised.

The server retains normalized result content for 24 hours from admission; startup/access/60-second cleanup expires it. Original images, derivatives and raw provider responses are never durably written by this service. Minimal binding/status/digest/budget tombstones remain indefinitely for deduplication. Backups/WAL have separate retention; expiry is not secure erasure.

Native code alone reads the existing scoped connection from the separate OS-protected keyring service, enforces fixed HTTPS/no redirects/bounds, and obtains selected source bytes itself. Journaled v3 history fences older writers while retaining exact v1/v2 history/manifests. Human corrections survive reprocessing. Direct Obsidian editing remains supported for the annotation region; changes to generated reading/correction/provenance regions remain conflicts. A vault does not contain authority to connect to a private service.

Same-ID recovery GET may lead to one identical POST after 404, only after fresh session/cancellation/source/revision and connection-fingerprint checks. Existing in-flight/unknown/failed/expired/complete receipts never redispatch provider work. General vault recovery does not automatically promote pending machine results. Native rollback of cancelled uncommitted generated publication preserves originals/history and respects true concurrent human edits as conflicts; already committed history is not rolled back.

## Evidence by layer

The following table records the earlier Task 3 delivery evidence. Fresh cross-layer verification for the consolidated final repair is recorded below.

| Layer | Evidence | Acceptance boundary |
| --- | --- | --- |
| Backend, independently reviewed `6e81987` | Separately run full pytest: 267 passed, no skips; Ruff/mypy passed. Actual synthetic protected HTTP/SQL and SDK stream fixtures cover authorization-before-body, binding/validation, duplicate/in-flight recovery, Unicode output, expiry and known/unknown charge accounting. | No paid/live Claude call or production enablement. Not rerun for this renderer-only task. |
| Native, independently reviewed `7249249` | Separately run full Rust: 152 passed; check/fmt and 118 pre-UI desktop tests passed. Real temporary vault files and loopback TCP cover exact source bytes, v3 fence/history, correction precedence, crash/cancellation rollback, GET404→same POST, stale/changed source/session/connection and Unicode equivalence. | No installed Windows/keyring/TLS/live-provider acceptance. Not rerun for this renderer-only task. |
| Renderer | Initial delivery had 18 reading regressions; review repair expands this to 25, plus existing adapter/local/lifecycle tests. Initial full root suite and scoped repair checks are recorded below. | Injected native methods test real rendered UI, not native disk or OS scheduling. |
| Browser | Real Chromium against default entry, synthetic test-only native IPC, both desktop and reduced-motion. Six new journeys cover consent, comparison/correction/search/history/reload, pending cancel, uncertain recovery, vault-switch staleness and stale-correction/narrow layout; existing local journeys remain covered. | Fixture operation/history/browser storage model native DTOs; browser reload does not establish filesystem crash durability. |
| Accessibility and hierarchy | Axe A/AA/2.1 AA scans at disconnected/consent/comparison/correction/history/pending/recovery/narrow states; 390px overflow assertion; 1440×1000 first-viewport assertions for reading text and complete original image. | Not exhaustive screen-reader or installed WebView certification. |

Synthetic source cards visibly say “SYNTHETIC TEST CARD” and contain “Seedlings 12?” to match the simulated reading/uncertainty. They contain no private/customer information. The fixture is test-only; no product fake mode or provider client was added. The explicit reading journey blocks external HTTP. Vite starts fresh on `127.0.0.1:1422` with cloud settings explicitly empty.

## Regression and validation record

Work begins at reviewed native head `7249249509dc91e55a6ea85747b00c7458288d19` on `implement/claude-vault-reading`.

- Initial component RED: 11 reading tests failed because controls/behavior were missing; after implementation the affected reading/local/adapter run passed 91 tests. Additional regressions exposed and fixed reset unsaved drafts, disconnected durable-receipt recovery, misleading pending “This device only” storage wording, and older-revision source errors overwriting a new human correction. The dedicated reading suite now has 18 cases.
- Initial browser test with the unextended synthetic fixture: two explicit-consent checks failed due missing native reading handlers. This is harness RED, not a claimed product regression. After fixture extension the full local suite passed 28 checks.
- Opening actual comparison screenshots exposed the core reading/original below the first viewport. New first-viewport assertions failed in both browser projects, then passed after moving comparison ahead of annotation/metadata and collapsing duplicate completed status/charge warnings. All eight final screenshot files were opened and visually inspected.
- Initial typecheck caught new-test-only unsupported `exact` query options/untyped delayed promises, then fixture-only TypeScript narrowing across an async cancellation. These were corrected; no runtime contract workaround was introduced.

Final fresh checks from repository root, Linux, after the source-revision guard repair:

- `npm test`: **253 passed**, all 22 files; API 26, tokens 4, sync 30, desktop 136, mobile 9, web 48. No failures/skips.
- `RECALL_CHROMIUM=/usr/bin/chromium npm run test:local-vault`: **28 passed**, zero skipped, desktop and reduced-motion; existing 16 plus new 12 checks. Includes the first-viewport regression and source-byte/hash comparison in the preserved journey.
- `RECALL_CHROMIUM=/usr/bin/chromium RECALL_SCREENSHOTS=1 npm run test:local-vault -- reading.spec.ts`: **12 passed**, both projects, generating only the new reading evidence. All eight images were opened and visually inspected. Subsequent source-revision guarding changed no screenshot layout; the final full browser run above also passed.
- `npm run lint`: passed. Executed after Playwright cleanup to avoid the earlier lifecycle evidence's artifact-cleanup race.
- `npm run typecheck`: passed across workspaces and browser TypeScript projects.
- `npm run build --workspace @recall/desktop`: passed, 100 modules, with separate lazy legacy-cloud chunk.
- `git diff --check`: passed; changed-document relative Markdown targets resolved. Historical foundation/lifecycle screenshot directories have no diff.

Native/backend code and web UI were unchanged in Task 3; their separately recorded native/backend results above and the root web unit suite remain applicable. No fresh backend/native or separate web Playwright run is claimed. Independent UI/whole-branch review and exact-head draft PR/CI/installer delivery are coordinator follow-ups; the previous foundation/lifecycle installer is not evidence for this slice.

## Independent review repair over delivery head `0a18121`

The independent UI review reproduced two Important gaps. A genuine revision-zero native diagnostic has no reading and blank source/note metadata; the earlier spread-based fixture incorrectly retained a reading, masking the disappearance of the correction editor. The editor/draft/reload route now remains visible independently of reading availability. A diagnostic draft is read-only/copyable, current reading/evidence is unavailable, and saving stays disabled until authoritative healthy reload and explicit review. No old original is displayed as current evidence. The synthetic component/browser fixtures now return that actual diagnostic shape and verify recovery after simulated repair.

The original-photo source load previously shared the transport epoch, so a read/recover/cancel gesture discarded its response without starting another request. Source validity now binds view/session/memory/revision/hash/state separately from transport invalidation. Success and errors remain usable through an unsuccessful reread/recovery/cancellation, while older-revision and departed-view/session replies remain fenced.

Fresh scoped verification:

- Added/updated authentic diagnostic and source success/error regressions: **8 failed / 17 passed** before repair; `npm test --workspace @recall/desktop -- src/local/photo-reading.test.tsx src/local/local-app.test.tsx src/platform/local-vault.test.ts`: **105 passed**, including 25 reading cases, no skips.
- Independent reviewer probes, explicitly selecting `review.test.tsx` with `-t REVIEW`: **2 passed**, 18 unrelated baseline cases filtered. The original generic Vitest harness command also discovered a later-added Playwright keyboard spec and errored at suite discovery; selecting the correct Vitest file resolved that harness issue.
- `RECALL_CHROMIUM=/usr/bin/chromium npm run test:local-vault -- reading.spec.ts`: **16 passed**, desktop/reduced-motion, no skips. Includes copyable draft/reload/repair with the real diagnostic shape and a delayed original after an unknown reread, plus all prior reading journeys and Axe/viewport checks.
- Root `npm run typecheck`, `npm run lint`, and `git diff --check`: passed. No new screenshots or unchanged broad backend/native/client/browser suites were rerun for this scoped repair; the earlier full-delivery evidence remains historical.

At this earlier repair, the Minor keyboard-focus return finding remained open for final review; the consolidated repair below now addresses it. This earlier repair addressed the two Important cases. No native/backend/contract/provisioning behavior changed. Scoped independent rereview passed both original failure probes and four focused browser checks.

## Consolidated whole-branch review repair over `ef73706`

Whole-branch review found that a completed backend receipt could be permanently rejected by native: the shared validator retains non-verbatim uncertainty proposals and unused evidence when the summary is null, while native required every quote to match the transcription. The selected-photo contract now preserves the uncertainty proposal and its original wording/source references. Native permits a non-verbatim quote only within uncertainty, never as supporting evidence for facts or summaries. Source, digest, reference, shape, length and nonblank checks remain enforced. The selected service clears evidence attached to a null summary with a review note and rejects blank uncertainty evidence before completion. The original transcription and uncertainty are retained in complete results; attribution remains unreviewed. The legacy-cloud validator/schema are unchanged.

The selected service also enforces native's 128-character local-ID/mention-reference limit before normalization or completion, including items that would otherwise be dropped. Oversized IDs and unusable blank uncertainty return an intentional terminal `failed` / `INVALID_EXTRACTION` receipt with known provider usage settled. POST replay and GET recovery return that same consumable receipt without another call. This is not an automatic refund or a claim that all native event-size limits disappeared.

Twelve [shared synthetic cases](../../../packages/contracts/fixtures/local-reading-selected-contract.json) contain exact receipts generated through the protected HTTP route and real PostgreSQL/JSONB using a synthetic JPEG and fake provider. The backend regression reproduces every complete/failed response, POST replay, GET recovery, exactly one provider call, one completed reservation and one usage row (1,000 input / 500 output tokens). Cases include non-verbatim uncertainty, null-summary evidence, ordinary/Unicode blank quotes, the 128/129-character ID boundary across mentions/statements/actions and references, unsupported fact/summary quotes, wrong source references and wrong digest. Native consumes those exact responses and separately rejects tampered factual/summary quotes, blank uncertainty, source/digest/reference mismatches and oversized IDs. No live SDK/provider accuracy is inferred from this fixture.

Consent dismissal now returns keyboard focus to **Read this photo with Claude**. The actual Chromium regression exercises Enter → consent heading → Tab to Send → Tab to Keep it local → Enter → focused trigger, verifies zero reading dispatches, and reopens consent with Enter. Correction-panel focus behavior is outside this small repair.

Fresh checks after the consolidated implementation:

- `PATH=/workspace/recall-tools/pg/usr/lib/postgresql/17/bin:$PATH LD_LIBRARY_PATH=/workspace/recall-tools/pg/usr/lib/x86_64-linux-gnu services/backend/.venv/bin/pytest services/backend/tests/test_local_reading.py -q`: **68 passed**, no skips.
- Same environment, `services/backend/.venv/bin/pytest services/backend/tests -q`: **279 passed**, no skips. Ruff over backend source/tests and mypy over all 46 backend source files passed.
- With the documented native environment, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: **154 passed**, zero failures/ignored; `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check` passed.
- `npm test`: **260 passed**, all 22 files (desktop 143), no skips.
- `RECALL_CHROMIUM=/usr/bin/chromium npm run test:local-vault -- reading.spec.ts`: **18 passed**, desktop/reduced-motion, no skips. No screenshots were regenerated; all historical images remain preserved.
- Root `npm run lint`, `npm run typecheck`, `npm run build --workspace @recall/desktop`, and `git diff --check`: passed. This local build does not establish installed-device or exact-final-head CI acceptance.

M1 is explicitly deferred: cancelled/terminal native session registrations can exhaust the bounded 128-entry registry; the existing clear fail-closed error and restart workaround remain. This repair makes no registry retirement or session-safety redesign. Independent scoped final rereview at `44370217a713a415e30966ab0187eeeacb0e64e9` passed spec and quality: I1/M2/M3 were addressed, with 15 backend, three native and three browser checks independently passing. [Draft PR #13](https://github.com/nrsandoval1231-oss/recall/pull/13) is the delivery record for exact-head CI and installer artifact status; earlier-head CI is not final acceptance. Default authorization/connection remains disabled; no credentials, grants, enrollment, live/private calls, production changes, merge or deployment occurred.

## Synthetic screenshots

- [Default disconnected reading with usable local controls](synthetic-disconnected.png)
- [Explicit selected-photo consent](synthetic-consent.png)
- [Pending processing and cancellation](synthetic-processing.png)
- [Unreviewed reading beside its original](synthetic-unreviewed-comparison.png)
- [Human correction with retained machine proposal](synthetic-corrected-comparison.png)
- [Attributed reading/correction history](synthetic-reading-history.png)
- [Unknown-operation recovery disclosure](synthetic-reading-recovery.png)
- [Narrow comparison](synthetic-narrow-comparison.png)

Eight PNGs total approximately 2.9 MiB. Historical PR11 foundation and PR12 lifecycle screenshot bytes remain preserved in their separate evidence directories; only the new reading screenshots represent this UI.

## Remaining gates

Default production authorization/connection remains disabled. Owner-approved device/service provisioning and its credential protocol require separate review; QR remains proposed. No credentials, device grants, real captures, paid calls, private uploads, production auth changes, migration, merge or deployment occurred. Windows/iPhone, real keyring/HTTPS/provider behavior, live handwriting/material-number quality, broader durability/platform acceptance and complete semantic/vault-spine reconstruction remain open. An actual concurrent edit or damaged authority remains a visible conflict requiring deliberate recovery.
