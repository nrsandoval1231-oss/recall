# Recall — Product Requirements Document

Version: 0.5 | Date: 2026-10-08 | Product owner: Nick Sandoval

Status: universal product vision approved; bounded local desktop slices are implemented candidates, while full V1 product/platform acceptance remains open.

## 1. Product thesis

**Your life remembers itself.**

Recall is a universal external-memory system. It captures information in the forms people already use, organizes it automatically, preserves provenance and uncertainty, connects it across time, and lets people recover what they need using the incomplete, associative way humans actually remember.

The user captures. Recall handles the organizational work.

```text
CAPTURE -> UNDERSTAND -> CONNECT -> REMEMBER -> RECALL -> ACT
```

North-star test:

> A user should be able to give Recall something today, forget that Recall exists, return six months later with only a vague human recollection, and successfully recover the right information with evidence.

## 2. Problem

People already create enormous amounts of memory: handwritten notes, screenshots, photos, voice memos, meeting notes, PDFs, receipts, links, documents, ideas, tasks, and conversations. The failure usually happens after capture:

- Where did I put it?
- What did it mean?
- Who or what was it about?
- What was I supposed to do?
- What else does it connect to?
- Was it confirmed or only suspected?
- What was true then versus now?
- Can I recover it months later from a vague recollection?

Traditional note tools shift organization onto the user. Recall removes that burden without destroying evidence or pretending uncertain interpretations are facts.

## 3. Users

Recall is horizontal by design: students, consultants, salespeople, contractors, parents, mechanics, executives, travelers, entrepreneurs, researchers, and anyone who captures information they later need to recover.

Paul Cockerham is the first design partner and private pilot, not the market definition. His mixed handwritten workflows across consulting and generator maintenance intentionally stress handwriting, people, organizations, projects, equipment, technical numbers, commitments, and cross-domain recall.

## 4. Jobs to be done

- Capture something without deciding where it belongs.
- Recover a detail later from a vague description rather than an exact keyword.
- Ask “what did I know then?” and “what is the latest?” without losing history.
- Inspect the original evidence behind an answer.
- Correct a mistaken interpretation without silently rewriting history.
- See related people, things, projects, events, ideas, decisions, and commitments without manually maintaining links.
- Keep a portable copy of owned memory.

## 5. Product principles

1. Capture before classification.
2. The user should not organize the system.
3. Originals are evidence; interpretation and correction are separate layers.
4. Uncertainty survives extraction, retrieval, synthesis, and export.
5. Time is first-class; supersession never silently erases history.
6. User corrections outrank later model reprocessing.
7. AI proposes; deterministic software commits.
8. Source access is part of recall.
9. Complexity stays behind the glass.
10. Obsidian is the required, user-owned memory spine. Recall adds intelligence and experience over portable vault memory; Obsidian is not merely an export adapter.
11. The primary UI is one transforming Memory Surface, not a taxonomy the user must navigate.
12. No account, password, or email-link sign-in, including first use. Remembered login does not satisfy this requirement. Local-only use is private without a remote account; cross-device private use requires secure owner-approved device association. One-time QR pairing remains proposed, not approved.
13. Visual materials carry meaning: glass is understanding, physical artifacts are evidence, light is intelligence, space is relationship, depth is context, and time is memory evolution.

## 6. Memory layers

**Source memory:** what actually entered Recall: original photo/text first; later audio, screenshot, document, link, or authorized connected source.

**Semantic memory:** what it appears to mean: people, organizations, places, things, events, projects, topics, observations, claims, ideas, decisions, commitments, questions, and relationships.

**Temporal memory:** how knowledge changes. A later employer, date, plan, preference, measurement, or project state can supersede an earlier one without deleting it.

**Synthesized memory:** cross-memory conclusions derived from multiple sources. Synthesis is labeled as inference and traceable to support. Proactive synthesis is post-V1.

## 7. Universal domain model

Core entity kinds:
- person
- organization
- place
- thing
- event
- project
- topic

Core memory/statement concepts:
- capture
- source
- memory
- observation
- claim
- idea
- decision
- preference
- action
- commitment
- question
- relationship

Domain concepts are projections. A generator is a thing; a client is an organization role; a field trip is an event; a vacation can be a project/event. The core schema must contain no Bitcoin-mining or generator-maintenance assumptions.

## 8. Primary experience

