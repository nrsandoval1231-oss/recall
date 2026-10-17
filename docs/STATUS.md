# Recall — Status

The single live record of what works, what's unproven and what's next. Update it in the same PR as the change. The pre-2026-10-15 evidence ledger is frozen at [history/ACCEPTANCE-LOG-2026-10.md](history/ACCEPTANCE-LOG-2026-10.md).

**Evidence levels:** **Automated** = tests or CI with synthetic data. **Owner-observed** = you saw it on a real device. **Not started** = no implementation yet. Only owner-observed evidence on the current commit counts toward the [definition of done](VISION.md#definition-of-done-v1).

_Last updated: 2026-10-15. Initial UI-authority audit baseline: `8423206fa683d4830b1ae8f239fe9ec73bfc4e64` (PR #58). Reconciled on top of `07e79bfeb5141632b1ae0ddebd09ea534de88375` after PR #59 merged during the audit._

## MeGraph cloud checkpoint — 2026-10-17 (not production ready)

The owner's master prompt supersedes the earlier local-only roadmap. Base: approved UI commit `ad8f742`; branch `feat/megraph-cloud`. No redesign of the memory field. The existing React surface now serves authenticated browsers/PWA and optional native cloud mode, alongside the unchanged local library mode.

**Audit:** Tauri 2/Rust + React desktop; Markdown/originals/history native library; existing SQLite cache; FastAPI/PostgreSQL/pgvector backend; existing Anthropic/Voyage integrations, device enrollment, private original store and backup system. The old phone companion requires a running PC. Historical web/mobile clients use another interface, so the approved React frontend is reused instead. No local Ollama dependency is required. Windows NSIS packaging remains in CI. The open design-board PR is unrelated. Hostinger VPS access/SSH configuration was absent; no server inspection or production mutation was possible.

**Implemented:** workspace-isolated native-library records, immutable verified originals, revision-conditional mutations and idempotency receipts; HttpOnly cookie sessions/CSRF checks and revocation; shared web UI; PWA shell/PNG icons; browser IndexedDB and desktop SQLite outboxes; automatic reconnect, tombstones and conflict retention; native HTTPS transport with OS-held credentials; backup-first opt-in text/primary-photo migration preserving IDs/basenames/history; source-backed cloud answers behind existing consent/budgets/citation validation; cloud settings and private device export; isolated Compose images, persistent volumes, restricted runtime roles, health checks and restart policies. Original local libraries are not rewritten.

**Verified with synthetic data:** backend regression 259 passed before the final additional provider-gate test; native-library suite 6 passed including isolated backup/restore and consent/citation rejection; frontend 147 passed; native Rust 297 passed, 3 ignored. Backend Ruff/format/mypy and frontend ESLint/typecheck passed. Both production Docker images built. Actual PostgreSQL API browser test passed capture/correct/search/graph/original hash/reload/mobile axe/logout. Packaged PWA passed offline capture, offline reload and reconnect with no duplicate records. Isolated database/API/worker restart retained records/revisions/source hashes and anonymous requests remained refused. These do not prove physical-device or production acceptance. Retained [synthetic browser evidence](assets/megraph-cloud/verification.json), [desktop graph](assets/megraph-cloud/web-graph.png), and [mobile original](assets/megraph-cloud/mobile-source.png). See [deployment/recovery instructions](../infra/megraph/README.md).

**Incomplete implementation (not attributed to missing credentials):** native-library extraction and semantic indexing are not connected to the existing cloud processing engine; audio capture; secondary attachment upload/migration/offline synchronization; conflict review/merge; incremental large-library synchronization (currently bounded full snapshots, at most 10,000 notes); complete export/import parity and cloud relationship processing. Attachment-bearing native memories are explicitly refused during import rather than falsely reported migrated. Cloud mode uses SQLite; the old Markdown folder is retained as an independent local library, not a bidirectionally synchronized folder. No real owner data was migrated.

**External acceptance blockers:** Hostinger SSH/Docker/reverse-proxy permissions and intended hostname/DNS; remote provider keys/model/prices; encrypted off-host backup destination; installed Windows and physical iPhone access. No production URL, Hostinger deployment, updated installer artifact, live-provider result, physical PC-off test, scheduled encrypted backup or production recovery is claimed. Complete the remaining implementation before production release, then run all master-prompt A–E tests on the deployed version. The current branch is a reviewable checkpoint, not the master prompt's definition of done.

## Reference-matched memory nodes — 2026-10-17

Refinement based on `ba196b869bac40bacc34a17641eef11bd83c36ca`. Owner approved the revised visual direction in this session after reviewing the reference-matched typography and layout. Owner rejected the initial translucent neutral treatment and supplied the approved desktop board as the explicit target. That supersedes the first opacity treatment: the current SVG uses defined, subtly shaded sage/copper/stone nodes, thin outer rings, smaller adjacent labels with source counts, a central sage library node and fine orbital lines. Default nodes are 85% opaque, background 45%, related 75%, hover/selected 100%, with 280ms transitions. Selection also strengthens its ring and label. Stable hit regions, keyboard focus and reduced motion remain. Dense fields (>40 nodes) reveal labels on hover/focus/selection, retaining accessible names and the searchable list. Pre-existing 200-node layout crowding remains; no changes to relationships or layout derivation.

**Evidence:** [original before](assets/soft-graph/before), [rejected first treatment](assets/soft-graph/after), [current reference treatment](assets/reference-graph/after). Actual desktop React interface in Chromium at 1536×1024 and 1182×789, synthetic six-source and 200-source libraries. Selection opens the existing inspector and hides the mounted graph; `selected-inspector` records that real flow, while `selected-renderer` explicitly reveals the mounted graph with test-only CSS to inspect its styling. The reference's illustrative categories and unsupported insight percentages are not fabricated as live library data. This is not a pixel-exact or installed-Windows acceptance claim.

**Checks:** `npm run test -w @recall/desktop` — 143 passed again for the current treatment. `npm run build -w @recall/desktop` and focused ESLint passed. `RECALL_UI_EVIDENCE_DIR=docs/assets/reference-graph/after node apps/desktop/scripts/verify-soft-graph.mjs` and the same command with `RECALL_DENSE=1` exercise selection, opacity, reduced motion, pointer/keyboard pan, zoom/reset, relationship list and axe/overflow checks. The full `test:visual` walkthrough at 1182×789 passed with zero axe violations, overflow or console errors (capture, processing/failure/retry, editing, graph, Ask, settings and original-photo inspection). Owner also requested matching typography and layout: desktop rail/field/context proportions, Playfair Display heading scale, serif supporting copy, compact Inter labels and a bottom three-column library-count strip now follow the supplied reference. Existing capture actions and real library content remain. No storage, retrieval, relationships or native code changed. Installed Windows and live-provider checks not run.

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

## PR #63 rendered-app repair — owner visual approval pending

The owner rejected the audited UI at `6decc918a68b23340cd3514c654ebea477eca5ea`. Fetched PR #63 and main before work: the PR still had that exact head, with no newer changes to reconcile. Repairs remain on the same feature branch; no merge or deployment. Production changes: desktop `94ed0ec`, phone `8fe6f55d978f23ec80c1bf23ab725777365aab8b`; `755ac05` is indentation only and `83a32dd` adds validation screenshot evidence. Later commits retain this record and captures. The three canonical PNG hashes are unchanged.

**Actual before/after screens:** [side-by-side comparisons](assets/polish/comparisons), [before](assets/polish/before), [after](assets/polish/after), [commands/results and capture hashes](assets/polish/verification). Comparisons place complete screenshots at their original size, without cropping, distortion or similarity scoring. All data is explicitly synthetic. Desktop runs the actual React UI with synthetic native-command responses; phone runs the actual Linux companion against a disposable synthetic library.

Repairs, in implementation order:

1. **Layout/hierarchy:** reduce rail and display-heading scale; use the full memory-field width below 1100px. Put empty-state text in document flow rather than over the shrinking graph. Give capture, editor and Ask the primary workspace instead of the 230px inspector. Keep the graph mounted so its viewport/selection survive returning to it. Relationship-list controls now remain outside the list's scrolling area.
2. **Editor/state:** four focused Note / Original / Related / History tabs; remove the duplicated note rendering, fold formatting/link tools and move attachment recovery below editing. Autosave/session/revision behavior is unchanged. Processing shows the actual receipt text rather than a permanent “Processing your memory” heading. Pending Ask says “Searching…”; failures retain the question. Source excerpts, byte offsets, citations and original navigation remain.
3. **Phone:** tighten header/form spacing, refine the native file input, and position Save using measured navigation height (including safe areas and enlarged text). Field errors are adjacent and focus the relevant control; storage errors remain by Save. Hide bottom navigation only when a focused text field has a substantially reduced visual viewport. Keep the live form/draft and outbox contracts. Retrieval and quoted-answer headings use source text instead of UUID filenames; retain a readable fallback, original excerpts and verification disclosures.
4. **Polish/accessibility:** relative type sizes support 200% text; rail width adapts accordingly. Non-scaling graph strokes retain crispness at normal zoom and 2× device pixel density. Focus, disabled states, reduced motion and existing 48px action targets remain.

**Measured regression:** baseline 900×640 graph region y=253.53–454.72 overlapped the empty message y=377.27–439.50; task width was 230px ([baseline geometry](assets/polish/before/layout-regressions.json)). The current browser verifier asserts the empty message starts below the graph and that desktop task width is at least 600px (or 65% of the viewport). It checks actual rectangles and pending/completed states rather than accepting replacement images.

**Final verification:** all commands below exited 0. Commands run from repository root. Native commands use the same user-space GTK/WebKit environment recorded below (`PKG_CONFIG_SYSROOT_DIR`, `PKG_CONFIG_PATH`, `LIBRARY_PATH`, `LD_LIBRARY_PATH` pointing into `/tmp/recall-sysroot`); Chromium is `/usr/bin/chromium`.

| Command | Result |
|---|---|
| `npm run check` | Lint, all typechecks, 302 unit tests passed. |
| `npm run build -w @recall/desktop` | Production build passed. |
| `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin recall-phone` | Passed; three existing dead-code warnings. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | 295 passed, 3 ignored. |
| `LD_LIBRARY_PATH=/tmp/recall-sysroot/usr/lib/x86_64-linux-gnu RECALL_CHROMIUM=/usr/bin/chromium npm run test:phone` | 18 passed: offline durability/retry, library switching, receipt integrity, drafts/consent, field validation, source-title/evidence access, keyboard focus, 48px targets, reduced visual viewport and 200% text. |
| `RECALL_UI_URL=http://127.0.0.1:1420 RECALL_CHROMIUM=/usr/bin/chromium RECALL_UI_EVIDENCE_DIR=$PWD/docs/assets/polish/after npm run test:visual -w @recall/desktop` | Five viewports: 1536×1024, 1182×789, 900×640, 390×844, 430×932. Empty, capture, saved, processing, failed/retry, ready/editor, history, graph, Ask loading/results/error/empty and original-photo states. No axe violations, overflow or console errors. 200% desktop text checked at900. |
| `RECALL_UI_EVIDENCE_DIR=$PWD/docs/assets/polish/after node apps/desktop/scripts/verify-populated.mjs` | Six populated layouts including 900×640 at2× density; zero axe/overflow findings. |
| `RECALL_PHONE_EVIDENCE_DIR=$PWD/docs/assets/polish/after node apps/desktop/scripts/verify-phone.mjs` | Native loopback at18788; Home/Write/Camera/receipts/detail/Ask/results/validation at320/390/430. No axe/overflow/console findings. |
| `python scripts/compare-polish-ui.py` | Full-size before/after comparisons retained. |
| `git diff --check` | Passed. |

**Failures found and repaired:** baseline regression run failed on the 230px workspace and stale processing heading; baseline narrow capture also lacked an exposed h1. The first repaired walkthrough found relationship-list controls intercepted by the list; moved controls/list into normal layout. The 200% phone test exposed Save/navigation overlap; measuring actual nav height fixed it. Initial check exited2 on a test-only Testing Library option mismatch. Stale Back-button, field-error-location, helper-copy and file-attribute-order assertions were updated without dropping original preservation, retry or consent assertions. These failures are not counted as passes.

**Visual review and remaining gates:** reviewed actual 900px empty/capture/editor/Ask, populated graph at1×/2×, wide capture, phone Write/results and 200% text captures. The repaired tasks are wider, controls no longer collide in tested states, and phone Save is fully visible. This is a repair submission for **owner visual approval**, not a declaration of canonical pixel parity or completed device acceptance. No physical iPhone/Safari keyboard, installed Windows, real Tailscale, live providers, assistive-technology or clean-machine restore validation was performed. Visual-viewport tests are browser-contract simulations only. Large/dense graph layout beyond the previous bounded200-node behavior remains unverified. Three native tests remain ignored; frozen-cloud browser UI tests were not run.

## Canonical implementation evidence — 2026-10-15

The initial implementation at PR #63 head `6decc91` was **rejected by the owner for rendered visual quality**. The following is its historical automated evidence, not visual acceptance. See the repair record above for the current candidate. Source candidate `7dd083c488d1747d188ebd9723296a3b647cb691` received independent whole-branch review; `76eda68` fixes only test fixture/type declarations. Integrated main `c793c43` (PR #60) at `e68728c`, preserving its provider defaults and model-specific pricing safeguards. Merge conflicts retained canonical hash verification and main's stale-image cleanup. No provider implementation conflict occurred.

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
