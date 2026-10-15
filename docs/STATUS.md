# Recall — Status

The single live record of what works, what's unproven and what's next. Update it in the same PR as the change. The pre-2026-10-15 evidence ledger is frozen at [history/ACCEPTANCE-LOG-2026-10.md](history/ACCEPTANCE-LOG-2026-10.md).

**Evidence levels:** **Automated** = tests or CI with synthetic data. **Owner-observed** = you saw it on a real device. **Not started** = no implementation yet. Only owner-observed evidence on the current commit counts toward the [definition of done](VISION.md#definition-of-done-v1).

_Last updated: 2026-10-15. Initial UI-authority audit baseline: `8423206fa683d4830b1ae8f239fe9ec73bfc4e64` (PR #58). Reconciled on top of `07e79bfeb5141632b1ae0ddebd09ea534de88375` after PR #59 merged during the audit._

## UI and brand lock — 2026-10-15

**Approved:** Nick selected the final photo-free desktop, mobile and brand boards as Recall's only UI vision. [DESIGN.md](DESIGN.md) replaces the earlier four-panel reference and records the exact originals, hashes, identity, palette, typography, logo direction, screen composition and safeguards. README, VISION, AGENTS, the desktop/token documentation and PR checklist point to that one authority. The obsolete active design PNG is removed; historical technical evidence is retained and explicitly non-authoritative for design.

**Canonical asset import:** the owner explicitly approved the exact PR #61 files on 2026-10-15, superseding the previous archive checksums. Original PNG bytes from PR head `b4b9eebc2f88a64fcb8960b21db2f46e1f04a8a8` are now in `docs/assets/approved/`; current SHA-256 values are in DESIGN.md. This import alone does not establish UI acceptance.

### Implementation plan and preservation audit

Baseline: latest remote main `e5f6be02282e71acbc8fe30e22a3646b4b13f654`. Dedicated branch: `feat/canonical-approved-ui`.

| Classification | Active files / behavior | Action |
|---|---|---|
| KEEP | Native vault adapter, writer/revision safety, original capture/inspection, MemoryEditor, KnowledgePanel, ProviderSettings, backups, pairing | Preserve contracts and regression coverage. No Rust core/storage rewrite. |
| REPLACE | MemorySurface shell, memory-surface.css, AdaptiveGraph presentation, shared design tokens | Approved rail/search/field/context layout, real evidence graph, honest empty state, accessible controls, self-hosted Playfair Display/Inter. |
| REPLACE | phone.rs presentation and phone companion shell | Matching focused phone pages; preserve IndexedDB outbox, consent, receipts, existing routes and private connection. |
| REMOVE | Selectable desktop legacy-cloud entry; old surface logo/workspace imagery | Remove active alternative and confirmed unused assets after checking consumers. |
| HISTORICAL | docs/history, frozen apps/web, apps/mobile and cloud services | Retain historical evidence and applications; do not use them as visual authority. |

Execution sequence:

- [x] Import and SHA-256 verify exact canonical artwork.
- [x] Capture baseline desktop/phone; retain synthetic versus native evidence labels.
- [x] Implement shared mark variants, typography, palette and primitives, then desktop shell/search/graph/inspector.
- [x] Apply matching presentation to the existing phone companion.
- [x] Compare isolated reference panels to actual captures at desktop 1536×1024, 1182×789, 900×700 and phone 390/430; repair discrepancies, test keyboard/reduced motion and contrast.
- [x] Run applicable lint/typecheck/unit/browser/native checks, remove obsolete consumers, record exact exits and unverified gates, open review PR. No merge or deployment.

Risk-focused checks: empty libraries must not fabricate memories; unavailable recording stays explicit; capture drafts/consent survive navigation; evidence and correction history remain accessible; offline phone delivery remains idempotent and tied to the original library.

## Canonical implementation evidence — 2026-10-15

Production implementation is complete for review, **not accepted as pixel-perfect or release-ready**. Source candidate `7dd083c488d1747d188ebd9723296a3b647cb691` received independent whole-branch review; `76eda68` fixes only test fixture/type declarations. Integrated main `c793c43` (PR #60) at `e68728c`, preserving its provider defaults and model-specific pricing safeguards. Merge conflicts retained canonical hash verification and main's stale-image cleanup. No provider implementation conflict occurred.

**Retained evidence:** [before](assets/implementation/before) captures baseline `e5f6be0`; [after](assets/implementation/after) captures the running implementation. Desktop uses explicitly synthetic IPC and source records; phone captures use the actual Linux native companion with a temporary synthetic library. No screenshot is installed-Windows, physical-phone or live-provider evidence. [Panel comparisons and overlays](assets/implementation/comparisons) record original crop bounds and uniform scaling in `method.json`; aspect differences are preserved. No similarity score is used as an acceptance proxy. [Independent review and test logs](assets/implementation/verification) retain findings and repairs.

Desktop evidence covers 1536×1024, 1182×789, 900×700, plus 390/430 responsive checks: empty, saved, processing, ready, inspection, graph, Ask, original photo and six-record populated layouts. Phone evidence covers Home, Write, Camera, receipts, detail, Ask and results at 390/430, plus offline/delivery receipts. Browser checks found zero axe violations, horizontal overflow or console errors in captured states. This does not replace manual assistive-technology testing.

**Visual findings:** the shared palette, local Playfair Display/Inter, reconstructed orbital SVG variants, rail/search/field/context hierarchy and focused phone views now follow the canonical family. Explicit review repaired hidden notices, colliding small-library graph labels, phone focus/target sizes and clipped desktop capture actions. Remaining differences are visible in the comparisons: readable type and 48px phone actions are larger than board labels; real evidence topology replaces illustrative category counts and wellbeing metrics; phone capture retains file selection, consent and delivery status, so Write has a different vertical composition and persistent masthead. Unsupported timeline/social/profile and recording controls are not simulated. The logo is a vector reconstruction, not an original editable master approved separately by the owner. No exact pixel-parity claim is made.

**Cleanup:** removed active legacy-cloud switching, obsolete `recall-logo.png`/`recall-workspace.webp`, unused dashboard components and fixture. Markdown safety coverage moved with its live consumer. Frozen applications, backend modules, historical evidence and all native storage/ownership contracts remain. Shared `brand.css` now supplies desktop and phone palette/fonts; source photos remain original evidence only.

**Verification commands and exits:** commands run from repository root unless specified. Native commands used `PKG_CONFIG_SYSROOT_DIR=/tmp/recall-sysroot`, corresponding `PKG_CONFIG_PATH`, `LIBRARY_PATH` and `LD_LIBRARY_PATH` for user-space GTK/WebKit development dependencies; Chromium was `/usr/bin/chromium`.

| Command | Final result |
|---|---|
| `npm run check` | Exit 0; lint, workspace/E2E typechecks and 301 unit tests. |
| `npm run build -w @recall/desktop` | Exit 0. |
| `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin recall-phone` | Exit 0; existing dead-code warnings. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | Exit 0; 294 passed, 3 ignored. |
| `LD_LIBRARY_PATH=/tmp/recall-sysroot/usr/lib/x86_64-linux-gnu RECALL_CHROMIUM=/usr/bin/chromium RECALL_PHONE_EVIDENCE_DIR=$PWD/docs/assets/implementation/after npm run test:phone` | Exit 0; 14 passed, including offline/idempotency, draft preservation, keyboard focus and target-size coverage. |
| `RECALL_UI_URL=http://127.0.0.1:1420 RECALL_CHROMIUM=/usr/bin/chromium RECALL_UI_EVIDENCE_DIR=$PWD/docs/assets/implementation/after npm run test:visual -w @recall/desktop` | Exit 0; five viewport walkthroughs, canonical SHA checks. |
| `RECALL_UI_URL=http://127.0.0.1:1420 RECALL_UI_EVIDENCE_DIR=$PWD/docs/assets/implementation/after node apps/desktop/scripts/verify-populated.mjs` | Exit 0; five layouts, six synthetic source records. |
| `RECALL_PHONE_EVIDENCE_DIR=$PWD/docs/assets/implementation/after node apps/desktop/scripts/verify-phone.mjs` | Exit 0; native loopback server at 18788, fourteen captures. |
| `python scripts/compare-approved-ui.py` | Exit 0; cropped-panel side-by-side images and overlays. |
| `git diff --check` | Exit 0. |

**Failures resolved during implementation:** initial missing npm/Rust/native dependencies required environment setup. Stale heading, public-shell cache and broad image assertions were updated for the new presentation while retaining source-specific checks. Axe exposed a missing capture heading, repaired. Final check initially exited 2 because the new token filesystem test lacked Node types; the test now declares them. Phone visual helper initially exited 1 on a stale synthetic-title prefix assertion; changing to the actual fixture content assertion passed. These were not counted as successful runs. No test pass or device result is inferred from screenshots.

**Not verified / remaining gates:** installed Windows packaging/credential store; physical iPhone Safari, virtual keyboard and assistive technology; actual Tailscale pairing; live Jev/Claude and handwriting quality; real clean-machine backup/restore; large/dense graph visual quality (separation is bounded to the first 200 nodes); owner optical approval of the reconstructed mark and compositions. Frozen-cloud `npm run test:ui` was not run; current production presentation uses the checks above. Three native tests remain ignored. No merge, release or deployment performed.

## Definition-of-done scorecard

| # | Step | Built | Evidence |
|---|---|---|---|
| 1 | Create library with no other software | Yes | Automated (Linux Tauri runtime). Not yet observed on installed Windows at current main. |
| 2 | Capture photo + text; original saved first | Yes | Automated. Text owner-observed on Windows at PR42 (older build). Photo not live-tested. |
| 3 | Jev + Claude organize with honest states | Yes | Text: owner-observed live at PR42 (Jev 1.13.0 + Sonnet 5.5). Photo/handwriting: **not live-tested**. |
| 4 | Edit in Recall; external edit handled safely | Yes | Automated |
| 5 | Vague Ask → quoted answer or abstention | Yes (local quote retrieval; no model synthesis) | Automated; one live text query owner-observed at PR42 |
| 6 | Inspect why (source, quote, revision) | Yes | Automated |
| 7 | Correct; survives reprocessing | Yes | Automated |
| 8 | Graph + history navigation | Yes | Automated (browser with synthetic IPC) |
| 9 | Phone capture with desktop off, later delivery, no duplicates | Yes | Automated (loopback). **Physical iPhone + Tailscale never tested.** |
| 10 | Export + restore on a clean machine | Yes | Automated. **Real clean-machine restore never done.** |
| 11 | Survives restart at every step | Mostly | Automated; text restart owner-observed at PR42 |

## Known defects and gaps

- Entity classification mistakes (people/projects tagged wrong) seen in the live run.
- Handwriting transcription quality unmeasured; needs 10–20 approved sample pages.
- **Speak** is not implemented; the UI honestly says unavailable.
- Ask returns quoted retrieval, not a written answer; Claude-synthesized answers are not built.
- Phone page is plain HTTP over Tailscale (no TLS).
- External edits are recorded with the legacy origin string `human:obsidian` (kept for compatibility).
- 22 npm audit advisories, mostly in the legacy Expo stack (carried forward, not remeasured by this design audit).
- Rust/Tauri tests need GTK/WebKit dev libraries locally; CI covers Linux and Windows.

## Friend testing (approved 2026-10-15)

Friends install the Windows build and use their own Claude key (option 1; no shared/hosted instance). The owner provides Jev access. PR #59 merged the Settings → AI providers source, tag-triggered pre-release workflow and [TESTING.md](TESTING.md); PR #60 prefills the model, budgets and (for Claude Sonnet 5.5 only) published prices. Merge is not proof of an installed-Windows credential-store round trip. The first tester tag (`v0.1.0`) still waits on owner sign-off after acceptance sections A–E.

## Next steps

**Visual acceptance:** review the retained reference-panel comparisons and functioning branch. Resolve owner-identified fidelity gaps before merge; the implementation is not a pixel-parity or installed-device acceptance claim. Provider Settings changes from PR #60 are incorporated unchanged.

The existing v1 acceptance sequence remains required:

1. ~~Acceptance runbook~~ done: [ACCEPTANCE.md](ACCEPTANCE.md).
2. **Installed Windows run** of current main using the CI installer. Every failure becomes a small fix PR.
3. **Live photo evaluation** with approved handwriting samples, plus the entity-classification fix.
4. **Physical iPhone + Tailscale run.**
5. **Clean-machine export/restore.**
6. **Legacy cloud cleanup:** inspect dependencies before deleting `services/backend`, `apps/web`, `apps/mobile` or `packages/api-client|sync|contracts`; they are not UI references.
7. After v1 acceptance: Speak, model-written Ask answers, and a fresh port of PR #26's Linked / Mentioned panel (mentions labelled as unverified hints).

## Concurrent work and PR history

PR #60, **Prefill provider model, prices and budgets in Settings**, merged at `c793c43` and is incorporated in this branch at `e68728c`. PR #59 merged at `07e79bfeb5141632b1ae0ddebd09ea534de88375`; the UI lock `e5f6be0` preserves its provider code, Settings component, release workflow, development guidance and tester guide. No release/tag approval is granted by the UI lock. PR #26 was closed 2026-10-15; its branch is historical, not a design reference. Recheck live PR state before acting.
