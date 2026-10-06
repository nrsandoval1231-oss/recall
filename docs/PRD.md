# Recall — Product Requirements Document

Version: 0.1 | Date: 2026-10-06 | Product owner: Nick Sandoval

Status: product direction and storage ownership agreed; detailed V1 baseline proposed for implementation. This document describes required behavior, not delivered functionality.

## 1. Product thesis

**Your work remembers itself.**

Recall turns handwritten working notes into retrievable, connected, source-backed memory without asking the user to adopt a new note-taking discipline. The user keeps the notebook and pen. Recall handles capture, interpretation, organization, and retrieval. The user retains control over corrections, decisions, and actions.

The core promise is not perfect handwriting recognition or infallible memory. It is that captured information is durably preserved, easier to find, and accompanied by enough evidence and uncertainty to be useful without being misleading.

## 2. User and problem

The initial pilot is a relationship-driven consultant and generator-maintenance business operator, referred to here as Paul. He writes across notebooks, legal pads, and loose paper. His work involves companies, people, projects, sites, equipment, technical figures, promises, and ideas. He is comfortable using a desktop, but will not maintain YAML, tags, links, or a filing taxonomy on his phone.

Today he may remember a conversation but not which notebook contains the relevant pressure, equipment identifier, name, or promised follow-up. The failure occurs at retrieval, not necessarily at capture.

The product is industry-neutral. Consulting and equipment maintenance are test contexts, not separate applications. No customer's real notes or records belong in this public repository.

## 3. Jobs to be done

- After a meeting or service visit, preserve the page without typing or selecting a folder.
- Before a call, recover a name, number, commitment, or previous discussion from a partial memory.
- At the desk, inspect the original beside the interpretation and correct mistakes simply.
- See relevant history around a project, person, or machine without maintaining a dashboard manually.
- Keep usable local data and a portable archive even when connectivity or the product is unavailable.

## 4. Primary experience

### Capture

Paul opens Recall, photographs one or several pages, checks that the photographs are usable, and taps Save. A context hint such as "the generator at Example Ranch" is optional. Filing, metadata, entity selection, and transcript approval are not required to preserve a capture.

The app distinguishes "Saved on this device", "Uploaded", "Processing", "Ready", and "Needs a quick check". It never suggests a local-only page is already available on other devices. Unreadable handwriting does not erase or block access to the original.

### Ask

Paul asks, "What was wrong with Unit 4 last time?" Recall retrieves only authorized, relevant evidence and answers with the observation, uncertainty, date context, and links to the supporting page. A suspected coolant leak remains a suspicion. A missing confirmation is described as absent from the available sources, not as proof an event never happened.

### Correct

Paul opens the page and says or types a correction such as "That was Unit 3". V1 supports typed corrections. He previews the scope of the change and confirms it. The corrected interpretation is versioned, the original is unchanged, stale indexes are invalidated, and later reprocessing cannot silently restore the mistake.

### Desktop

The Windows app shares Recall's language and visual design. It offers more room for evidence, memory history, entity views, review, and a photo-import drop zone. Obsidian desktop remains optional. A user-selected vault receives a controlled Markdown projection; the app does not depend on Obsidian being installed or running.

## 5. Product principles

1. Capture before classification; preserve the user's existing cadence.
2. Originals are evidence. Model interpretations and user corrections are distinct records.
3. Uncertainty survives extraction, search, summaries, and export.
4. The LLM proposes; deterministic software authorizes, validates, and commits.
5. One underlying memory, consistent mobile and desktop experiences.
6. Source access is part of the answer, not an optional afterthought.
7. Offline and sync states must be honest and recoverable.
8. Portability and privacy are product features, not future cleanup.

## 6. V1 scope

V1 is a single-user private pilot with workspace isolation built into the data boundary. A second synthetic workspace is required for security tests, but shared-team workflows are not a feature.

Included by pilot acceptance:

