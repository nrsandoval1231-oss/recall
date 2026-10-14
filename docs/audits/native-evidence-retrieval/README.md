# Native evidence retrieval — 2026-10-13

Continues the native library/editor (#54) and phone recovery (#55, `18b1ca8`) without merging other open PRs. Canonical design and storage authority are unchanged.

## Behavior

Native desktop and phone Ask now rank eligible current notes using corpus term rarity and length-normalized lexical frequency (BM25). Generated Recall frontmatter does not contribute to ranking. Up to three direct matches are source-verified; up to two additional memories may be retrieved through explicit saved wikilinks. Linked context is labeled as such, with its originating note/revision and a review requirement. A repeated name alone creates no relationship. This is **keyword and saved-link retrieval**, not embeddings, a model-generated answer or a claim of semantic retrieval completion.

Quotes now show a relevant bounded passage rather than blindly taking the first 1,200 characters. Original quotes include exact UTF-8 byte offsets and SHA-256; current notes separately show revision, capture/revision timestamps and whether user corrections exist. These timestamps describe capture and editing, not inferred event dates. Corrections never rewrite originals. Relationships and search remain reconstructible from the portable library; no service, database or index migration.

All candidates must remain active and conflict-free. Each returned source is rechecked through the existing native snapshot/hash/revision guard. Changed or unverifiable candidates are withheld, not fabricated. Deleted linked targets are excluded. Empty/filler-only and unsupported questions abstain. Existing graph highlighting receives the same real returned memory IDs.

## Verification

- Three new native regression tests failed first on the previous retrieval (late excerpt, explicit-link retrieval and filler-only query). The added desktop display assertion also failed before implementation.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: **263 passed**, including Unicode quote offsets, correction survival after reopen, deleted links, unresolved-name separation and a long unbroken-prefix regression.
- `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin recall-phone` and `--bin recall-desktop`: passed on Linux.
- `npm run check`: lint, typechecks, **273 workspace tests** passed.
- `npm run build -w @recall/desktop`: passed.
- `RECALL_CHROMIUM=/usr/bin/chromium npm run test:phone`: **7 passed**, using the compiled native companion and real temporary library. New Ask walkthrough finds late evidence and separately displays the real linked note; existing offline recovery cases remain green. Synthetic content only.
- `npm run test:visual -w @recall/desktop`: four viewports, zero reported axe violations and zero browser errors. Exact approved PNG blob checked. `browser-verification.json` explicitly records synthetic desktop IPC/provider fixtures; this is not native/device acceptance.
- The native companion browser suite is now part of Linux native CI. Remote CI status must be checked separately; local passes do not assert a remote pass.

## Journey ledger

| Criterion | Implementation and evidence | Remaining verification / work |
|---|---|---|
| 1. Open without Obsidian | Existing #54 native implementation and real Linux evidence retained | Installed Windows acceptance |
| 2. Create/open library | Existing #54 non-destructive controls, native tests retained | Installed Windows acceptance |
| 3. Capture handwriting/document | Existing photo/document intake; new real browser→native synthetic photo transfer | Physical handwriting and live reading quality |
| 4. Preserve original | 263-test native suite; exact photo bytes after offline replay; quote byte-range assertions | Real-device capture transformations |
| 5. Process/organize | Existing consented Jev→Claude→deterministic publication preserved | No provider credentials configured here; current live-provider verification blocked |
| 6. Edit inside Recall | Existing #54 editor/revision/draft recovery retained; 115 desktop tests pass | Installed Windows/editor acceptance |
| 7. Vague question | Improved lexical ranking and explicit-link context implemented and locally verified | Broad semantic recall remains incomplete; #50 stays isolated |
| 8. Evidence-backed answer | Exact source excerpts, offsets/hash, revision and correction distinction verified | Generative synthesis and held-out live-provider quality incomplete |
| 9. Graph exploration | Existing real graph and retrieval highlights retained; canonical UI checks pass | Physical-device interaction and large-library performance |
| 10. Correct interpretation | Real native correction/reopen test retains current correction and historical original separately | Current live-provider reprocessing acceptance |
| 11. Restart persistence | Native reopen tests and real browser/companion restart verified | Installed Windows/physical iPhone |
| 12. Export/restore | #54 implementation and real Linux restore evidence retained; native regression suite passes | Installed Windows restore; independent device acceptance |
| 13. Phone offline/sync | #55 implemented and 7 browser/native tests pass; receipt scope/identity and originals verified | Physical iPhone, HTTPS/Tailscale/denied-peer acceptance; no offline library replica |

The inherited evidence is at `../native-library-editor/ACCEPTANCE.md`; this ledger does not relabel it as newly performed. No independent reviewer or Windows/iPhone acceptance is claimed for these continuations. Full native-memory mission remains incomplete at the explicit gaps above.

### Formal review repair

#57's short-term retrieval correction is backported here, including its names/units/numbers regression. A new ordinary native regression for `東京` fails before the backport and passes after it; this PR no longer requires #57 to repair that landing regression. The #54 and #55 repaired bases are merged with ancestry intact. Provider, installed Windows and physical iPhone acceptance remain open; lexical retrieval is not semantic/generative completion.
