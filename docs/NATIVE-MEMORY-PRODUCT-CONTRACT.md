# Recall — Native Memory Product Contract
**Approved product direction · 2026-10-13 · normative for all new work**

## North star
**Recall is a private, local-first external memory. Capture anything, recover the information and context, verify its evidence, and keep your knowledge in a form you own.** The user can create, edit, retrieve, inspect, organize, correct, export and restore memories **entirely inside Recall without installing or opening Obsidian**. Obsidian is supported as an optional import, export and interoperability target—not a required runtime, storage engine or user workflow.

**Your life remembers itself.** The user never has to file, tag, name or connect a capture to make it useful. Manual organization remains available, not mandatory. Optimize for recovering a vague recollection six months later with traceable sources rather than recreating every Obsidian plugin.

## Authority and compatibility
1. This contract supersedes older *product-intent* claims that Obsidian is required, that users must "open in Obsidian", or that a particular Obsidian application installation is the memory authority.
2. [Adaptive Memory Surface PRD](ADAPTIVE-MEMORY-SURFACE-PRD.md) and its **original committed** four-panel photo-free ivory graph reference are the visual authority. Preserve the central **Camera / Speak / Write** bubbles and adaptive right inspector. Older warm-glass dashboards and reference photos are historical, not competing visual directions.
3. The **existing local-first Tauri desktop + paired phone Capture/Ask experience** remains the implementation baseline. A user-owned Markdown-plus-originals library/vault remains durable and portable. **No approved database rewrite, PostgreSQL authority switch, Obsidian data migration, new login, cloud dependence, PR #26 merge, or refactor solely for this decision.**
4. Existing implementation evidence and acceptance results are historical facts and must not be rewritten as if new behavior is shipped. References to the *current* Obsidian-backed pilot describe existing code, **not the intended end-state**. Preserve relevant tests, PR history and artifacts.
5. Graphiti is an optional **derived** intelligence/indexing capability, never the authoritative source of user corrections, originals or immutable history, and never a required dependency for opening notes or rendering a basic evidence-backed graph.

## Product experience: one adaptive surface
- **Capture** — camera/photo, real microphone flow (or honestly unavailable), and a fast native writing editor. Persist originals/drafts and a durable receipt *before* AI. Require no titles, folders or tags.
- **Inspect / Edit** — a first-class editor with legible formatting, links, attachments, autosave, source inspection and revision recovery. Explicitly distinguish user-authored text from AI interpretations. AI never silently rewrites authored material.
- **Ask** — natural-language, imperfect-recollection questions; grounded concise answers with links to original evidence, dates, relevant people/projects and transparent conflicts. Abstain or offer likely matches where evidence is insufficient. Keyword fallback is labeled honestly.
- **Explore** — graph background and optional focused graph exploration; contextual people, projects, topics and timeline within the same surface. Graph edges are real and explainable, sourced from eligible vault records. No fabricated data or decorative pseudo-facts. User can work without touching graph navigation.
- **Correct** — correct identity, facts, links and categorization in human language; preserve original, correction scope and audit history. Corrections survive reprocessing; do not cascade across unrelated names or sources.

## Memory model and trust
Separate (A) **original evidence/user-authored note and versions**, (B) **proposed/accepted interpretation including source-span references, temporal validity and uncertainty**, and (C) **rebuildable views/indexes** such as embeddings, derived graph, layouts and search. Multiple views must refer to the same canonical memories, not duplicate inconsistent copies. Distinguish when an event applied from when Recall learned it. Never imply newer means truer. Use meaningful evidence states—source-stated, user-confirmed, inferred, disputed—rather than unsupported numerical confidence.

Jev structured parsing → Claude librarian *proposals* → deterministic validation/writing remains the established intended processing path, consent-gated. Models never directly write arbitrary files, choose permissions, merge identities without guardrails or modify originals. If providers fail, local saving, editing, source access, browsing and text search remain functional and interpretation is honestly pending. Native Recall—not Obsidian UI—owns the complete authoring and inspection experience.

## Local-first reliability and autonomy
- Desktop offline: write, read, edit, search and inspect without AI providers. Preserve data across restart; respect edits made by other applications; resolve version conflicts without silent overwrite.
- Phone: save locally even if desktop is off; report accurately **saved on this device / received by library / organized**; retry with deduplication. Do not promise live cross-device retrieval without an available synced copy or service. Keep pairing/Tailscale authorization and network restrictions; **no login UX** does not mean public access.
- Complete library export/import and independently tested restore should preserve originals, Markdown content, stable IDs, links, supported metadata, corrections and meaningful history. Backup is separate from sync. Owner deletion policies govern live content, derived indexes and retention; "immutable original" means unmodified by AI, not undeletable by owner.
- Portable library remains the authority; SQLite may index/cache/outbox but must not silently become a competing canonical store. Legacy cloud stack stays historical/optional until separately designed and approved.

## Native Obsidian independence
Obsidian integration is **optional interoperability**. Existing Obsidian vaults may be opened/imported non-destructively, retaining directories, Markdown properties, wikilinks, source attachments and user edits. New users create a Recall library. Avoid an Obsidian installation requirement, Obsidian-specific user vocabulary in primary UX, Obsidian-only file dialogs, "Open in Obsidian" as the only inspection method, or AI-generated folder bureaucracy. Keep export usable in standard tools without application lock-in.

## Delivery order and hard acceptance
1. **Native library ownership**: create/open Recall library, durable Capture, built-in readable/writable editor, native source inspector; existing Markdown files round-trip without loss and external edits are safe. No Obsidian runtime needed.
2. **Evidence-backed memory loop**: Jev/Claude with real authorization and honest pending states; corrections, immutable source preservation, source-quoted Ask, revisions and restart survival. Do not mistake synthetic or keyword matching for live acceptance.
3. **Adaptive graph and temporal exploration**: wire the existing approved ivory four-panel UI to real, reconstructible, provenance-backed nodes/links; keyboard and accessible pointer controls; no synthetic production nodes.
4. **Independence and portability**: phone offline/online recovery, conflict handling, full export/import, backup/restore, security/device acceptance. Record installed Windows and real iPhone evidence separately from simulation.

Definition of done: a person can capture messy material, edit it, ask a vague question, inspect why Recall answered, correct a mistake, navigate connections/history, and export/restore **without installing or opening Obsidian**. Confirm on installed Windows and physical iPhone where applicable, against an exact commit, with failures and unverified gates recorded in [ACCEPTANCE](ACCEPTANCE.md). Nothing in this document claims these gates are complete today.

## Exclusions
No replatforming, new autonomous agent framework, forced Graphiti, forced cloud account, generic CRM/project manager, new dashboard/card-grid, fake voice flow, decorative graph, plugin marketplace, full Canvas clone, or obsolete PR merges as incidental scope.

## Document reconciliation
Use this contract whenever older README, PRD, Pilot Contract, Canonical Foundation, Architecture, Roadmap, UX-SPEC, Meeting-to-Memory or builder handoff text contradicts the product end-state. Preserve dated historical implementation evidence but **do not issue builder instructions to extend Obsidian as the required user interface**. Any future storage migration or service architecture needs a separate reviewed design and recovery plan.
