# Recall

**Your life remembers itself.**

Recall lets people drop in the notes, photos, voice recordings and files they already have. It preserves the original, understands and organizes useful memory into the user's Obsidian vault, then helps retrieve it later from an incomplete, natural question with its source attached. People should not need to learn Markdown, folders, tags or a filing system.

```text
Capture -> Understand -> Organize -> Remember -> Ask -> Evidence
```

Obsidian is the user-owned memory spine. Recall supplies low-friction capture, interpretation, correction, retrieval and the Memory Surface. The Memory Surface is one adaptive experience that moves between capture, understanding, context and original evidence; it is not a set of separate apps or a taxonomy users must learn. See [UX](docs/UX-SPEC.md).

## Product target and delivery

Photos, text, voice and files are required capture forms. The staged build sequence is photo organization, text capture, grounded natural-language Ask, then voice and broader file adapters. No stage changes the destination: the user captures, Recall organizes, and later recall remains tied to evidence.

## Current implementation

The desktop saves photos and typed/pasted notes directly into a user-owned vault, preserves originals and history, and reconciles supported Obsidian edits. Selected-photo interpretations become structured Obsidian notes. Grounded Ask considers current vault evidence and opens cited originals; local keyword search remains available without a remote account.

| Scope | Evidence |
| --- | --- |
| Photo organization and simpler capture surface | [Accepted local result](.agent/REALIGN-01/COMPLETION.json) |
| Typed/pasted text and immutable original | [Accepted local result](.agent/FINISH-02/TEXT-COMPLETION.json) |
| Grounded Ask and recoverable cited answers | [Accepted bounded result](.agent/INTELLIGENCE-01/COMPLETION.json) |
| Automatic organization after remembered opt-in | [Accepted bounded result](.agent/ORGANIZE-01/COMPLETION.json) |
| Evidence-backed links between current memories | [Accepted bounded result](.agent/CONTEXT-01/COMPLETION.json) |
| Questions about retained historical revisions | [Accepted bounded result](.agent/HISTORY-01/COMPLETION.json) |
| Import existing UTF-8 text files | [Accepted bounded result](.agent/TEXT-FILE-01/COMPLETION.json) |

Ask needs its own owner-approved inference connection and consent. It uses up to eight current memories with explicit excerpt/coverage limits. Automatic text/photo organization has bounded local acceptance. Current related-memory links also have bounded independent acceptance. Anchored historical Ask has bounded local acceptance. UTF-8 .txt/.md import has bounded local acceptance. Native voice implementation is active after offline feasibility; recording acceptance, broader files, phone transport, live quality and installed-device acceptance remain open. See [status](docs/V1-STATUS.md) and [acceptance](docs/ACCEPTANCE.md).

The older authenticated cloud implementation is preserved until replacement and migration parity are verified. Local-only use needs no remote account; private cross-device access still needs owner-approved device association. Never weaken private API authorization to remove sign-in.

## Trust and ownership

Original bytes are durable evidence. Machine output is a proposal, not a verified fact. Uncertainty, source references, human correction precedence and revision history survive organization and retrieval. Deterministic software validates model output and writes through the journaled vault boundary; a model cannot select paths, permissions or arbitrary tools. Same-name mentions do not establish cross-note identity.

Never commit private captures, customer data, credentials, local databases, vault exports or private evaluation corpora. Every checked-in fixture must be clearly synthetic.

## Read next

1. [Product requirements](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), and [roadmap](docs/ROADMAP.md)
2. [Data model](docs/DATA-MODEL.md), [AI ingestion](docs/AI-INGESTION.md), [sync and export](docs/SYNC-AND-EXPORT.md), and [API contract](docs/API-CONTRACT.md)
3. [Development](docs/DEVELOPMENT.md), [acceptance](docs/ACCEPTANCE.md), and [current builder handoff](docs/BUILD-HANDOFF.md)
4. [Documentation map](docs/DOCUMENTATION-MAP.md) for every tracked Markdown file and its disposition
