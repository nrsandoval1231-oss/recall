# G3 canonical UI handoff

Status: implementation ready for integrated review; no commit created by this worker.

Worktree: `C:\Users\nrsan\.codex\worktrees\recall-graphiti\Recall`, branch `integrate/graphiti`. HEAD observed during handoff: `adf253c9b107a1f785b4d2818a11a8ff253ea750`. This checkout also contains other workers' in-progress native and backend changes; this handoff covers only the UI files below. Re-run gates on the combined frozen candidate.

## Delivered

- Added typed adapters for the frozen native knowledge status, consent, search, dismissal and rebuild commands. DTO property names follow the serialized Rust response.
- Settings displays the configured extraction, embedding and reranking providers and native service message. Graph processing remains disabled until the user checks the purpose-consent box and explicitly enables it. Existing notes have a separate unchecked opt-in. Missing providers keep the enable action disabled. Disabling is explicit and leaves keyword Ask available.
- Ask displays native inferred relationships alongside source-backed note hits. Related retrieves bounded current relationships. Source inspection loads relationships whose primary or support source ID matches the inspected memory. The existing timeline adds relationships with inferred temporal bounds.
- The relationship view displays subject → predicate → object with readable predicate names (for example, `WORKS_ON` as “Works on”). It filters by relationship type, entity type and current/superseded state. Selecting an endpoint focuses its native UUID; neighbor expansion follows only connected edges from the already returned, at-most-50 relationship set. A semantic list provides the accessible alternative.
- Selected relationships expose every supporting quote with its source name and revision, plus the existing original-inspection and note-correction actions. Dismissal is persisted natively before local hiding; a failed persistence leaves the fact visible. Valid-time values are labeled as inferred dates rather than current truth.
- Vault changes and navigation invalidate in-flight relationship work. Panels are keyed to vault identity and dismissal completion checks the active vault before changing shared UI state.

Files owned by this packet:

- `apps/desktop/src/platform/local-vault.ts`
- `apps/desktop/src/platform/local-vault.test.ts`
- `apps/desktop/src/surface/MemorySurface.tsx`
- `apps/desktop/src/surface/memory-surface.css`
- `apps/desktop/src/surface/memory-surface.test.tsx`
- `apps/desktop/src/surface/KnowledgePanel.tsx`
- `apps/desktop/src/surface/KnowledgePanel.test.tsx`

## Validation

Commands run from the repository root unless noted:

- `npm run typecheck --workspace @recall/desktop` — PASS, exit 0.
- `npm run test --workspace @recall/desktop -- --reporter=dot` — PASS, 13 files / 104 tests, exit 0.
- `npx eslint src/platform/local-vault.ts src/platform/local-vault.test.ts src/surface/MemorySurface.tsx src/surface/KnowledgePanel.tsx src/surface/KnowledgePanel.test.tsx src/surface/memory-surface.test.tsx` from `apps/desktop` — PASS, exit 0.
- `git diff --check -- <seven owned files>` — PASS, exit 0.

Intermediate focused tests caught and resolved assertion mismatches around the selected fact and multiple supporting-note actions. The complete suite passed on the final G3 repair. No private captures, production provider calls, deployment or PR actions were used for this UI work. Native-installed runtime, live Graphiti extraction/retrieval, combined-candidate gates, and independent review remain outside this worker's evidence and acceptance remains open.
