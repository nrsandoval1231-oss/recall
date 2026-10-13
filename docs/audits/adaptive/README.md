# Adaptive Memory Surface implementation evidence

Implements the canonical desktop UI in PR #51, against the unchanged [approved four-panel PNG](../../assets/B4063AE0-31B8-4E1D-B9B2-48C3F181E423.png), Git blob `6abf5192ab4ee96708984174ed15e3648c668bf0`. All three PR #51 documents are included without changing their specification. Older PR #48/#49 dashboard designs are superseded.

## Visual evidence

Every screenshot here uses **synthetic browser IPC and synthetic sources**, not real personal data, installed Tauri, native persistence or live providers. The production Tauri entry and its normal components are exercised; fixtures exist only in the verification script.

- [Previous dashboard UI](../ui/native-fixture-home.jpg): historical synthetic browser evidence, retained as the before comparison.
- [Approved reference and implemented Home comparison](approved-comparison.jpg).
- [Empty Capture, 1536×1024](empty-1536.jpg), [1182×789](empty-1182.jpg), [900×700](empty-900.jpg), [390×844](empty-390.jpg).
- [Saved, awaiting consent](saved-1182.jpg), [active organization](processing-1182.jpg), [validated interpretation](ready-1182.jpg).
- [History inspection](inspection-1182.jpg), [graph exploration](graph-1182.jpg), [source-backed Ask](ask-1182.jpg), [photo original](photo-1182.jpg).
- Equivalent saved, processing, ready, inspection, graph, Ask and photo screenshots exist at all four widths.

The reference’s typography, circular controls, ivory canvas, cognac accents, rail, luminous selected source and right glass inspector are the visual targets. Its illustrative people/topics/relationships are deliberately not reproduced as production data. Real sparse vaults remain sparse. Empty vaults show a faint abstract motif, without selectable fictional nodes. The actual UI retains honest unavailable-voice and provider-consent explanations absent from the illustration. Inspectors provide Original/Understanding/Related/History layer navigation, revision-safe corrections and uncertainty.

## Verification

Local commands:

- `npm run check`: lint, all-workspace typechecks and all-workspace unit tests.
- `npm run build -w @recall/desktop`: TypeScript and production Vite build.
- `RECALL_CHROMIUM=/usr/bin/chromium npm run test:visual -w @recall/desktop`: all four required sizes, synthetic text/photo capture, unchecked consent, event-driven organization, correction/history, reload, graph, retrieval, Escape/settings and timeline. See [machine-readable results](browser-verification.json). No JavaScript errors, horizontal overflow or automated accessibility violations in the measured states.
- `git diff --check`.

Graph tests cover empty-vault honesty, deterministic reconstruction independent of index order, deleted records, unconnected memories, separated unresolved identities, conflicted notes and eligible explicit links. Existing source-integrity, same-operation capture retries, no-consent/no-provider, uncertain provider review, stale-response and revision-safe correction regressions remain. New tests cover vault-scoped failed drafts, Cancel focus/draft restoration, and restart recovery of a pending photo.

Independent review found and prompted repairs for narrow accessible names, vault-scoped pending state, late native completions, inspector focus, tentative link styling, processing composition, gradient specificity, SVG pan coordinates, mode-specific capture controls, pending-photo restart and inspector navigation. The Obsidian handoff builds a fixed encoded URI from a scoped current native record and launches an OS handler without a shell.

## Native capability and acceptance boundaries

| Capability | Implementation | Verification boundary |
| --- | --- | --- |
| Camera | Existing native file picker and immutable vault original writer | Existing native regressions run in PR CI; screenshots emulate IPC |
| Write | Existing native durable text capture and same-operation retry | Frontend regressions; native text/restart tests in PR CI |
| Speak | Explicitly unavailable; no recorder or fake waveform | Browser and unit checks |
| Processing | Existing consent/budget-gated Jev → Claude → deterministic writer | Existing native pipeline tests in PR CI; screenshot provider replies synthetic |
| Ask | Existing scoped source-backed quotes, honest keyword fallback | Unit/browser checks; native retrieval tests in PR CI |
| Graph | Read-only deterministic source/note projection; separate unresolved mentions; explained tentative links | Pure graph tests, browser navigation/reload; no Graphiti dependency |
| Corrections/history | Existing revision-safe native paths and immutable originals | Retained safety regressions and browser walkthrough |
| Obsidian | Narrow ID-scoped, shell-free URI handoff | Native URI tests in PR CI; actual installed app launch remains open |
| Phone | Existing companion and architecture unchanged | No physical iPhone acceptance claimed |

Local native test execution was attempted but blocked: `cargo` and WebKit development libraries are absent; this non-root environment has no `sudo` and rejects package installation. The PR’s `desktop-native` and `windows-native` jobs run Rust tests/checks; Windows also builds an unsigned installer. New `adaptive-desktop-ui` CI runs the screenshot/accessibility walkthrough against the production frontend and uploads its evidence.

Installed Windows UI, real photo/handwriting quality with Jev/Claude, actual Obsidian protocol launch and physical phone acceptance must still be performed on suitable hardware with configured providers. CI builds and synthetic screenshots do not establish those checks. This PR does not merge PR #26 or #50, replace vault storage, introduce authentication or enable production provider processing.
