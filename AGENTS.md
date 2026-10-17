# MONOLITH — builder instructions

## Read first

1. `docs/VISION.md`: the only product-scope and trust authority.
2. `docs/DESIGN.md`: the application guidance for the canonical MONOLITH guide in `branding/monolith/v1/BRAND_GUIDE.md`, selected by the owner on 2026-10-17. Read it before any visual, component, navigation, icon, logo or styling work.
3. `docs/STATUS.md`: current state and the next step. Work only on what it lists next unless the owner says otherwise.
4. `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/ACCEPTANCE.md` as needed.

`docs/history/` is frozen evidence, not instructions or design references. `docs/legacy-cloud/` describes frozen code; no new features there. Historical words such as "canonical" or "approved" do not restore an old UI's authority.

## Hard rules

- **One visual direction:** MONOLITH guide, actual M assets and tokens from PR #65. Supersede Recall boards, orbital logos, ivory/sage/copper and MeGraph product branding. Historical records are evidence only; preserve working functionality and original user imagery.
- **Restrained imagery:** follow the MONOLITH guide. User-captured photos, scans and camera preview remain original source evidence. Never delete capture functionality or replace originals to satisfy a visual rule.
- **No fabricated mockup data:** counts, insight percentages, likes, example memories and unsupported features must not become fake live product behavior.
- **No Obsidian.** Don't add Obsidian integration, vocabulary, URIs or "open in" actions. The library is plain Markdown + YAML + originals.
- Follow every trust rule in VISION.md: originals saved before AI; models propose, the deterministic writer commits; model output is untrusted; no silent overwrite of external edits; corrections survive reprocessing; answers cite evidence or abstain; keyword-only results are labelled.
- Never commit real captures, client data, credentials, libraries or private corpora. Label synthetic fixtures.
- Preserve the owner-authorized authenticated web/PWA and optional Windows cloud checkpoint in ARCHITECTURE.md. Additional infrastructure or access changes require a written architecture decision.
- Don't provision paid infrastructure, publish apps, or enable production data processing without explicit owner authorization.

## How to work

- One small packet at a time; the smallest end-to-end change that proves it. No speculative scaffolding.
- Business logic in the Rust core; UI in React; platform access through narrow native commands.
- Add regression tests with real behavior changes. Before removing an old component or runtime asset, inspect its consumers and retain required behavior and test evidence.
- Update `docs/STATUS.md` in the same PR. Don't create new planning/PRD/contract files. Edit the canonical docs instead.
- Visual approval, asset preservation, source implementation and device acceptance are separate states. Never claim the new UI is implemented because the vision document changed. The source guide/assets and remaining optical/device gates are recorded in DESIGN.md and STATUS.md.
- Report exact commit, commands, results and what was not tested. Synthetic tests never stand in for installed-Windows, physical-iPhone or live-provider evidence.