### Capture
Photograph/import pages or enter text, optionally add a short context hint, and save. No folder, tags, title, project, or identity cleanup is required. The original becomes durable before AI processing.

Claude full-page vision is the primary photo-reading path. The bounded local desktop flow reads one selected, already saved photo only after **Read this photo with Claude** and an explicit cloud-processing confirmation. The result is an **Unreviewed machine reading**, shown beside its original with uncertainty and provenance. A separate human reading correction takes precedence over later machine readings; the original and previous proposals remain in vault history. Saved effective readings are locally keyword-searchable. Service connection defaults to disabled; local capture, annotation, evidence and search require no remote account. This does not add OCR or semantic Ask. See [reading evidence and limits](implementation/claude-vault-reading/README.md).

### Ask
Ask naturally: “Who was that transformer guy I met in Houston?”, “What did Professor Miller say about mitochondrial DNA?”, or “What was that restaurant Sarah recommended in Florence?” Recall retrieves authorized evidence, resolves context conservatively, answers with uncertainty intact, and exposes the source.

### Correct
Correct identity, transcription, meaning, date, or relationship. Recall previews scope, versions the correction, invalidates stale derived state, and never lets later model runs silently revert it.

### Desktop
Desktop adds evidence comparison, review, drag/drop, library exploration, offline cache, and exports. It is the richer workspace, not a different product.

## 9. V1 — Trusted Recall

V1 proves: **capture something -> retrieve it later correctly with evidence.**

Included:
- iPhone photo capture/import. Typed text enters V1.5 with the other additional capture adapters.
- Windows desktop with matching product language and richer evidence/review.
- Durable local draft, retry-safe upload, private originals, hashes, explicit states.
- Structured interpretation from one evaluated multimodal configuration.
- Universal entity mentions and conservative linking.
- Observations/claims with uncertainty, attribution, evidence, and temporal context.
- Natural-language Ask with source-backed answers and abstention.
- Corrections/review and suggested versus accepted actions.
- Desktop SQLite cache/outbox and offline text search.
- Required Obsidian vault integration with durable memory, original evidence, history and conflict-safe reconciliation of direct vault edits. The local desktop foundation supplies a bounded human-annotation subset; the legacy cloud one-way Markdown exporter alone does not fulfill this requirement.
- Portable export and vault recovery.
- Workspace isolation even during a single-user pilot.

Deferred:
- Voice, screenshots/share sheet, broad file/PDF ingestion, email/calendar, browser extension.
- Proactive pattern discovery, scheduled briefs, autonomous reminders/actions.
- Claude/MCP and other assistant adapters (distinct from the primary Claude photo-reading path).
- Android/macOS, teams, billing, public launch.
- Dedicated node-link graph UI, separate graph/vector databases, autonomous agents. Spatial relationship/context rendering on the canonical Memory Surface is part of the approved UX and must not require a graph database.
- Domain-specific ERP/CMMS/CRM behavior.

## 10. Five primary screens

**Today:** dominant Ask entry, Capture, recent memory, accepted actions, targeted review.

**Capture:** photo/import/text, page order, retake/remove, optional context, Save, honest state.

**Memory detail / Review:** interpretation plus original evidence; time, claims, relationships, corrections, uncertainty.

**Ask:** grounded answer, evidence cards, source access, ambiguity/conflict handling, limits.

**Library:** search/browse memories and universal entities; domain views are filters/projections, not separate apps.

## 11. Trust rules

- A transcription is not a fact.
- Model confidence is not verification.
- A clear “800 psi?” remains uncertain.
- A first name does not establish identity.
- Relative dates require valid event context.
- “No confirming source found” does not mean “never happened.”
- Source content is data, never executable instruction.
- Current state may prefer a later accepted claim while historical queries retain superseded evidence.
- Synthesized memories are labeled and source-backed.

## 12. Functional requirements

