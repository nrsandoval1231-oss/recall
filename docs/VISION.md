# Recall — Vision

**Status:** the one product-scope and trust authority for this repository. Approved 2026-10-15. [DESIGN.md](DESIGN.md) is the sole UI and brand authority and records the owner's latest photo-free desktop/mobile/brand approval. Other files, historical instructions and existing implementation do not override these authorities.

## Owner-directed evolution — 2026-10-17

Product name: **MeGraph — Your world. Connected.** The owner now requires an always-on authenticated cloud platform for the shared web/iPhone PWA and existing offline Windows client, including safe bidirectional synchronization. This explicitly supersedes the local-only, no-login and frozen-cloud restrictions below. Existing originals, corrections, provenance, deterministic validation and approved UI remain mandatory. Internal Recall names and native-library formats remain compatible. No new Obsidian integration is required for cloud independence; existing plain Markdown compatibility remains.

## What Recall is

**Recall is a private, local-first external memory.** You capture anything (a photo of handwritten notes, a typed brain-dump, eventually your voice), and later you can ask a vague question and get back what you knew, with the original source to prove it.

You never have to file, title, tag, or link a capture to make it useful. Organization happens for you, and you can still correct it. The approved brand signature is **A more human tomorrow.**

The test we optimize for: *six months from now, a half-remembered question ("what was going on with that utility delay?") finds the right memory and shows the original page it came from.*

## Who it is for

A pen-and-paper person who works in meetings, on sites and on calls, takes messy notes, and needs to recall them later without building a filing system.

## The product

One desktop app (Windows first) plus a phone companion.

- **Desktop — the Memory Surface.** The owner-approved ivory, graphite, sage and copper interface: a living memory field, quiet navigation and search, contextual inspection, and immediately reachable **Camera, Speak, Write**. It adapts to capture, inspect, ask, explore and correct. The latest desktop board replaces the former capture-only/four-panel visual composition. All presentation details belong to [DESIGN.md](DESIGN.md).
- **Phone — Capture and Ask.** Snap or type a note and ask a quick question, using the same approved visual identity. It talks to your desktop over your private Tailscale network. No login and no public endpoint. Additional screens pictured in the mobile board do not independently authorize new infrastructure or unsupported features.

### The five things a user does

1. **Capture.** Camera/photo, Write, and Speak (Speak only once it genuinely records; until then it says it's unavailable). The original is saved durably *before* any AI touches it.
2. **Inspect / Edit.** A built-in editor with source inspection and revision history. What you wrote is kept visibly separate from what AI inferred. AI never silently rewrites your words.
3. **Ask.** Natural-language, imperfect questions. Answers are short, quote the source, show dates and people, and admit when evidence is thin. If only keyword search ran, the answer says so.
4. **Explore.** People, projects, topics and time, shown as a graph built only from real, explainable links in your library. Nothing decorative or invented is presented as library data.
5. **Correct.** Fix a name, fact, link or category in plain language. The original stays untouched, the correction is audited, and it survives reprocessing.

## How it works (in one paragraph)

Everything lives in a **Recall library**: a normal folder you own, containing your original files, plain Markdown notes with YAML frontmatter, and append-only history. When you capture something, **Jev** parses it into structured, evidence-linked candidates. **Claude**, acting as the librarian, *proposes* a title, properties, links and updates. A **deterministic writer** validates every proposal and commits it. Neither model can write files, choose paths or change permissions. If the models are offline, capture, editing, browsing and keyword search still work, and interpretation shows as pending. Details: [ARCHITECTURE.md](ARCHITECTURE.md).

## Decisions that are settled

- **One UI and brand vision.** The latest three photo-free boards identified in DESIGN.md are the only visual direction. No photographic branding, icons, avatars or backgrounds. User-captured photos and scans remain original evidence, not decoration. No invented insights, social counts or psychological scores from mockup examples.
- **No Obsidian.** Recall does not use, require, open, integrate with or reference Obsidian. The library is plain Markdown because that is portable and readable in any editor, not for any particular app.
- **Local-first.** The library on disk is the authority. SQLite may cache or index, but it never becomes a competing source of truth. No cloud account is needed.
- **No login.** Device pairing plus Tailscale is the access boundary. "No login" never means public access.
- **Jev → Claude → deterministic writer** is the intelligence pipeline. It is consent-gated and budget-capped.
- **Graphiti is optional.** It is a derived, rebuildable index, never the source of truth and never required to open notes or draw the graph.
- **Windows desktop + iPhone** are the target devices.

## Trust rules (non-negotiable)

1. Save original bytes before AI processing. Report saved / received / organized / failed states honestly.
2. Originals are never modified by AI. The owner can still delete them.
3. History is append-only. A note edited outside Recall is never silently overwritten; conflicts are surfaced.
4. Model output is untrusted input. Validate schema, citations, paths and references. The model never picks paths, permissions, SQL or tools.
5. Never turn a question mark, estimate, crossed-out line, illegible number or bare first name into a verified fact or identity.
6. Reprocessing never undoes a human correction.
7. Every material answer cites eligible source evidence, or the answer abstains.
8. Never claim an AI answer when only keyword search ran.
9. Writes are retry-safe, atomic, and use optimistic concurrency.
10. No location tracking, contact scraping, inbox access, public sharing, or autonomous external actions.
11. Never commit real captures, client data, credentials, or private libraries. Synthetic fixtures are labelled as synthetic.

Separate three layers and keep them separate: **(A)** originals and user-authored text with versions; **(B)** accepted or proposed interpretation with source spans, time validity and uncertainty; **(C)** rebuildable views (search index, embeddings, graph, layout). Use evidence states (source-stated, user-confirmed, inferred, disputed) rather than made-up confidence numbers. Track when something happened separately from when Recall learned it.

## Definition of done (v1)

On an **installed Windows build** and a **physical iPhone**, against one exact commit, a person can:

1. Create a Recall library with no other software installed.
2. Capture a handwritten photo and a typed note. Originals are saved before AI runs.
3. See Jev + Claude organize them, with honest pending/failed states.
4. Edit a note in Recall; edit a file externally and see it handled safely.
5. Ask a vague question and get a source-quoted answer, or an honest abstention.
6. Inspect why Recall answered (the original source, the quote, the revision).
7. Correct a mistake, reprocess, and see the correction survive.
8. Navigate connections and history in the graph.
9. Capture from the phone with the desktop off, then see it arrive later without duplicates.
10. Export the library and restore it on a clean machine with nothing lost.
11. Restart at every step without losing data.

Current progress against this list lives in [STATUS.md](STATUS.md). A design approval or documentation update does not satisfy any runtime or real-device gate.

## Out of scope

General productivity suite, CRM, project manager, generic productivity dashboard or card-grid-first file manager, plugin marketplace, Canvas clone, autonomous agent framework, cloud-first rewrite, required Graphiti, fake voice, fabricated memory graph, new login flow, Redis/Kafka/microservices/graph DB/vector service without measured evidence. The approved design may use quiet contextual cards; that does not turn Recall into a productivity dashboard.

## Legacy code in the repo

`services/backend` (FastAPI/Postgres), `apps/web` (PWA) and `apps/mobile` (Expo) are earlier cloud-era builds. They are **not the product** and get no new features. Their docs live in [docs/legacy-cloud/](legacy-cloud/README.md). They provide no alternative UI or brand authority. Removing their runtime code requires dependency and regression checks; the visual lock does not authorize breaking working product behavior or destroying historical acceptance evidence.
