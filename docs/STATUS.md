# MONOLITH — Status

Updated 2026-10-17. This is the active record. The [prior status ledger](history/STATUS-PRE-MONOLITH-2026-10-17.md) is preserved unchanged as historical evidence; its design mandates and next steps are superseded here.

## Capture enrichment repair - 2026-10-17

Approved repair candidate based on PR #66. Native Markdown rendering now accepts generic `note` and `photo` categories alongside the existing meeting/project/operations categories, derives a fallback title from the first non-retracted source span, and writes category-specific tags. The organization prompt allows generic photos and notes to remain generically typed. Adaptive graph previews prefer an authored Markdown heading to the source filename. Synthetic regression coverage was added for a generic photo, retracted-title fallback, and heading-first preview.

This is a partial repair only. Native capture consent remains an explicit per-capture choice with default off and the native provider ledger still blocks uncertain replays. The cloud library still has no native-record enrichment worker, and cloud captures do not yet enter the native Jev/Claude pipeline. Durable per-memory unified processing states, automatic queue recovery across both storage modes, and a cloud processing UX remain open. No providers, private captures, credentials, devices or deployment were used for this candidate.

## Reconciliation scope

Owner instruction: “monolith is the canonical vision. Remove anything that conflicts”. Main was rechecked at ba196b869bac40bacc34a17641eef11bd83c36ca; PR #64 at d16423c43ab90e1a7de6f52c54f57087cdb90342; PR #65 at c252475d63c31671e70c4a35b687107a6f4af8a9. This isolated candidate builds on PR #64 and imports PR #65's source brand pack unchanged. Other checkouts and branches are untouched.

The actual [MONOLITH guide](../branding/monolith/v1/BRAND_GUIDE.md) and M assets replace Recall/orbital/ivory and MeGraph product identity. DESIGN, VISION, README and builder instructions now agree. Existing schemas, Markdown folders, storage identifiers, API/package/environment/credential namespaces, infrastructure paths and revision compatibility retain technical Recall/MeGraph names. Renaming those would strand existing libraries, offline journals, credentials or deployments. Original user imagery and unrelated features are preserved.

## Working checkpoint and unfinished work

PR #64 provides authenticated same-origin browser/PWA access and optional native cloud mode, independent local libraries, IndexedDB/SQLite journals, immutable originals, revision-conditional writes, tombstones, backed-up opt-in import and existing provider/consent/budget/citation checks. Its prior synthetic frontend/backend/native/Docker results are historical evidence only, not newly executed checks on this candidate.

Unfinished: native-library cloud extraction/semantic indexing, audio, secondary attachments/migration/offline sync, conflict review/merge, incremental large-library sync (bounded full snapshots remain), complete export/import parity and cloud relationship processing. Secondary-attachment imports are refused. Native Markdown folders remain independent, not continuously bidirectionally synchronized. No owner data was migrated.

## Current verification

Final local checks passed: npm run check (lint, typechecks, 307 unit tests); npm run build -w @recall/desktop; cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --offline (293 passed, 3 ignored); cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin recall-phone --offline; npm run test:phone (18 passed). Existing verify-ui walkthrough passed at 1536x1024, 1182x789, 900x640, 390x844 and 430x932; verify-populated passed six layouts including 900px at 2x density, with no axe/overflow findings. No console errors in the UI walkthrough. git diff --check passed. Independent full-diff static review: PASS, reaffirmed after the final decorative graph-label contrast correction. [Synthetic screenshots and browser results](assets/monolith-reconciliation/README.md) are retained.

Manual screenshot inspection corrected clipped MONOLITH rail text, residual warm graph colors and the silver-sphere label contrast. Phone suite initially failed 200% text overflow; header reflow fixed it and all 18 passed after rebuilding. Initial sandbox npm symlink, Vitest temp-cache, native Vault::open access-denied and local-loopback failures were resolved by running the same locked dependencies/checks with normal filesystem/network access. These failed attempts are not passes. npm install reports 22 existing dependency advisories (7 moderate, 15 high); no dependency upgrade was included. Supported computer-use inventory exposed no browser/app; existing repository test harnesses supplied rendered evidence without an interactive workaround. Backend, Docker, live HTTP cloud integration and deployed offline PWA were not rerun for this branding-only delta to PR #64. The source pack lacks the local brand-kit ZIP/raster masters/preview. The guide identifies its M as a vector reconstruction; owner optical acceptance remains required. No visual parity claim follows from importing it.

## Next steps and acceptance limits

Review the new reconciliation branch preserving PR #64/#65 history; do not overwrite either builder branch. Recommended integration: review this cumulative candidate against main, with the branding delta compared against PR #64. Incorporate both source PR ancestries on the new branch, avoiding force pushes; do not independently close or overwrite original PRs. Nick subsequently approved publication and opening a PR; no merge or deployment is authorized. PR #61 remains untouched and superseded for design.

Before release: resolve cloud implementation gaps, then installed Windows/credential-store acceptance, physical iPhone/Safari/keyboard/PC-off behavior, live providers and handwriting, real clean-machine backup/restore and assistive technology. Hostinger SSH/Docker/proxy/DNS permissions, approved hostname, remote provider keys/model/prices and encrypted off-host backup destination remain unavailable. No production URL, live deployment, installer or physical-device acceptance is claimed.
