# Approved Desktop Implementation Plan

**Goal:** Implement the owner-supplied desktop composition in the existing app.
**Spec:** docs/APPROVED-DESKTOP-2026-10-12.md
**Architecture:** Keep native IPC, provider consent and deterministic writer unchanged. Add a source-backed home composition, scoped CSS, and context-preserving inspection.

- [x] Add regression coverage for approved navigation, honest empty states and return context.
- [x] Implement editorial project board, calendar, follow-ups and capture bar using existing vault projections.
- [x] Match the supplied image with warm ivory/charcoal styles and responsive layout; honor reduced motion.
- [x] Verify desktop suite, lint, typecheck, build and browser screenshots at all three required sizes.
- [x] Independent review, repairs, documentation and draft implementation PR handoff.

Review focus: stale source responses, project candidates mistaken for verified identities, browser fixtures leaking into production, empty vault, narrow viewport keyboard access.

Reference handoff: image visible in chat; original attachment bytes are not exposed in this workspace. Do not substitute the earlier image. Exact PNG commit and installed Windows acceptance remain required.

Execution: native integration and exact PNG handoff remain open acceptance gates. Independent review repaired all identified code blockers. Implementation PR is a draft until exact-head CI and installed Windows acceptance pass.
