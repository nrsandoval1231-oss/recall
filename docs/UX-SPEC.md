# Recall V1 experience specification

## V1 implemented product surfaces

Today keeps Ask prominent and capture readily available. Mobile Ask displays answered/ambiguous/insufficient-evidence/unavailable states and opens cited originals through Detail. Desktop provides Ask, Library, Review, Memory with original evidence/history, correction controls, conservative identity confirmation and explicit merge/split preview.

Offline desktop uses cached search and originals available on that device, with an explicit local-search message. Supported corrections/actions are durable before network acknowledgment; conflicts remain visible. Authorization denial clears controlled cache and never falls back to cached originals. Settings exposes portable ZIP export, safe selected-root Markdown export and owner deletion preview/confirmation. Processing states remain tied to actual saved/uploaded/worker state.

Browser/component tests and bundles are distinct from physical iPhone and installed Windows acceptance; both live device gates remain OPEN. See [V1-STATUS](V1-STATUS.md).


Version: 0.2 | Behavior requirements, not final visual brand

## Intent

Build one recognizable memory product across iPhone and Windows. Mobile prioritizes effortless capture and recall; desktop adds context, comparison, drag/drop, review, and exploration.

The interface must not expose the complexity of the memory model. Users should not feel that they are maintaining a database, CRM, folder tree, graph, or taxonomy.

## Core promise in the UI

**Ask what you remember. Capture what you don't want to lose.**

The dominant interaction is a natural-language Ask field plus simple Capture.

## Navigation

Five primary surfaces: Today, Capture, Memory detail/Review, Ask, Library. Settings/onboarding are utilities.

Domain-specific concepts are views/filters, not separate apps. One user may care about projects and equipment; another about classes and people; another about travel and places.

## Today

Show:
- dominant “What are you trying to remember?” Ask entry;
- Capture;
- recent memories;
- accepted actions/commitments when present;
- targeted clarification items.

Do not manufacture a daily brief, urgency, or activity. Empty state should invite the first capture without asking the user to design an organization system.

## Capture

V1: camera/photo import. Typed text is deferred to V1.5 so RCL-001 has one complete, tested source contract.

Photo flow: request camera permission at need; ordered pages; retake/remove; optional one-line context; Save. Never require a title, folder, tags, entity, project, or note type.

Saving acknowledges durable local persistence before cloud/AI processing. Explicit states distinguish local save, upload, processing, ready, and needs review.

Future capture adapters—voice, screenshots/share sheet, files, links, email/calendar—must feed the same source-memory boundary rather than inventing separate organizational systems.

## Memory detail / Review

Show the interpreted memory with its original source one action away; desktop may show both side by side.

Expose:
- capture/source time and separately known event time;
- summary/transcription;
- linked/unresolved entities;
- observations/claims and their uncertainty;
- ideas/decisions/preferences when supported;
- accepted/suggested actions;
- temporal supersession/history;
- corrections and provenance.

Review asks one small question at a time: “Which Sam?”, “Is this 650 or 850?”, “Is this the same place?” Always allow Not sure/defer.

## Ask

Ask accepts human recollection, not query syntax.

Examples:
- “Who was that guy Sarah introduced me to last summer who did solar?”
- “What did my professor say about mitochondrial DNA?”
- “What was the restaurant someone recommended in Florence?”
- “What did we originally expect?”
- “What is the latest number?”

Answers show grounded text, evidence cards, source date/page, uncertainty/conflicts, and limitations. Every material factual claim makes support discoverable.

If multiple candidates fit, Ask clarifies or presents candidates instead of confidently choosing. If evidence is absent, it says so.

Historical versus latest intent must affect retrieval. “What did we originally think?” must not silently return only the current state.

Offline desktop replaces fresh synthesis with clearly labeled downloaded-memory search. Cached old answers are never masqueraded as newly generated answers.

## Library

Library is optional exploration, not required organization.

Search/browse:
- memories;
- people;
- organizations;
- places;
- things;
- events;
- projects;
- topics.

The system may create contextual views from these primitives. A maintenance asset history, student course context, trip view, or customer history is a projection of universal memory.

## Desktop-specific value

Desktop adds:
- larger evidence/review layouts;
- drag/drop capture;
- richer Library exploration;
- offline cache/search;
- export/integration settings;
- optional Open in Obsidian for users who enable that adapter.

Desktop and mobile share terminology, states, and design tokens without forcing identical component implementations.

## Settings/onboarding

Minimum controls:
- account/workspace;
- capture permissions;
- AI processing explanation/consent;
- source/cache retention;
- device sync status;
- export/delete;
- optional integrations such as Obsidian;
- sign out.

Do not make Obsidian setup part of standard onboarding. It is an optional advanced integration.

## Accessibility

Keyboard navigation on desktop, visible focus, screen-reader labels, scalable text, adequate contrast, non-color status indicators, large capture targets, reduced-motion support.

Hands-free driving interaction is not V1 and must not be implied by marketing until separately designed and validated.
