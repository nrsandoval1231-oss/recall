# Recall — Meeting to Memory (RCL-INT-001)

Status: **canonical next implementation packet; NOT implemented or accepted.** Owner decision: 2026-10-11. This packet extends the merged local-first foundation and the latest warm-glass desktop design. PR #26 is deliberately isolated and must not be merged, rebased, copied, or used as authority for this packet.

## Outcome

A person drops messy, unorganized meeting notes into Recall without sorting, naming, tagging or formatting them. Recall durably preserves the original, Jev parses the source into evidence-linked structured candidates, Claude proposes useful organization, and deterministic code writes human-readable Markdown with native Obsidian YAML properties and wikilinks into the user-selected vault. The result is discoverable in the Recall Memory Surface and Obsidian, with original evidence one gesture away.

## First acceptance fixture (synthetic)

Raw meeting dump:

> Brad: maybe 5–10 MW? Utility delay unclear. Call Sarah about schedule. Need gens by Dec?? Prism doing electrical? Site access north? Ask operator about gas. No firm start date. Crossed-out: 8 MW confirmed.

This is intentionally uncertain, contradictory, incomplete and unorganized. Do not silently turn any question, crossed-out text or estimate into a confirmed fact. Keep source offsets/references for extracted claims.

## Required stages

1. **Capture:** Accept typed paste, photo(s) or a supported document; assign an idempotent capture ID; write original bytes and manifest before processing. Report Saved even when intelligence is offline; mark Pending interpretation.
2. **Jev:** Parse source into a bounded versioned schema with transcription, legibility, entities, raw claims, possible decisions, questions, follow-ups, dates, units, attribution, uncertainty and source references. If handwriting recognition is insufficient, evaluate a specialized visual transcription adapter rather than fabricating text. Do not call a Jev integration complete until a real supported runtime is exercised.
3. **Claude:** Given Jev output and a minimal authorized vault context, propose a title, stable folder, native YAML properties, wikilinks to confirmed existing entities, new note contents, and correction-safe updates. Avoid deep folder trees, unverified identity merges, invented due dates, and fabricated meeting decisions. External provider calls require consent and bounded configuration.
4. **Validator/writer:** Deterministically validate schema, citations, path allowlist, YAML serialization, wikilink targets, version/revision, idempotency and conflict rules. Write atomically, preserve original sources and append-only history; never silently overwrite user edits. Models do not directly write filesystem paths.
5. **Retrieval/UI:** Render real vault data in the canonical warm-glass Memory Surface, with explicit Saved / Parsing / Organizing / Needs review / Ready / Failed states. Provide an Open in Obsidian action and a vague-question answer with source evidence; keyword-only fallback must be labeled accurately.

## Example Obsidian output (illustrative, not generated from a live model)

```markdown
---
type: meeting
project: "[[Permian Power Expansion]]"
status: needs-review
tags: [meeting, temporary-power]
source_id: synthetic-meeting-001
---
# Permian Power Expansion — Site Meeting

## Observations
- Possible power requirement: **5–10 MW?** (unconfirmed)
- Utility delivery timing: unclear
- Generator need by December: question, not committed date

## People and organizations
- Brad (identity unresolved)
- Sarah (identity unresolved)
- Prism (role unconfirmed)

## Follow-ups
- [ ] Ask Sarah about schedule
- [ ] Confirm site access and gas availability with operator
- [ ] Verify electrical contractor and power requirement

## Evidence
- Original: [[synthetic-meeting-001]]
- Crossed-out “8 MW confirmed” is not an accepted fact
```

## Acceptance gates

- Capture survives restart and provider outage without data loss; identical retry creates no duplicate.
- Real Jev output and real Claude proposal captured for a consented or synthetic evaluation corpus; exact models/config, costs and revisions recorded.
- The uncertain 5–10 MW, December timing, Prism role, and crossed-out 8 MW are not promoted to confirmed facts.
- Markdown parses in Obsidian; YAML properties, backlinks, links and source attachments resolve. Existing user edits and corrections survive reprocessing.
- Vague recall produces a supported answer with the right original; unsupported queries abstain.
- Run the complete loop in an installed Windows build and separately test iPhone/Tailscale capture and denied peers. Do not claim device acceptance from mocks.

## Boundaries

No PostgreSQL requirement, hosted backend, autonomous agent swarm, graph database, speculative sync, or UI rewrite. SQLite is permitted only for rebuildable indexes and local operational state. Preserve the current native vault writer. UI implementation must follow the one canonical visual direction in UX-SPEC; do not fabricate fixture people, events, or statuses as real memories.

## Sequencing

First commit and verify the approved UI image asset; then implement the smallest real end-to-end note transformation; then bind the Memory Surface to actual vault data; then complete installed Windows and iPhone pilot gates. Maintain a per-commit acceptance ledger. Do not expand to broad document/voice integrations until this slice is trustworthy.
