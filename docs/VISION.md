# MONOLITH — Vision

**Status:** the product-scope and trust authority. MONOLITH is canonical by owner instruction on 2026-10-17. [DESIGN.md](DESIGN.md) applies the actual [brand guide](../branding/monolith/v1/BRAND_GUIDE.md). Superseded boards and historical instructions have no current design authority.

## Owner-directed evolution — 2026-10-17

Product name: **MONOLITH — Your world. Connected.** The owner now requires an always-on authenticated cloud platform for the shared web/iPhone PWA and existing offline Windows client, including safe bidirectional synchronization. This explicitly supersedes the earlier local-only, no-login and frozen-cloud restrictions. Existing originals, corrections, provenance, deterministic validation and approved UI remain mandatory. Internal Recall names and native-library formats remain compatible. No new Obsidian integration is required for cloud independence; existing plain Markdown compatibility remains.

## What MONOLITH is

**MONOLITH is a private, local-first external memory.** You capture anything (a photo of handwritten notes, a typed brain-dump, eventually your voice), and later you can ask a vague question and get back what you knew, with the original source to prove it.

You never have to file, title, tag, or link a capture to make it useful. Organization happens for you, and you can still correct it. The brand signature is **Your world. Connected.**

The test we optimize for: *six months from now, a half-remembered question ("what was going on with that utility delay?") finds the right memory and shows the original page it came from.*

## Who it is for

A pen-and-paper person who works in meetings, on sites and on calls, takes messy notes, and needs to recall them later without building a filing system.

## The product

One desktop app (Windows first) plus a phone companion.

- **Desktop — the Memory Surface.** The MONOLITH smoky-glass black/gray interface: a living memory field, quiet navigation and search, contextual inspection, and immediately reachable **Camera, Speak, Write**. It adapts to capture, inspect, ask, explore and correct. The MONOLITH guide supersedes the earlier desktop board styling. All presentation details belong to [DESIGN.md](DESIGN.md).
- **Phone — Capture and Ask.** Snap or type a note and ask a quick question, using the same approved visual identity. The authenticated web/PWA supports cloud access without a running desktop; the existing private Tailscale companion remains supported. Cloud implementation gaps are explicit in STATUS.

### The five things a user does

1. **Capture.** Camera/photo, Write, and Speak (Speak only once it genuinely records; until then it says it's unavailable). The original is saved durably *before* any AI touches it.
2. **Inspect / Edit.** A built-in editor with source inspection and revision history. What you wrote is kept visibly separate from what AI inferred. AI never silently rewrites your words.
3. **Ask.** Natural-language, imperfect questions. Answers are short, quote the source, show dates and people, and admit when evidence is thin. If only keyword search ran, the answer says so.
4. **Explore.** People, projects, topics and time, shown as a graph built only from real, explainable links in your library. Nothing decorative or invented is presented as library data.
5. **Correct.** Fix a name, fact, link or category in plain language. The original stays untouched, the correction is audited, and it survives reprocessing.

## How it works (in one paragraph)

Everything lives in a **MONOLITH library**: a normal folder you own, containing your original files, plain Markdown notes with YAML frontmatter, and append-only history. When you capture something, **Jev** parses it into structured, evidence-linked candidates. **Claude**, acting as the librarian, *proposes* a title, properties, links and updates. A **deterministic writer** validates every proposal and commits it. Neither model can write files, choose paths or change permissions. If the models are offline, capture, editing, browsing and keyword search still work, and interpretation shows as pending. Details: [ARCHITECTURE.md](ARCHITECTURE.md).

## Decisions that are settled

- **One UI and brand vision.** MONOLITH guide and actual assets are canonical. Preserve original user imagery and evidence. No invented insights, social counts or psychological scores.
- **No Obsidian.** MONOLITH does not use, require, open, integrate with or reference Obsidian. The library is plain Markdown because that is portable and readable in any editor, not for any particular app.
- **Local and cloud modes.** The local library remains independent. Authenticated synchronized cloud records use PostgreSQL, with opt-in backed-up migration and no silent overwrite. Existing native formats remain compatible.
- **Access boundaries.** Local companion uses device pairing/private network. Cloud uses revocable enrollment and HttpOnly same-origin sessions, never open signup.
- **Jev → Claude → deterministic writer** is the intelligence pipeline. It is consent-gated and budget-capped.
- **Graphiti is optional.** It is a derived, rebuildable index, never the source of truth and never required to open notes or draw the graph.
- **Windows desktop + iPhone** are the target devices.

## Trust rules (non-negotiable)

1. Save original bytes before AI processing. Report saved / received / organized / failed states honestly.
2. Originals are never modified by AI. The owner can still delete them.
3. History is append-only. A note edited outside MONOLITH is never silently overwritten; conflicts are surfaced.
4. Model output is untrusted input. Validate schema, citations, paths and references. The model never picks paths, permissions, SQL or tools.
5. Never turn a question mark, estimate, crossed-out line, illegible number or bare first name into a verified fact or identity.
6. Reprocessing never undoes a human correction.
7. Every material answer cites eligible source evidence, or the answer abstains.
8. Never claim an AI answer when only keyword search ran.
9. Writes are retry-safe, atomic, and use optimistic concurrency.
10. No location tracking, contact scraping, inbox access, public sharing, or autonomous external actions.
11. Never commit real captures, client data, credentials, or private libraries. Synthetic fixtures are labelled as synthetic.

Separate three layers and keep them separate: **(A)** originals and user-authored text with versions; **(B)** accepted or proposed interpretation with source spans, time validity and uncertainty; **(C)** rebuildable views (search index, embeddings, graph, layout). Use evidence states (source-stated, user-confirmed, inferred, disputed) rather than made-up confidence numbers. Track when something happened separately from when MONOLITH learned it.

## Definition of done (v1)

On an **installed Windows build** and a **physical iPhone**, against one exact commit, a person can:

1. Create a MONOLITH library with no other software installed.
2. Capture a handwritten photo and a typed note. Originals are saved before AI runs.
3. See Jev + Claude organize them, with honest pending/failed states.
4. Edit a note in MONOLITH; edit a file externally and see it handled safely.
5. Ask a vague question and get a source-quoted answer, or an honest abstention.
6. Inspect why MONOLITH answered (the original source, the quote, the revision).
7. Correct a mistake, reprocess, and see the correction survive.
8. Navigate connections and history in the graph.
9. Capture from the phone with the desktop off, then see it arrive later without duplicates.
10. Export the library and restore it on a clean machine with nothing lost.
11. Restart at every step without losing data.

Current progress against this list lives in [STATUS.md](STATUS.md). A design approval or documentation update does not satisfy any runtime or real-device gate.

## Out of scope

General productivity suite, CRM, project manager, generic productivity dashboard or card-grid-first file manager, plugin marketplace, Canvas clone, autonomous agent framework, destructive cloud rewrite, required Graphiti, fake voice, fabricated memory graph, unapproved access flows, Redis/Kafka/microservices/graph DB/vector service without measured evidence. The approved design may use quiet contextual cards; that does not turn MONOLITH into a productivity dashboard.

## Legacy code in the repo

`services/backend` is reused by the active authenticated cloud checkpoint; it is not frozen. `apps/web` and `apps/mobile` remain historical clients, not alternative UI authorities. Dependency checks are required before deleting any runtime code. Technical Recall/MeGraph package names, storage keys, library folders, API paths, environment variables, credential namespaces and deployment paths remain stable for compatibility. They are not product brands.
