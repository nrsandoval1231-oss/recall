# MONOLITH — Status

Updated 2026-10-28 (documentation/branch audit only; implementation test evidence below remains from earlier dates). This is the active record. The [prior status ledger](history/STATUS-PRE-MONOLITH-2026-10-17.md) is preserved unchanged as historical evidence; its design mandates and next steps are superseded here.

## 2026-10-28 repository reconciliation

- Current product requirements are consolidated in [PRD.md](PRD.md), aligned with [VISION.md](VISION.md): **no Obsidian dependency**, independently usable local Windows library, authenticated web/PWA cloud checkpoint, consent-gated Jev → Claude → deterministic writer, and source-backed Ask. The PRD does not certify a release.
- `main` is the canonical integration baseline. PR #69 (cloud conflict resolution) remains open; PR #70 (local-first/voice) closed without merge; PR #71 (product rename) is open against the divergent `implement/owner-device-pairing` branch, **not** `main`. The latter branch has conflicting migrations and older Obsidian/no-login decisions. Do not merge wholesale; review and selectively port valuable work.
- [REPOSITORY-AUDIT-2026-10-28.md](REPOSITORY-AUDIT-2026-10-28.md) inventories stale files, architecture mismatches, protected compatibility identifiers and unfinished real-device release gates. No runtime files were deleted or migrated by this docs packet.
- Documentation-only validation: current repository files and branch/PR metadata inspected. No test suites, installed builds, live providers, deployment, or real user-data migrations executed in this packet.

## Where the project stands

Main is at the merge of PR #67 (capture enrichment). The MONOLITH guide and M assets (PR #65) are the single visual direction; the authenticated web/PWA cloud checkpoint and optional native cloud mode (PR #64) are integrated (PR #66). Product scope and trust rules live in VISION; Recall/MeGraph names survive only as technical identifiers (storage keys, package names, API paths, the `human:obsidian` legacy origin string) so existing libraries and deployments keep working.

**Implemented (synthetic evidence only):** native and cloud capture with originals saved before AI; explicit default-off, per-device automatic processing for future captures plus separate per-source permission; Jev → Claude → deterministic writer with budget ledger, uncertain-delivery fences and no automatic replay; durable receipt-only recovery; visual descriptions and grounded titles/tags/suggested connections as proposals; editor with revisions and external-edit handling; Ask with citations or abstention; graph from real links; backup/restore and managed export; authenticated cloud library with revision-conditional writes, tombstones and offline journals.

**Last full local gates (2026-10-17, code commit `dcd08104`, before the final test-scheduling fix):** `npm run check` (lint, typechecks, 318 unit tests); desktop and web builds; native `cargo test --lib` 305 passed / 3 ignored; `recall-phone` build; backend Ruff, format, mypy and 272 passed / 8 skipped (local PostgreSQL lacks pgvector); `npm run test:phone` 18 passed; rendered synthetic walkthroughs at 1536x1024, 1182x789, 900x640, 390x844, 430x932 and populated layouts with no console, axe or overflow findings. Hosted CI at `59a2fb1` exposed a premature queue-test assertion; it was corrected (test scheduling only; ten deterministic Windows repetitions pass, the hosted trigger was never reproduced). Screenshots: [monolith-reconciliation](assets/monolith-reconciliation/README.md).

**2026-10-21 drift cleanup:** removed `scripts/compare-approved-ui.py` and `scripts/compare-polish-ui.py` (compared against superseded boards; no consumers); replaced remaining Obsidian wording in `.env.example`, the runtime-test label and Rust test fixture strings, and updated the stale package description. `npm run check` re-passed on main before these edits. The edited Rust tests could not be built in this container (GTK/WebKit libraries absent), so they are covered only by hosted CI. No behavior changed.

## Known gaps

Native-library cloud semantic indexing, audio/Speak (stays explicitly unavailable), secondary attachments and their migration/offline sync (imports of such memories are refused), conflict review/merge, incremental large-library sync (bounded full snapshots remain), full export/import parity, and accepted cloud relationship projection (enrichment suggestions remain proposals). Native Markdown folders remain independent, not continuously bidirectionally synchronized. No owner data has been migrated. `npm install` reports 22 existing dependency advisories (7 moderate, 15 high); no upgrade was made. The CSS compatibility aliases `--recall-sage/copper/…` hold MONOLITH values; renaming them is cosmetic and untouched.

## Owner decisions pending

- `docs/assets/{approved,polish,soft-graph,reference-graph,implementation,megraph-cloud}` (about 37 MB) are superseded design evidence referenced by frozen history. Deleting them would break historical links; left in place.
- Owner optical approval of the vector-reconstructed M (the source pack lacks the brand-kit ZIP, raster masters and preview).

## Release gates not yet met

No visual parity, installed-device, live-provider or deployment claim is made. Still required: cloud implementation gaps above; installed Windows build and credential store; physical iPhone/Safari/keyboard/PC-off behavior; live providers and handwriting; real clean-machine backup/restore; assistive technology; live HTTP cloud integration and deployed offline PWA. Hostinger SSH/Docker/proxy/DNS access, approved hostname, remote provider keys/model/prices and an encrypted off-host backup destination remain unavailable, so no production URL, installer or deployment is claimed. No merge or deployment is authorized beyond what the owner states.