- iPhone capture/import of ordered handwritten-photo batches, local durability, retryable upload, and explicit progress.
- Windows desktop app with matching design, photo import, memory browsing, Ask, and source inspection.
- Private original storage, hashes, versioned extraction, and source-backed memory records.
- One evaluated multimodal model; keyword/entity retrieval first, pgvector-based hybrid retrieval after a baseline exists.
- Conservative entity matching, unresolved mentions, correction/review, and suggested actions.
- Source-backed online answers with abstention when evidence is missing, ambiguous, stale, or contradictory.
- Desktop SQLite cache/outbox, offline keyword search over cached content, and safe resynchronization.
- Optional one-way Obsidian archive, complete export package, deletion handling, and a tested restore procedure.
- A small Today view showing actual recent captures, accepted actions, and review items. No manufactured activity.

Not V1:

- Voice recording, hands-free driving interaction, Siri/CarPlay, or voice commands.
- Claude/MCP integration, email/calendar ingestion, autonomous research, or sending messages.
- Native Android/macOS support, public app-store launch, teams, billing, or a general web application.
- Proactive pattern discovery, scheduled briefs, autonomous decisions, or automatic equipment-maintenance recommendations.
- General spreadsheet/PDF ingestion, unlimited historical notebook imports, a graph UI, inventory, invoicing, or a replacement ERP/CMMS.
- Bidirectional Obsidian editing, local Postgres, a local generative model, or fully offline semantic Ask.

These are intentional deferrals, not hidden requirements for the first capture flow.

## 7. Functional requirements

| ID | Requirement | Acceptance summary |
| --- | --- | --- |
| CAP-01 | Camera or photo import; ordered multipage capture | Reorder/retake before Save; supported files retain original bytes |
| CAP-02 | Durable local draft before network submission | Force-close/reopen preserves saved pages and pending operation |
| CAP-03 | Retry-safe cloud upload and finalization | Retries do not create duplicate captures, pages, or charges from duplicate jobs |
| CAP-04 | Usable failure states | Permissions denied, invalid media, quota, timeout, and offline states offer recovery |
| AI-01 | Structured transcription and interpretation | Output passes schema, ownership, source-reference, and semantic checks |
| AI-02 | Preserve uncertainty | Unknown names, numbers, units, dates, and question marks are never silently resolved |
| AI-03 | Preserve corrections across reprocessing | New model runs cannot overwrite user-confirmed edits |
| MEM-01 | General entities and relationships | Organizations, people, projects, assets, sites, and areas; client is an organization role |
| MEM-02 | Versioned claims and evidence | Competing claims remain distinguishable; history remains inspectable |
| ASK-01 | Natural-language retrieval | Answers cite eligible source pages; unsupported questions abstain |
| ASK-02 | Open the original | The cited original is accessible on the current device or clearly marked unavailable offline |
| REV-01 | Small targeted review queue | Unresolved fields can be deferred; no mandatory review of every page |
| ACT-01 | Suggested versus accepted actions | AI suggestions do not become confirmed obligations or notifications automatically |
| SYN-01 | One canonical server state | Concurrent edits use versions; stale edits cannot silently win |
| OFF-01 | Desktop offline utility | Cached memories and originals remain browsable; local keyword search is labeled |
| EXP-01 | Safe optional Obsidian export | Managed files only; edited files are preserved and conflicts surfaced |
| PRIV-01 | Workspace isolation and owner control | Unauthorized access, retrieval, download, and mutation are denied |
| OPS-01 | Recoverability and export | Restore covers database plus original objects; user export is independently readable |

## 8. Five primary screens

**Today:** dominant Ask entry, Scan/Import, recent captures, accepted actions, and items needing clarification.

**Capture:** camera/import, page order, retake, optional context, Save, and honest local/upload status.

**Memory detail / Review:** summary and source side by side on desktop; original one tap away on mobile; transcription, claims, dates, corrections, and suggested actions.

