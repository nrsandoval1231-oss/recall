# Local vault lifecycle — bounded implementation evidence

October 8, 2026. Implements the authorized [lifecycle plan](../../superpowers/plans/2026-10-08-local-vault-lifecycle.md) over the accepted local foundation. New local desktop records are vault-authoritative; legacy cloud records remain database-authoritative and unmigrated. This slice does not complete RCL-005B, semantic memory reconstruction or installed-device acceptance.

## Implemented scope

- A unique stable-ID Markdown file can be renamed among direct `Recall/Memories/*.md` children. Search includes its validated basename; correction keeps that basename. Duplicate IDs, unsafe/occupied paths and changed headers remain conflicts. Nested discovery is unsupported; an unrelated nested directory can conservatively block an apparent missing-note decision.
- A missing note stays missing until explicit **Restore missing note** or **Remove from Recall**. Restore validates fresh absence and publishes a new revision without overwriting a returned file. Removal requires confirmation and appends a terminal logical tombstone. It retains original photos, Markdown, prior revisions and journals; it is not secure purge or in-app undelete.
- Removed records disappear from active search/evidence and remain inspectable through **Removed items** and independently validated history. Old capture/correction/restore/removal receipts return current authoritative state, including deletion; no stale operation reactivates a tombstone.
- **Rebuild local search** uses the same locked recovery/reconciliation/sorted projection boundary as list. It rebuilds human-annotation/source-filename/validated-basename keyword results without an index database. Failure retains previous rows and mode/query, visibly labeled unverified. This is not OCR, AI or semantic reconstruction.
- Failed lifecycle decisions retain operation ID, revision and state across focus navigation and cancelled/failed selection within the selected session. Retry keeps identical arguments; current-state reload permits explicit review of a new decision or closing the old one. Successful selection clears the previous session. Lifecycle decisions are not persisted across complete process restart; capture intent retains its separate existing persistence.

## Compatibility and recovery boundary

Unchanged v1 vault reads preserve exact manifest/history bytes. New v2 mutations install a durable writer-version fence before event publication and retain `_meta/manifest-v1.json`. History/parent hashes use original stored bytes, not reserialized extended records. Old foundation binaries must refuse v2; downgrade is unsupported. Only separate synthetic copies are suitable for compatibility experiments.

Recovery groups pending events by memory/revision and validates the current head/parent before publication. Forks remain retained diagnostics, not UUID-order winners. Missing historical completion markers may be repaired only from validated immutable history/journal/hash chains; repair never republishes historical Markdown. Terminal tombstones remain deleted even beside retained stale/forked operations. Fresh inventory at publication refuses stale restore/removal decisions when an editor returned, renamed or changed a bound file.

An interrupted restore after note publication but before history can remain a conflict: identical returned bytes cannot establish whether Recall or an editor wrote them. Some journals, duplicates, occupied paths and corrupt metadata require manual recovery. Preserve all evidence; no destructive recovery UI or automatic file cleanup is promised. Path validation is not an OS security boundary against another process authorized to replace ancestor directories.

## Evidence by layer

| Layer | Evidence and scope | Does not establish |
| --- | --- | --- |
| Native Linux | Reviewed `2672b2f97baf594066bfe2edcd195975a55ca515`: full Rust suite 113 passed; check/fmt passed. Real temporary files cover rename/correction/reopen, missing restore, retained tombstones, old receipts, forks, v1 raw-byte compatibility and v2 fence interruptions. Test-only fault seam includes a 112-case operation/directory/boundary matrix. | Installed native dialogs/renderer, actual power loss, actual full/read-only volume, or Windows filesystem durability |
| Native fault injection | Synthetic ENOSPC/EROFS, create/write/flush/hard-link/rename/publication/cleanup failures, partial metadata and editor races at real-file boundaries | Measured disk exhaustion or read-only hardware; production exposes no fault-mode toggle |
| Renderer contracts/components | Reviewed product head `f4332324d10d81ea06a202c815c02ad8d6cc0fd8`; final delivery adds a focused obsolete-notice regression. Typed commands require ephemeral `expectedVaultId`; `note_path` remains display-only. | Live Tauri IPC/platform scheduling |
| Browser integration | Separate `tests/local-vault` suite drives the real default entry with test-only injected native commands. Fixture keeps per-memory history and operation receipts, clones IPC values, applies eligible/deleted filtering, and supplies explicit synthetic error/delay responses. | Native disk changes, crash recovery or actual OS picker behavior |
| Browser accessibility | Axe A/AA/2.1 AA scans include missing focus, confirmation, removed list/history and failed rebuild alongside prior home/evidence/conflict/preview checks. Both desktop and reduced-motion projects run. | Exhaustive screen-reader/keyboard certification or installed WebView accessibility |