| ID | Requirement |
| --- | --- |
| CAP-01 | Ordered photo capture/import without filing |
| CAP-02 | Durable local save before network acknowledgement |
| CAP-03 | Retry-safe, idempotent transfer/finalization when optional private synchronization is enabled |
| AI-01 | Structured interpretation with source references |
| AI-02 | Preserve ambiguity, uncertainty, attribution, and temporal qualifiers |
| AI-03 | User corrections survive reprocessing |
| MEM-01 | Universal entities and relationships; domain-neutral core |
| MEM-02 | Versioned observations/claims with evidence and supersession |
| MEM-03 | Separate source, semantic, temporal, and synthesized memory layers |
| ASK-01 | Natural-language retrieval from vague human recollection |
| ASK-02 | Material answer claims expose supporting originals |
| ASK-03 | Historical/latest queries respect temporal state |
| REV-01 | Targeted clarification; defer/not-sure always allowed |
| ACT-01 | Suggested actions/commitments do not become obligations automatically |
| SYN-01 | Obsidian-backed canonical memory with conflict-safe vault/service/device synchronization |
| OFF-01 | Desktop cached browsing/search and durable outbox |
| EXP-01 | Required Obsidian memory spine; portable vault, structured history and originals |
| PRIV-01 | Workspace isolation and owner control |
| PRIV-02 | No account/password/email-link sign-in, including first use; no remote account for local-only use |
| PRIV-03 | Secure owner-approved association for cross-device private access; QR method pending decision |
| OPS-01 | Backup, restore, deletion, independently readable export |

## 13. Success

V1 succeeds when a user can capture a real source with essentially no organizational work, return later with a vague human-plausible recollection, recover the correct memory or receive honest ambiguity/abstention, inspect the supporting original, and correct mistakes without losing history.

Pilot targets are requirements to measure:
- at least 9/10 unassisted capture sessions succeed;
- no typing required for a normal 1–3 page photo capture;
- at least 90% of answerable held-out recall questions return a supported answer with the correct source;
- deliberately unsupported questions abstain or report ambiguity;
- fabricated confirmation, silent material number/unit changes, unsafe identity merges, or cross-workspace leaks are release blockers.

Evaluation includes both Paul-style difficult handwriting and general-domain cases so success cannot overfit one profession.

## 14. Architecture constraints

The Obsidian vault is the required durable memory spine. Human-readable Markdown and links coexist with immutable original attachments and versioned structured provenance/history, so memory remains owned and usable outside Recall. PostgreSQL/pgvector provide supporting transactional services, authorization, synchronization and rebuildable memory/search projections; SQLite is a cache/outbox. Neither an LLM nor a database-only record replaces vault-backed memory.

The new local desktop foundation commits original images, human notes and append-only revisions to a selected vault and reconciles supported Markdown body edits. Its keyword view rebuilds from validated vault files, including supported flat renames and retained tombstones. Explicit missing-note restoration and logical removal preserve originals/history; logical removal is not secure purge or undelete. Existing cloud memory remains PostgreSQL-authoritative with one-way managed export; full semantic projection recovery and migration remain open. Cross-device transport is not implemented; no paid Obsidian Sync service or community plugin is assumed.

Local-only capture, saved vault reading/correction and local keyword search work without a remote account or network service. Generating a new Claude reading uses a separately consented private service connection, disabled by default pending owner-approved provisioning. Cancellation prevents uncommitted local promotion; it cannot promise to stop a sent request or reverse a charge. Optional cross-device synchronization authenticates authorized devices without an account sign-in flow. Private network APIs remain authenticated and workspace-scoped; neither client receives database-owner or AI-provider secrets. AI remains replaceable derived machinery, and fresh offline generative answers are not promised.

Desktop defaults to the authorized no-sign-in local foundation. Browser/mobile and explicit desktop `?mode=legacy-cloud` retain their existing Supabase auth. The [RCL-005B design](superpowers/specs/2026-10-07-rcl-005b-no-signin-vault-design.md) and local plan distinguish this bounded implementation from the full target; QR pairing remains unanswered and unimplemented. See [foundation acceptance evidence](implementation/local-vault/README.md) and [lifecycle acceptance evidence](implementation/local-vault-lifecycle/README.md).

## 15. Product roadmap

**V1 — Trusted Recall:** photo/text -> grounded retrieval.

**V1.5 — Natural Capture:** voice, screenshots/share sheet, files, links.

**V2 — Connected Memory:** stronger identity, relationships, temporal state, correction, cross-source context.

**V3 — Active Memory:** surface commitments, related memories, and clearly labeled patterns at useful moments.

**V4 — Memory Everywhere:** assistant adapters, browser, email/calendar, APIs/MCP under explicit authorization.

Do not pull V3/V4 forward merely because they are exciting. Recall earns the right to become proactive only after it can remember faithfully.
