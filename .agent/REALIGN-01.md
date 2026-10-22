# REALIGN-01 — Automatic Obsidian organization and product realignment

Started UTC: 2026-10-09. Repository: C:/Users/nrsan/Nucleus/02_Projects/Recall.
Branch: implement/owner-device-pairing. Base: fa6390be3e9539b68040379e7e81a3a7bc90491d (clean tracked tree).

## Owner objective and authority

Owner explicitly authorized updating all repository documents, fixing drift, and cleanup after clarifying: users dump notes/photos/voice/files; Recall uses an LLM to understand and organize useful Obsidian memory without requiring Markdown, filing, tagging, or taxonomy knowledge. Capture, organization, and natural recall form one product. This authorizes local implementation and documentation, not provider spending, real-data migration/deletion, remote changes, merge, deployment, or installation.

## One opening Tribunal

Luna Simplifier, Terra Engineer, and Sol Architect inspected the base read-only. Consolidated decision: MODIFY AND PROCEED. Reuse existing validated extraction and journaled vault; do not rewrite storage or add infrastructure. Build automatic readable structured Obsidian notes from successful photo readings, preserve source evidence and human edits, simplify everyday UI. Do not claim semantic Ask, voice/files, phone transport, live quality or installed acceptance from this slice. Full product remains incomplete until the finish contract is met.

## Design and invariants

Versioned v4 Markdown renderer; v1-v3 renderer stays byte-compatible. New completed readings publish organized notes through existing journal/receipt transaction. Flat YAML properties are deterministic, quoted and source-derived, never arbitrary model paths. Include readable summary, source-local mentions, source-linked statements, suggested actions and uncertainty. Unreviewed is not verified. Human transcription correction suppresses stale machine semantics from current organization/search; history retains originals. Source links use deterministic existing targets. No name-based identity merge or invented cross-note relationship.

Existing notes/history are never rewritten on read. v4 writes fence older binaries and retain prior manifest bytes. Reconciliation uses the event's renderer and allows existing human annotation edits; managed-region edits conflict without overwriting. No automatic migration of real vaults. Consent scope remains the existing selected-photo contract.

## READY work / ownership

- Documentation: README.md, AGENTS.md, tracked Markdown under docs/apps/packages/services/tests/infra/scripts; classify historical evidence instead of falsifying it. Update active canonical contracts substantively, archive obsolete handoff directives, inventory all tracked docs. Do not alter historical measured outcomes.
- Native implementation: apps/desktop/src-tauri/src/{local_vault.rs,local_vault_tests.rs,reading.rs,reading_storage.rs} and a narrowly factored renderer module if useful, wired through existing module. No API/schema/provider/security/pairing changes.
- UI follow-up, independently READY (Sol approved unchanged DTO and disjoint ownership): apps/desktop/src/local/* and affected local-vault tests. Sparse capture/search/recent; maintenance in an accessible disclosure. Surface organized content without claiming generative Ask.
- Controller only: .agent state, packet, finish contract, audit/metrics/evidence artifacts.

## Acceptance and deterministic validation

Test automatic organization on successful reading, ordinary Obsidian properties/link syntax, hostile string escaping, no invented identity/confirmation, corrected text precedence, v1-v3 exact history reopening, version fence, journal retry/recovery, direct-edit preservation, renamed/missing/deleted/conflicted notes, structured keyword projection. Run cargo fmt/test/check where toolchain available; npm lint/typecheck/test, desktop/web production builds and affected Playwright journeys. Test fixtures synthetic only. Validate Markdown links and documentation inventory; git diff --check. Controller reruns final gates on frozen candidate and Sol independently reviews exact digest. Missing native/runtime gates remain explicit, not PASS.

## Risk, recovery and finish

High-risk durable renderer compatibility requires independent review. Two materially distinct repairs per failure, then return to canonical intent and escalate specialist if necessary. Keep clean base, archived state, exact changes and reproducible commands. No blind deletes: retain legacy source/auth paths until replacement parity; remove obsolete instructions from active guidance via archival links. Deliver completion/evidence, review, next graph direction and truthful remaining finish gates. No per-note organization approval chore.
