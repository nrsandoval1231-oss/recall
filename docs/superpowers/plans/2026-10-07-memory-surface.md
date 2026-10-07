# Canonical Memory Surface implementation plan

**Goal:** Deliver RCL-005A in the active browser pilot with evidence underneath, understanding above it, and reversible focus through depth.
**Spec:** `docs/UX-SPEC.md`, as approved in PR #7 (`b205d61`).
**Architecture:** DOM/CSS boards over existing authenticated API contracts. A bounded focus stack restores question, temporal state, and scroll/focus. Capture continues using workspace-scoped IndexedDB drafts and verified finalization. No backend architecture change.
**Execution:** Implement sequentially in this session under the user's supplied phase order and authorization.

## Constraints

- Immutable originals, per-click authorization, mandatory server hash verification, no eager source downloads.
- Historical results use `ask(question, {as_of})`; never populate historical focus with current entity or memory projections.
- Synthetic world only reachable via a Vite development gate; no persistence, live API, or production bundle.
- Preserve native clients and browser authentication/upload retry.
- Semantic DOM, visible keyboard focus, one primary mobile board, reduced-motion hierarchy.

## Tasks

1. Foundation: reusable glass/evidence/Ask primitives, ivory/charcoal tokens, purposeful motion, surface focus state. Add transition/race tests before or alongside implementation.
2. Journey: Home → Ask → cited memory → verified original → canonical entity → Back. Existing memory/entity contracts; no name guessing or forced identity links. Bound contextual boards/results and expose remaining support sequentially.
3. Time/correction: explicit historical Ask, current/history distinction, statement correction with affected scope, expected revision/idempotency, conflicts surfaced. Invalidate reconstructed answers after corrections rather than retaining stale claims.
4. Capture/mobile: integrate existing durable browser capture and retry; recent originals with honest states; narrow viewport stack and accessible controls. Native UI redesign remains a separate slice.
5. Fixture/hardening: clearly synthetic notebook/photo/document world with multiple dates, uncertainty and change. Exercise stale Ask/source reads, Back, correction, denied/bad-hash evidence, fixture isolation, unavailable/empty/long text states.
6. Verify/review: full existing JS suites, new UI behavior tests, lint/typecheck, production browser and desktop bundles, backend relevant suites where available. Render desktop/mobile and reduced motion; keyboard journey; inspect diff independently against UX spec, fix material findings. Record exact evidence and gaps in V1-STATUS and PR.

## Review focus

- Auth/workspace changes while Ask/source reads are pending: late results must disappear.
- Earlier dates: current identity and current claims must not leak into the past.
- Correction committed during Back: restore composition, invalidate stale answer/data.
- Hundreds of relationships or very long text: bounded visible context with sequential access, no truncated evidence.
- HEIC originals: preserve source identity; unsupported browser decoding must have a verified download fallback.
