# Recall — Status

The single live record of what works, what's unproven and what's next. Update it in the same PR as the change. The pre-2026-10-15 evidence ledger is frozen at [history/ACCEPTANCE-LOG-2026-10.md](history/ACCEPTANCE-LOG-2026-10.md).

**Evidence levels:** **Automated** = tests or CI with synthetic data. **Owner-observed** = you saw it on a real device. **Not started** = no implementation yet. Only owner-observed evidence on the current commit counts toward the [definition of done](VISION.md#definition-of-done-v1).

_Last updated: 2026-10-15. Initial UI-authority audit baseline: `8423206fa683d4830b1ae8f239fe9ec73bfc4e64` (PR #58). Reconciled on top of `07e79bfeb5141632b1ae0ddebd09ea534de88375` after PR #59 merged during the audit._

## UI and brand lock — 2026-10-15

**Approved:** Nick selected the final photo-free desktop, mobile and brand boards as Recall's only UI vision. [DESIGN.md](DESIGN.md) replaces the earlier four-panel reference and records the exact originals, hashes, identity, palette, typography, logo direction, screen composition and safeguards. README, VISION, AGENTS, the desktop/token documentation and PR checklist point to that one authority. The obsolete active design PNG is removed; historical technical evidence is retained and explicitly non-authoritative for design.

**Preserved:** all three original approved boards plus three same-family supporting studies, without recompression, in the owner's Library archive `Recall-Approved-UI-2026-10-15.zip`. The archive has a SHA-256 manifest. The supporting studies are not competing authorities; photographic and blue-violet explorations are excluded.

**Not yet complete:** the three full-resolution PNGs have not been imported into GitHub. DESIGN.md lists their reserved paths and required checksums. This documentation lock does not implement the new UI, produce final vector logo masters or establish screenshot parity. Do not regenerate the references or use the retired design to fill that gap.

### Source audit and implementation debt

- Automated UI verification (`apps/desktop/scripts/verify-ui.mjs`, CI `adaptive-desktop-ui`) no longer compares against the retired four-panel image, which the lock removed and the script had required. It still captures four viewports and runs the axe, console-error and synthetic IPC walkthrough checks. **There is no visual comparison against the approved boards yet**; add one when their PNGs are imported.

- `docs/DESIGN.md` previously required the older exact four-panel PNG. That design authority is replaced, not retained as an option.
- Shared token documentation and `packages/design-tokens/src/index.ts` said no brand had been approved. That claim is corrected; exported runtime token values remain unchanged and need a tested migration.
- `apps/desktop/src/surface/memory-surface.css` still uses Georgia/Times, brown/cognac accents and its previous composition. It has not been migrated to Playfair Display / Inter and the approved palette.
- The desktop source tree still contains `surface/assets/recall-logo.png`, `surface/assets/recall-workspace.webp`, old fixture/component names and the explicit `?mode=legacy-cloud` entry. These are not approved visual alternatives. Inspect references and remove or replace obsolete runtime assets/components with regression coverage during implementation; their deletion is not claimed here.
- Frozen cloud-era applications and historical screenshots are retained as implementation/history, not design directions. This was a targeted source/documentation authority audit, not a complete rendered-screen, dependency or native-runtime audit.

The authority lock changes documentation and the token source header comment only, and removes the superseded documentation image. No application behavior, provider configuration, database, private library, deployment or production processing is changed. No new npm, Rust, native-device or visual parity pass is claimed for this lock.

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

Friends install the Windows build and use their own keys (option 1; no shared/hosted instance). PR #59 merged the Settings → AI providers source, tag-triggered pre-release workflow and [TESTING.md](TESTING.md). Those changes are preserved by this design lock; merge is not proof of an installed-Windows credential-store round trip. First beta tag still waits on owner sign-off after acceptance sections A–E.

## Next steps

**Owner-authorized visual work:** import the exact approved originals, then migrate the existing desktop and phone presentation to DESIGN.md. Preserve working capture, evidence inspection, corrections, consent, offline behavior and pairing. Replace old logos, palettes and decorative assets after checking their consumers; do not keep a selectable alternate UI. Retain exact-commit before/after screenshots and regression results. Preserve the provider Settings work merged in PR #59.

The existing v1 acceptance sequence remains required:

1. ~~Acceptance runbook~~ done: [ACCEPTANCE.md](ACCEPTANCE.md).
2. **Installed Windows run** of current main using the CI installer. Every failure becomes a small fix PR.
3. **Live photo evaluation** with approved handwriting samples, plus the entity-classification fix.
4. **Physical iPhone + Tailscale run.**
5. **Clean-machine export/restore.**
6. **Legacy cloud cleanup:** inspect dependencies before deleting `services/backend`, `apps/web`, `apps/mobile` or `packages/api-client|sync|contracts`; they are not UI references.
7. After v1 acceptance: Speak, model-written Ask answers, and a fresh port of PR #26's Linked / Mentioned panel (mentions labelled as unverified hints).

## Concurrent work and PR history

PR #59, **Configure Jev and Claude in Settings; tester pre-release workflow**, merged during this audit at `07e79bfeb5141632b1ae0ddebd09ea534de88375`. The visual-lock update is based on that commit and preserves its provider code, Settings component, release workflow, development guidance and tester guide. No release/tag approval is granted by this UI lock. PR #26 was closed 2026-10-15; its branch is historical, not a design reference. Recheck live PR state before acting.
