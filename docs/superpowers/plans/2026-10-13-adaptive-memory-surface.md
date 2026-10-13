# Adaptive Memory Surface Implementation Plan

**Goal:** Implement PR #51 in the existing Tauri shell against the exact approved four-panel PNG.
**Architecture:** Retain native vault, Jev, Claude and deterministic writer. Replace dashboard presentation with a mounted read-only graph, circular capture actions and contextual inspector. No new persistence authority.
**Spec:** PR #51's ADAPTIVE-MEMORY-SURFACE-PRD, SCREENS and BUILDER documents.
**Execution:** Autonomous implementation and independent review, explicitly requested by owner.

- [x] Test empty UI honesty and graph derivation, including conflicts, deleted sources, unresolved mentions, deterministic layout and explicit links.
- [x] Implement derived graph and pointer/keyboard/list navigation; preserve viewport through inspection.
- [x] Replace dashboard shell and connect existing capture, processing, evidence, Ask, correction, history, timeline and settings handlers.
- [x] Verify native and frontend suites; adapt superseded dashboard assertions to canonical behavior while preserving safety regression coverage.
- [x] Capture empty/populated/processing/inspection/graph screenshots at required sizes and compare with unchanged approved PNG.
- [x] Independent review, repairs, exact-head verification and implementation PR with truthful capability boundaries.

Review focus: empty/no-native mode must not show fictional memories; tentative mentions must never merge identities; vault switching must clear stale evidence; failed saves retain drafts; graph navigation must not mutate notes.

Implementation and independent review completed. Native test/build execution is delegated to PR #52 CI because this local executor has neither Rust/WebKit nor package-install permissions. Installed Windows/live-provider/phone acceptance remains explicitly open in the evidence report.
