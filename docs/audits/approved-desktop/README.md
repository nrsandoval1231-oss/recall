# Approved desktop implementation evidence — 2026-10-13

## Authority and acceptance status

[Approved specification](../../APPROVED-DESKTOP-2026-10-12.md), extracted alone from PR #48, and the owner-supplied chat image govern this implementation. Main baseline: `8f90e5a`. PR #26 was not incorporated. The exact original PNG bytes are not accessible in this workspace; `docs/assets/recall-desktop-approved-2026-10-12.png` remains missing. The older canonical PNG is not the comparison authority.

**Visual implementation is not accepted as complete.** Browser evidence below is available. Exact-reference asset commit, full native CI and installed Windows acceptance are separate gates.

## Screenshots

| Viewport | Empty vault | Populated source fixture |
| --- | --- | --- |
| 1536 × 1024 | [Empty](empty-1536.jpg) | [Source fixture](source-fixture-1536.jpg) |
| 1182 × 789 | [Empty](empty-1182.jpg) | [Source fixture](source-fixture-1182.jpg) |
| 900 × 700 | [Empty](empty-900.jpg) | [Source fixture](source-fixture-900.jpg) |

Also: [Selected project](selected-project-1182.jpg), [original beside interpretation](native-fixture-evidence.jpg), [source-backed retrieval](native-fixture-search.jpg), and [browser results](browser-smoke.json). The six-card corpus is explicitly synthetic and exists only in the browser test's IPC bridge. Production loads actual selected-vault data, never these records. No private captures or vault exports are committed.

Compared visually with the chat image: charcoal rail, illuminated navigation, ivory workspace, editorial headings, 3 × 2 project grid at wider sizes, compact memory list, separate calendar/follow-ups and capture actions follow the approved composition. Repeated screenshots exposed excessive card/list height, clipped navigation labels at 900px and the old combined calendar agenda; those were corrected. At 900px cards reflow to two columns and the workspace scrolls. Empty vaults display explanatory space rather than invented cards. Atmospheric photographs are intentionally replaced by quiet tonal gradients. Gold outlines appear on actual selection. Dates/greetings use current context and no hardcoded person's name.

Remaining visual differences requiring owner/installed-app assessment: exact font and shadow tuning against original PNG bytes; native window chrome; Windows font rasterization. Browser screenshots cannot prove these match the installed application.

## Verification

- `npm run check`: lint, repository typecheck, all 262 JavaScript workspace tests passed. A transient web focus test (`restores expanded supporting context on Back`) failed in an earlier run and passed on the full web rerun; final full check is the authority.
- `npm run test -w @recall/desktop`: 104 tests passed, including original preservation, missing-note restoration access, explicit conflict/reload states, correction payloads, revision history, stale retrieval/organization responses, source filtering, Escape context, source retry without draft loss, text drop and prevention of reused photo consent.
- `npm run build -w @recall/desktop`: TypeScript and Vite production build passed.
- `RECALL_UI_URL=http://127.0.0.1:4174/ npm run test:visual -w @recall/desktop` (Vite preview): Production-bundle Chromium screenshots at required sizes plus 390 × 844; no browser errors or horizontal overflow; the source-backed Home Axe scan reports no violations. Tests cover source-backed retrieval, original integrity display, corrections, older Recent entries, selected project, Escape return, Ctrl K, reduced motion, text drop, month navigation, selected-day empty feedback and unchecked provider consent. IPC is emulated, not native persistence or live models.
- `rustc --test apps/desktop/src-tauri/src/photo_drop.rs -o /tmp/recall-photo-drop-tests && /tmp/recall-photo-drop-tests`: 2 authorization/retry tests passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: blocked by missing Linux `glib-2.0` development package. No full native test success is claimed locally. Existing Linux/Windows CI checks must validate the exact PR head.

Recording and arbitrary document capture remain visibly disabled. Plain-text drop/paste opens an editable draft without saving or spending. Native photo drops select one supported image for explicit import; only actual OS drop events authorize paths. The existing native picker, receipt lookup, validated image writer, vault session checks and provider consent remain in place. Restarting before an unsuccessful import may require dropping the original again to renew OS authorization; already durable operations recover from receipts.

## Independent review

A separate reviewer found and verified repairs to: capped Recent/Corrections lists; hidden selected-day empty feedback; lost underlying workspace on inspection; insufficient populated visual fixtures; arbitrary renderer-path import authorization; receipt lookup ordering; and misleading replacement during a pending drop retry. The final review also confirmed that unavailable calendar source buttons are disabled with an explanation. No unresolved blocking issue remains from independent code review. Native integration and installed Windows use remain unverified.

## Installed Windows acceptance still required

Commit/hash/dimension-check the original approved PNG. Install the exact-head unsigned Windows build, select a consented vault and verify photo picker/drop (including denied arbitrary paths and durable retry), capture/organization/publication, original access, corrections/history, Ask, month navigation, keyboard focus, reduced motion and empty vault. Capture all three requested window sizes and compare directly with the exact PNG. Do not mark the PR ready to merge until these gates and exact-head CI pass.
