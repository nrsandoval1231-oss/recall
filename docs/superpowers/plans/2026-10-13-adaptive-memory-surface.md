# Adaptive Memory Surface Implementation Plan

**Goal:** Implement PR #51 in the existing Tauri shell against the exact approved four-panel PNG.
**Architecture:** Retain native vault, Jev, Claude and deterministic writer. Replace dashboard presentation with a mounted read-only graph, circular capture actions and contextual inspector. No new persistence authority.
**Spec:** PR #51's ADAPTIVE-MEMORY-SURFACE-PRD, SCREENS and BUILDER documents.
**Execution:** Autonomous implementation and independent review, explicitly requested by owner.

- [ ] Test empty UI honesty and graph derivation, including conflicts, deleted sources, unresolved mentions, deterministic layout and explicit links.
- [ ] Implement derived graph and pointer/keyboard/list navigation; preserve viewport through inspection.
- [ ] Replace dashboard shell and connect existing capture, processing, evidence, Ask, correction, history, timeline and settings handlers.
- [ ] Verify native and frontend suites; adapt superseded dashboard assertions to canonical behavior while preserving safety regression coverage.
- [ ] Capture empty/populated/processing/inspection/graph screenshots at required sizes and compare with unchanged approved PNG.
- [ ] Independent review, repairs, exact-head verification and implementation PR with truthful capability boundaries.

Review focus: empty/no-native mode must not show fictional memories; tentative mentions must never merge identities; vault switching must clear stale evidence; failed saves retain drafts; graph navigation must not mutate notes.
