# MONOLITH — Repository audit and cleanup register

**Date:** 2026-10-28  
**Basis:** GitHub default branch (`main`, commit `fd60bc3` at inspection), canonical VISION/DESIGN/STATUS/ARCHITECTURE, current AGENTS/README, code-search samples, and PRs #69–#71.  
**Scope:** Documentation and architectural consistency audit; **not** a complete security scan, local build, dependency-tree audit or per-file runtime verification. No production, user memory, history or live environment was modified.

## Canonical target

- Brand: **MONOLITH — Your world. Connected.**; approved M symbol, smoky-glass black/gray, Sora headings and Inter UI/body. Brand authority: `branding/monolith/v1/BRAND_GUIDE.md`, `docs/DESIGN.md`.
- Product: private local-first memory, no required Obsidian; Markdown/originals/history owned by the user, evidence-led Ask, corrections and explainable relationships.
- Experience: one adaptive Memory Surface; Camera, Speak (only if real and accepted), Write; phone/PWA cloud usable without PC, private companion supported.
- Architecture: independently usable offline Windows library; authorized authenticated cloud mode with safe, opt-in synchronization. Jev → Claude → deterministic writer, explicit consent/budget limits, no invented graph entities or answers.
- Data: original bytes immutable to AI; append-only human revisions; source-backed interpretations and rebuildable views separate; legacy storage/API/credential names retained where necessary for compatibility.

## Findings and disposition

| ID | Severity | Surface | Verified observation | Action |
| --- | --- | --- | --- | --- |
| A01 | High | `docs/PRD.md` | Missing from `main`; existing PRD on divergent PR #71 branch is dated 2026-10-09 and requires Obsidian/no account login, contrary to 2026-10-17 VISION. | **Fixed in this PR:** new canonical PRD aligned with VISION. |
| A02 | High | Branches and migrations | PR #71 targets `implement/owner-device-pairing`, not `main`. PR #70 documents 67 unique commits vs 155 on main and conflicting backend migration numbers 0009/0010. | **Open:** never wholesale merge; compare schema/history and selectively port compatible work in independent PRs. |
| A03 | High | Cloud conflict resolution | PR #69 implements conflict-review UI/transactions but remains unmerged and real-device validation is incomplete. | **Open:** independent review + precise candidate testing before merge. |
| A04 | High | Real-device release evidence | STATUS has synthetic acceptance, not installed Windows, real credential store, physical iPhone, deployed PWA or full production/live-provider verification. | **Open:** sign off ACCEPTANCE against one installed exact commit. |
| A05 | Medium | `AGENTS.md` | Previously said not to create PRDs while main had no current PRD; historical/legacy sections could be misread as current authority. | **Fixed in this PR:** document hierarchy, no-new-duplicate-PRDs rule, branch hygiene. |
| A06 | Medium | README / STATUS / ARCHITECTURE | README omitted PRD; STATUS last dated 10/21; architecture retained historical local diagrams without an explicit PR #71 warning. | **Fixed in this PR:** navigation, audit status and historical-context notice. |
| A07 | Medium | `apps/mobile/`, `apps/web/` and shared legacy client code | Code-search shows old Recall and Supabase sign-in paths. Active PWA reuses approved MemorySurface; older clients are not the canonical experience. | **Open:** dependency/runtime inventory first; then mark obsolete entry points, remove only after tests prove no consumers. Do not confuse string drift with active behavior. |
| A08 | Medium | `infra/README.md`, `infra/pilot.compose.yml`, `infra/supabase/` | Infrastructure documentation describes older DO/Supabase pilot. Active cloud architecture targets dedicated service deployment while preserving existing assets; current runtime configuration needs verification. | **Open:** inventory actual deployments, DNS, volumes, credentials, backup and CI references. No speculative production deletion. |
| A09 | Medium | PR #71 local SQLite/keychain/app-data migration | PR explicitly lacks installed Recall→MONOLITH upgrade verification; SQLite fallback opens whichever main database file exists after migration failure. | **Open:** fail-closed review, real Windows upgrade rehearsal and backup/restore before integration. |
| A10 | Medium | `docs/ARCHITECTURE.md` | Retained references to `Recall/`, `recall-phone`, old technical file names and compatibility library semantics. | **Preserve:** valid historical/technical references until a tested migration exists. UI branding is separate. |
| A11 | Low | `docs/history/`, `docs/legacy-cloud/` and superseded design screenshots | Archive contains old mandates and references; history is explicitly frozen and linked. | **Preserve:** read-only historical evidence; do not mass-edit or delete. |
| A12 | Medium | Dependencies | Existing STATUS reports 22 advisories at its previous npm install; new scan and impact verification not performed here. | **Open:** run current audit and upgrade only with regression evidence. |
| A13 | Medium | Brand assets | STATUS records missing source ZIP/raster masters and pending visual approval of reconstructed M. | **Open:** verify exact intended source assets; do not silently redraw or replace. |

## Safe cleanup performed in this documentation PR

1. Reintroduced a single current `docs/PRD.md` on the main integration line, retiring contradictory Obsidian and no-login requirements.
2. Updated `AGENTS.md` to require VISION/PRD/DESIGN/STATUS coherence and to prevent builders from treating the divergent PR #71 implementation as canonical.
3. Updated README navigation and documented the audit.
4. Added the latest branch/PR reconciliation and explicit evidence limits to STATUS.
5. Added an architecture reading guide to distinguish active cloud design from legacy identifiers/historical diagrams.
6. Left data migrations, native sources, installer files, CI, archived evidence, real libraries and deployed infrastructure unchanged.

## Next execution packets (ordered)

**P1 — Merge-direction inventory.** Compare live `main` with PR #69/70/71 at file and migration grain. Resolve the two migration histories on paper, not in a blind merge. Write explicit keep/port/drop decisions for voice, pairing, local import, rename and cloud conflict review.

**P2 — Safety/integrity fixes.** Review SQLite rename/fallback and account/keychain migration, cloud conflict transaction boundaries, native/cloud attachment migration and restoration. Add regression tests for interruption, two processes, stale edits, credentials and backup integrity.

**P3 — Canonical runtime prune.** Enumerate imports, build scripts, CI and deploy consumers of `apps/mobile`, `apps/web`, old `packages/api-client` auth and old infra paths. Retire only confirmed dead paths; add tests guarding the supported desktop/PWA/companion entries. Keep old technical keys and migration paths until compatibility is proven.

**P4 — Real acceptance.** Installed Windows, iPhone Safari, provider and microphone tests, clean-machine restore, accessibility, offline cloud sync and authorized hosted staging. Record result, device, commit and source type for each test.

**P5 — Brand polish.** Verify source M vector, typography and responsive layout against approved guide. Do not replace original user images or introduce fabricated metrics.

## Explicit non-goals of this packet

No speculative feature implementation, renaming every internal `recall` identifier, deleted migration scripts, erased archives, forced cloud onboarding, production deployment, automatic provider spend or unvalidated claims. Historical user data wins over aesthetic naming consistency.