Browser state in `synthetic.test.native` models returned native DTOs/receipts only. Renamed/missing conditions are injected by changing that synthetic state; they do not exercise physical files. The suite starts a fresh Vite server on `127.0.0.1:1422`, explicitly empties cloud settings and preserves the original no-external-HTTP/no-sign-in journey. Source PNGs visibly say “SYNTHETIC TEST CARD.” Browser reload tests do not replace the native reopen tests. No production fake mode or new runtime dependency was introduced.

## Delivery verification

Run from repository root, Linux, Chromium `/usr/bin/chromium`, over the reviewed product head above plus this delivery change:

- `RECALL_CHROMIUM=/usr/bin/chromium RECALL_SCREENSHOTS=1 npm run test:local-vault`: **16 passed, zero skipped**, covering the original six and ten lifecycle checks across desktop/reduced-motion. Lifecycle scenarios cover renamed-basename lookup; missing-note restore/history/reload; confirmation cancellation; removed history; stale capture receipt after tombstone; fixed removal retry after cancelled selection/focus exit; failed rebuild retaining query/rows; successful rebuild retaining removed mode; late removal reply after vault switch.
- `RECALL_CHROMIUM=/usr/bin/chromium npm run test:ui`: 42 existing web checks passed, zero skipped. Web code/config/scenarios remain unchanged.
- `npm run lint` and `npm run typecheck`: passed after the notice fix.
- `npm test`: **230 passed**, all 21 files, no failures/skips (API 26, tokens 4, sync 30, desktop 113, mobile 9, web 48).
- `npm run build -w @recall/desktop`: passed, 99 modules, separate lazy legacy-cloud chunk.
- `git diff --check`: passed. All 80 relative Markdown link targets in changed documentation resolved.
- Unchanged native code was not rerun for this delivery task. The separately reviewed 113-test native result above remains the applicable evidence.

Regression-first record: five lifecycle scenarios initially failed against the prior schema-only fixture, exposing missing handlers/search semantics. Those are test-harness failures, not claimed product RED. After fixture implementation all 16 browser checks passed. Screenshot inspection then found an actual product defect: a successful removal left an old capture “Saved in vault” notice on home/Removed items. A component regression and rendered assertion both failed before the narrow fix. Authoritative memory publication now clears superseded home notices; capture sets its new current-state receipt after publication, preserving honest current-deleted retry wording. No filesystem or native behavior changed. The targeted component run moved from one failure (71 filtered skips) to one pass; the targeted browser assertion moved from one failure to the full 16-check passing suite. One lint attempt raced Playwright cleanup of `test-results` and stopped with ENOENT; the sequential fresh lint run passed without changing lint configuration.

## Synthetic screenshots

All are browser command-boundary fixtures, visually inspected for readable labels, state and controls. Historical PR11 foundation screenshots remain unchanged in the separate [foundation evidence](../local-vault/README.md).

- [Missing note with explicit restore](synthetic-missing.png)
- [Removal confirmation and retention explanation](synthetic-confirmation.png)
- [Removed items](synthetic-removed.png)
- [Retained capture/removal history](synthetic-removed-history.png)
- [Failed rebuild preserving visibly unverified results](synthetic-failed-rebuild.png)

## Installer and acceptance ledger

| Slice | Exact head / CI / installer | Acceptance boundary |
| --- | --- | --- |
| Preserved PR11 foundation | `650e9eae6878b46673d81411789d02e9388077a0`; successful [run 37708945255](https://github.com/nrsandoval1231-oss/recall/actions/runs/37708945255); unsigned [artifact 11521925107](https://github.com/nrsandoval1231-oss/recall/actions/runs/37708945255/artifacts/11521925107); delivered ZIP `file_0000000099f081f599ed9c8fa1be3aa9` | Previous foundation build and delivery; not lifecycle or installed-device acceptance. CI artifacts have seven-day retention, so keep the delivered ZIP reference. |
| Lifecycle slice | Separate stacked draft PR, exact-head full CI and new artifact reference pending coordinator verification | Do not substitute the older installer for this slice. No merge, release or deployment. |

The authorized Windows desktop is offline. No other connected desktop was used; no installed acceptance is claimed. The previous installer and instructions were already delivered; this report makes no duplicate installation request. The [future synthetic-only Windows checklist](../../ACCEPTANCE.md#future-installed-windows-lifecycle-checklist--blocked) is documentation only, includes v1→v2 compatibility/older-writer refusal and preserves both artifact references.

Nested moves, secure purge/undelete, source-reimport resolution, full semantic reconstruction, phone transport, QR/enrollment/relay, live AI, real-data migration and deployment remain outside this slice. QR remains unanswered. Real Windows/iPhone, actual power-loss/volume-exhaustion and broader durability acceptance remain open. The earlier Linux graphical smoke failure at WebKit's compiled `/usr` helper path was not repeated; Chromium evidence is not native UI acceptance.