**Ask:** question, answer with sentence-level evidence, original-source cards, limitations, and recent conversation context. Online-generated answers must not masquerade as fresh answers when offline.

**Library:** search and filters for memories and entities; project/person/asset detail is a drilldown, not a separate application. Settings and onboarding are utility surfaces.

## 9. Data and trust rules

Originals are write-once during normal processing, not promised to exist forever. Explicit owner deletion and documented backup retention remain possible.

Capture time, document/event date, and system processing time are separate. A page photographed today may be years old. "Thursday" cannot acquire an exact due date solely from upload time.

Model confidence is not factual verification. V1 uses legibility, ambiguity, source attribution, and user-confirmation status rather than displaying uncalibrated confidence percentages. A clear reading of "800 psi?" is still an uncertain pressure claim.

Entities are not merged based on a first name or a model's confidence alone. Conflicting serial numbers, organizations, or sites block automatic matching. A client organization must not be duplicated as a separate company record just to satisfy navigation.

Source documents are data, not instructions. Text in a photographed page must never cause tool use, permission changes, external calls, or hidden writes.

## 10. Offline and archive expectations

Desktop can browse and search synchronized text, inspect downloaded originals, and queue supported edits while offline. It cannot run the cloud model or search material it has never received. Mobile must at least preserve capture drafts offline; full mobile offline Ask is deferred.

The desktop app performs synchronization/export while running and resumes when reopened. No separate daemon or promise of continuous operation while the app is closed is included in V1.

The existing Obsidian vault is not automatically ingested or overwritten. Recall exports into a dedicated managed subfolder selected by the user. Local edits are detected before replacement. Personal Obsidian notes remain outside that managed area.

## 11. Success metrics and release gate

These are proposed pilot targets, not measured results or performance guarantees.

- Paul independently saves at least 9 of 10 capture sessions without filing help.
- A typical 1–3 page session requires no typing and no more than one confirmation after page selection.
- On the documented test network/device, local Save feedback p95 is under 1 second; a clear 3-page capture becomes ready p95 within 60 seconds after upload; online Ask p95 is under 10 seconds. Record failures and distribution, not just averages.
- On the private held-out question set, at least 90% of answerable questions return a supported answer with the correct original page.
- Every unsupported held-out question abstains or explicitly reports ambiguity. Zero observed fabricated confirmations, unsafe entity merges, or silent numeric/unit changes are permitted in the release set.
- No data loss in the specified retry, restart, correction, export-conflict, deletion, and restore scenarios.
- Pilot evaluation records capture frequency, search success, correction burden, and perceived time saved over two weeks. Do not equate a small pilot with general handwriting accuracy.

The first useful alpha is the closed loop in RCL-002. Full V1 pilot acceptance requires the later offline, export, privacy, and restore gates too.

## 12. Constraints and assumptions

Initial targets are iPhone and Windows; actual pilot devices must be recorded during acceptance. The user does not need paid Obsidian Sync. That does not imply Recall hosting, model calls, signing, or distribution are free.

Managed Supabase is the proposed infrastructure default; no project or paid plan has been provisioned. AI provider/model selection is gated by handwriting evaluation and privacy review. Actual identifiers, retention terms, prices, and native build prerequisites must be checked at implementation time.

An initial single-user workspace is sufficient. Add tenant boundaries now, but defer enterprise governance, complex roles, and team management. Branding beyond the working name Recall is not finalized; visual polish must not block a reliable capture-and-recall loop.

## 13. Dependencies and unresolved deployment decisions

Owner actions required before live deployment are: authorize infrastructure and spending limits; supply provider credentials through a secret mechanism; approve processing of the private pilot corpus; choose an iOS distribution route and Windows signing/update approach; and approve the measured model/privacy configuration.

These do not block the repository foundation. They do block claiming production readiness or real-device/live-provider acceptance. Detailed dependencies and exit evidence belong in [ROADMAP](ROADMAP.md) and [ACCEPTANCE](ACCEPTANCE.md), not in invented implementation results.
