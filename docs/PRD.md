# MONOLITH — Product Requirements Document

**Version:** 1.0 · **Updated:** 2026-10-28 · **Status:** Canonical product requirements, proposed for review  
**Product:** MONOLITH — *Your world. Connected.*

## Authority and change control

This PRD records the current intended product, not proof of shipped functionality. [VISION.md](VISION.md) is authoritative for product scope and trust; [DESIGN.md](DESIGN.md) and [brand guide](../branding/monolith/v1/BRAND_GUIDE.md) govern visuals; [ARCHITECTURE.md](ARCHITECTURE.md) documents the actual system; [STATUS.md](STATUS.md) tracks verified implementation, gaps and release gates. When documents conflict, do not silently change product direction: reconcile them through a reviewed PR.

The 2026-10-09 PRD on the divergent `implement/owner-device-pairing` line was superseded by decisions recorded on main on 2026-10-17. In particular, **Obsidian is not required or integrated**, and **authenticated cloud access is approved**. Local use remains independently usable without sign-in. A distinct PR #71 renames that divergent line; neither that PR nor its test claims establish integration into main.

## 1. Product thesis

MONOLITH is a private, local-first external memory. Capture messy real-world information once, without filing or taxonomy; retrieve it months later from an incomplete human recollection, with the exact original and revisions proving the answer. The product should do the organizational work, not the user.

**North-star test:** Capture a handwritten note today. Six months later, ask “what was going on with that utility delay?” and recover the correct memory with a source quote, or an honest uncertainty/abstention.

**Experience:** Capture → Understand → Connect → Remember → Ask → Evidence → Correct.

## 2. Users and jobs

Primary user: someone who works through meetings, field visits, calls and ideas, writes or photographs incomplete notes, and wants dependable retrieval without maintaining folders and tags. The data model must remain domain-neutral, suitable for personal, technical and commercial material.

Jobs:
1. Save a note, handwritten page or supported attachment immediately, including offline.
2. Find it from vague language, dates, people, projects or related concepts.
3. Separate facts from guesses, questions and crossed-out statements.
4. Inspect the original, provenance and what MONOLITH inferred.
5. Correct a mistaken interpretation and preserve that correction through subsequent processing.
6. Understand relationships and changes over time without manually building a graph.
7. Use memory on desktop and phone while maintaining ownership, privacy and recoverability.

## 3. Product experience

**Windows desktop — Memory Surface.** One adaptive MONOLITH experience with immediately available Camera / Write, Ask, source inspection, editing, correction, history and meaningful connections. Speak remains staged and unavailable until real-device acceptance. Use the approved smoky-glass monochrome brand with Sora/Inter. Do not substitute an unrelated dashboard, visual noise, fabricated graph nodes or obsolete Recall/MeGraph boards.

**Phone and web.** An authenticated browser/PWA cloud library can capture and ask while the desktop is off. Retain the private Tailscale companion where useful. Cloud and local libraries must not pretend to be synchronized where parity is incomplete.

**Capture modes.** Type/write and photos are the verified development focus. Speak means real recording and transcribed, source-linked playback only after device acceptance; before that, mark it unavailable. Broader files, secondary attachments and share-sheet capture are staged capabilities, not assumed complete.

**Ask and Explore.** Answers must cite eligible source evidence and preserve uncertainty. Keyword-only retrieval must be labeled. Graphs and timelines use real links, dates and source-derived relationships, not name-only identity guesses.

## 4. Canonical data model

Keep three strictly separated layers:
- **Sources and authored history:** original bytes, user's text, metadata and append-only revisions.
- **Evidence-linked interpretations:** candidate people, organizations, places, things, events, projects, claims, decisions, questions, commitments and relationships, with uncertainty and time validity.
- **Derived views:** indexes, embeddings, graph layouts and optional Graphiti; all rebuildable and never the authority.

An event's date is different from the date MONOLITH learned about it. Later evidence may supersede but must not erase historical state. Human corrections outrank automated reinterpretation.

**Portable ownership:** Native libraries are normal user-owned directories with original files, Markdown and history. No Obsidian application, plugin, account or sync subscription is needed. Historical `Recall/` paths, formats and other technical identifiers remain valid for existing data; do not rewrite immutable history merely for naming consistency.

**Cloud:** PostgreSQL is authoritative for authenticated synchronized cloud records. Desktop's native library remains independently functional. Import/migration is opt-in, backed up, additive and revision-safe. No silent conflict resolution, lossy conversion of native Markdown to synthetic image captures or deletion of originals.

## 5. Intelligence and trust

The pipeline is **Jev → Claude → deterministic validator/writer**. Jev extracts evidence-linked candidates; Claude proposes organization and connections; trusted deterministic code validates citations, permissions, paths, schema, revisions, consent and budgets before any write. Models do not directly mutate files or choose permission grants.

