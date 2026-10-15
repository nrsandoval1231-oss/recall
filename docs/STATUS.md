# Recall — Status

The single live record of what works, what's unproven and what's next. Update it in the same PR as the change. The pre-2026-10-15 evidence ledger is frozen at [history/ACCEPTANCE-LOG-2026-10.md](history/ACCEPTANCE-LOG-2026-10.md).

**Evidence levels:** **Automated** = tests or CI with synthetic data. **Owner-observed** = you saw it on a real device. **Not started** = no implementation yet. Only owner-observed evidence on the current commit counts toward the [definition of done](VISION.md#definition-of-done-v1).

_Last updated: 2026-10-15, main @ `5d185d9` + this cleanup._

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
- 22 npm audit advisories, mostly in the legacy Expo stack.
- Rust/Tauri tests need GTK/WebKit dev libraries locally; CI covers Linux and Windows.

## Next steps (in order)

1. ~~Acceptance runbook~~ done: [ACCEPTANCE.md](ACCEPTANCE.md).
2. **Installed Windows run** of current main using the CI installer. Every failure becomes a small fix PR.
3. **Live photo evaluation** with approved handwriting samples, plus the entity-classification fix.
4. **Physical iPhone + Tailscale run.**
5. **Clean-machine export/restore.**
6. **Owner decision:** delete or keep the legacy cloud code (`services/backend`, `apps/web`, `apps/mobile`, `packages/api-client|sync|contracts`).
7. After v1 acceptance: Speak, model-written Ask answers, and a fresh port of PR #26's Linked / Mentioned panel (mentions labelled as unverified hints).

## Open PRs

None besides this cleanup. PR #26 was closed 2026-10-15; its branch is kept for reference.
