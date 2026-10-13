# Canonical Recall desktop design QA

Source visual truth: `docs/assets/recall-desktop-canonical-2026-10-11.png` (owner upload,1182×789). Implementation: `docs/audits/ui/reference-1182.jpg`; full-view same-input comparison: `docs/audits/ui/canonical-comparison.jpg`; focused project typography/spacing comparison: `docs/audits/ui/typography-comparison.jpg`. Both images are shown together, source left and implementation right.

Viewport1182×789 CSS pixels, deviceScaleFactor1; source and implementation1182×789 pixels. Full comparison2364×789, no density rescaling. JPEG92 is screenshot export, not a new design source. Reference state: Home/Overview, explicit labeled browser-only synthetic canonical fixture. Native IPC fixture screenshots separately exercise real-data presentation; they are not live inference or native storage proof.

## Comparison history and fixes

1. P1: former one-card layout lacked the source composition. Rebuilt the branded rail, Ask/chips, left context, centered compact board/recent notes, right calendar/agenda and bottom actions.
2. P2: first rendered cards were too tall and bottom actions fell below the reference window. Matched primary board x≈367,y141,w≈529,h239; recent notes y392,h245; sidebar context x≈204; calendar x≈910,w≈254; bottom row y651. Tightened card rhythm and narrowed the bottom row to preserve the mug margin. Post-fix full comparison is committed.
3. P2: narrow project metadata overlapped. Changed it to a two-column arrangement at≤720px. Post-fix evidence:reference-390.jpg; no horizontal overflow.
4. P2: full-size desktop initially kept small-window row heights. Scaled header, context, rows, calendar, type and action cards to the source proportions at1536×1024. Post-fix evidence:reference-1536.jpg.
5. P2/a11y: added main landmark, accessible compact Vault/Settings names, dialog focus entry/trap/return/Escape, and repaired navigation invalidation. Native fixture accessibility scan reports zero violations.
6. Security/regression: UTC-only calendar arithmetic/labels in Tokyo and Chicago; source focus/vault identity resets calendar state; retracted-only statements never become home summaries; Markdown HTML/images/external navigation blocked; source tags read only from frontmatter; empty native vault never adopts browser design data.

## Required fidelity surfaces

- Fonts: Georgia serif display, Segoe UI with Arial/system fallbacks for body. Checked title hierarchy, weight, line heights, navigation and dense note labels in full and focused comparisons. Small labels reproduce the reference density; actual Windows font rendering remains owner-installation acceptance.
- Spacing/layout: three-column proportions, rail width, header position, card gaps/radii, recent rows and action placement match the measured reference at the primary viewport; large and narrow windows preserve usable hierarchy.
- Colors/tokens: warm ivory, charcoal smoked glass, restrained taupe/gold, fine light borders and soft backdrop blur. Generated scene is decorative and remains separate from original evidence.
- Image quality: supplied brand and preview portraits use owner-reference pixels; background is a clean generated sunlit workspace without baked UI. Rejected generated logo variants with edge artifacts; native icons/favicon derive from the rendered supplied ring instead. No customer portraits are invented.
- Copy/content: reference fixture titles/content and illustrative counts are marked synthetic. Actual vault titles/counts/mentions/tags are source-derived. Search suggestions use supported retrieval wording. Actual calendar shows captures and unscheduled follow-ups; Capture replaces an unsupported Add event promise. Voice remains visibly unavailable. Native window chrome is preserved instead of drawing mock OS controls. These are intentional product constraints, not missing visual work.

## Browser interaction evidence

`apps/desktop/scripts/verify-ui.mjs` captures1182×789,1536×1024,900×700,390×844. It exercises original/hash inspection, readable Markdown, a body correction, source-backed Ask, settings/Escape and capture with unchecked provider consent through an explicitly synthetic native IPC fixture. It rejects any provider command and records browser console/page errors. Current run: zero errors at all four sizes; zero accessibility violations. See browser-smoke.json and native-fixture screenshots.

Reproduce: start desktop Vite on4173, then `RECALL_CHROMIUM=/usr/bin/chromium npm run test:visual -w @recall/desktop` (or installed Playwright Chromium).

## Follow-up polish

P3: the decorative workspace is a reconstruction; underlying blurred furniture/light details differ from the flattened mockup. The supplied small raster logo limits enlarged icon sharpness. Minor platform font/raster differences require the new installed Windows screenshot. No claim of pixel identity or new handwriting/phone acceptance.

Final result: passed