Non-negotiable rules:
- Save original bytes and a durable receipt before AI processing.
- Preserve question marks, ranges, crossed-out text, attribution and illegibility. Never silently turn a guess into a verified fact.
- Keep machine proposals separate from human text and never undo a user correction.
- Every material retrieval claim references eligible original evidence; otherwise abstain.
- Every write is idempotent, atomic and revision-conditional; external edits and cloud conflicts surface for review.
- Explicit, revocable source authorization and per-device default-off automatic processing of *future* captures; no silent backlog enrollment or uncertain-provider-request replay.
- Budget limits and honest saved/pending/processing/failed/uncertain states.
- Provider keys stay out of the webview; local desktop credentials stay in the OS credential store.
- No default location tracking, inbox scraping, public sharing, autonomous external action or invented personal insights.

## 6. Functional requirements

| ID | Requirement | Release expectation |
| --- | --- | --- |
| CAP-01 | Offline-safe typed and photo capture; save originals before processing | V1 |
| CAP-02 | Consented, honest capture enrichment; retries fenced by durable receipts | V1 |
| VOI-01 | Genuine recording, transcription, corrections and evidence-linked playback | Staged, real-device gate |
| LIB-01 | User-owned original/Markdown/history library without Obsidian | V1 |
| LIB-02 | External edits, corrections, conflict review and append-only revisions | V1 |
| AI-01 | Jev/Claude proposal plus deterministic trusted writer | V1 |
| AI-02 | Evidence spans, uncertainty, identity restraint and temporal attribution | V1 |
| ASK-01 | Vague natural-language retrieval with citations/abstention | V1 |
| ASK-02 | Honest offline keyword mode; historical/latest interpretation | V1 core; quality evaluated |
| REL-01 | Explainable relationship graph, no fabricated links | V1 |
| CLOUD-01 | Authenticated PWA usable with Windows desktop off | V1 |
| CLOUD-02 | Opt-in, safe cloud migration, revision-conditional synchronization and deletion tombstones | V1 |
| CLOUD-03 | Conflict review, incremental sync, secondary attachments and export parity | Release gaps; stage and verify |
| SEC-01 | Revocable cloud enrollment, HttpOnly same-origin sessions, workspace isolation | V1 |
| SEC-02 | No sign-in required for independent local mode | V1 |
| PORT-01 | Complete hash-verified backup, portable export and clean-machine restore | V1 |
| QA-01 | End-to-end real Windows/iPhone, provider and recovery acceptance on one exact commit | Mandatory to call V1 done |

## 7. Release and acceptance

Do not call MONOLITH production-ready based solely on local unit tests, synthetic Playwright tests, screenshots, a built-but-uninstalled installer, or an unmerged PR.

**V1 acceptance requires** an installed Windows build and physical iPhone against one exact commit: create a library without another app; capture typed and handwritten source originals; run authorized organization; retrieve a vague question with eligible quote; inspect and correct; preserve edits through restart/reprocessing; inspect graph/history; capture by phone with PC off and synchronize without duplication; complete verified backup/restore on a clean machine. Test real credential storage, keyboard/accessibility, cloud HTTP/auth, offline behavior, conflicts and failure/recovery paths.

Pilot performance targets (to measure, not current achievements): ≥9/10 unassisted captures succeed; ≥90% of answerable held-out recall questions return the correct supporting source; unsupported questions abstain. Fabricated confirmation, material unit/number changes, unsafe identity merges, data loss and workspace leaks are blockers.

**Actual progress:** Refer to [STATUS.md](STATUS.md); its latest detailed evidence is dated 2026-10-21. PR #69 proposes cloud conflict-review repairs but is not merged. PR #70 was closed unmerged and carries a divergent local-first/voice candidate. PR #71 is open against that divergent branch, not main. These are candidate changes, not shipped capability. Update STATUS with fresh evidence rather than copying unverified test totals into this PRD.

## 8. Delivery priorities

1. **Converge the architecture:** preserve the no-Obsidian, approved cloud/local product authority on `main`; inspect divergent voice/local work selectively and migrate only compatible changes through reviewed PRs. Do not merge the whole competing branch blindly.
2. **Ship the trustworthy Windows core:** installed-device capture → organization → grounded Ask → correction → restart/backup/restore, with real provider and credential tests.
3. **Finish phone/cloud parity:** safe authentication, offline journals, explicit conflict resolution, incremental synchronization and secondary attachment behavior without data loss.
4. **Then extend inputs:** voice, broader files, screenshots/share sheet; validate with real microphones, handwriting and held-out questions.
5. **Only later:** proactive synthesis, reminders/actions, third-party adapters, email/calendar, teams, billing and general automation.

Avoid expanding into CRM, ERP, task management, autonomous agents, plugin marketplaces or additional infrastructure without demonstrated memory-product value. Keep React/Tauri/Rust and existing FastAPI/PostgreSQL infrastructure simple and reusable.

## 9. Open decisions and known limits

A single rename PR must not determine product architecture. Naming/legal clearance, actual installed-upgrade compatibility, secure hosting configuration and complete native/cloud parity remain separate gates. The canonical brand may retain technical Recall names for backwards compatibility. Any new acceptance claim must name the exact tested commit, environment, live-versus-synthetic evidence and outstanding limitations.

This PRD intentionally replaces the superseded 2026-10-09 requirements without deleting their historical record on the divergent branch.

