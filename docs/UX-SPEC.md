# Recall V1 experience specification

Version: 0.1 | Behavior and interaction requirements, not an approved visual brand

## Intent

Build one recognizable product across iPhone and Windows. Mobile prioritizes capture and retrieval; desktop adds room for context, comparison, and work. Paul must not feel that he is maintaining a database.

Use calm, legible screens, generous targets, a strong Ask entry point, and restrained motion. The exact palette/typeface/logo is a later visual decision. Do not turn the first implementation into a cinematic landing page, graph visualization, or marketing-site build.

## Navigation

Five primary screens: Today, Capture, Memory detail/Review, Ask, and Library. Settings and onboarding are utilities. Desktop may expose entity filters in a sidebar; mobile uses a compact navigation bar plus prominent capture. Do not create separate applications for clients, projects, assets, and ideas.

## Today

Primary actions: Ask, Scan note, Import photos. Show recent captures with their actual states, a short list of accepted actions, and the count of targeted review items. Empty state: "Photograph a page to start your memory."

Suggested actions are visibly separate from accepted tasks. Do not fabricate a daily brief or infer deadlines from uncertain notes. A badge must distinguish saved-on-device from uploaded and ready.

## Capture

Request camera access only at the moment of need and explain its purpose. If denied, offer import and a settings route rather than repeatedly prompting. Import access should use platform-limited selection rather than scanning the photo library.

Show the page count, thumbnails, order, retake/remove controls, and optional context. Save acknowledges durable local storage before upload. Do not block saving on naming a project, choosing an area, resolving a person, or approving a transcript.

Show explicit recoverable states for offline, rejected/corrupt image, size limit, quota, and upload failure. A photograph can be saved even while the AI service is unavailable. Do not show extraction previews as though they already existed at upload time.

## Memory detail / Review

Desktop: original page and interpreted content can be side by side. Mobile: switch between interpretation and original without losing the page position. Original is always reachable from an answer or claim.

Show title, capture date, separately known event date, summary, transcript, mentions, reported/uncertain statements, and suggested actions. Unknown fields remain unknown. Use text labels, not color alone, for uncertainty.

A review item asks one specific question: "Which Sam?", "Is this 650 or 850?", or "What date was this meeting?" Always allow "Not sure" or defer. Saving the source is not contingent on clearing the queue.

Corrections preview their scope and preserve history. Changing a unit assignment affects the selected memory/claim, not every mention of that unit across the workspace unless the user explicitly chooses a broader operation later.

## Ask

Show grounded answer text, evidence cards with source date/page, and any limits. Every material factual sentence should make its support discoverable. "No confirming source found" must not be rewritten to "never confirmed".

When multiple assets share Unit 4 or several people share a first name, ask for disambiguation or present clearly separated candidates. Do not confidently pick the most recently used identity.

Offline: replace online answer generation with "Search downloaded memory" and state cache coverage. Previously generated answers show their generated time and may be stale. Do not silently reuse an old answer as a new one.

## Library and entity detail

Search all accessible memory. Filter by source type, date, review state, person, organization, project, asset, site, or area. Client is a filter/role on an organization, not a duplicate record.

An entity detail assembles current claims, supporting captures, relevant people/assets, and chronology from actual stored evidence. Missing fields are omitted or labeled unknown. There are no filled-in demo metrics in a live empty account.

Asset history reports recorded observations and source-backed service events. It does not diagnose equipment or invent work-order completion.

## Settings/onboarding

Minimum controls: sign-in/workspace, camera access, AI processing explanation/consent, source/cache retention, device sync status, managed Obsidian destination, data export/delete, and sign-out.

Explain that cloud AI processes selected private content; this is not a local-only or end-to-end-encrypted processing model. Explain potential model/hosting costs without suggesting paid Obsidian Sync is required.

Enabling Obsidian export requires the user to choose a folder and acknowledge that generated notes are managed output, not automatically bidirectional. Never assume broad access to Documents, Desktop, or the whole filesystem.

## Accessibility and interaction acceptance

Support keyboard navigation on desktop, visible focus, screen-reader labels, scalable text, adequate contrast, and non-color status indicators. Important capture controls need large touch targets. Respect reduced-motion settings.

No phone interaction while driving is part of V1 testing or marketing acceptance. Hands-free voice and driving interfaces require a separate future design and real platform support.

## Shared design boundaries

Share token names, spacing/typography scales, status copy, contract types, and interaction semantics. Expo native views and desktop DOM views may be separate implementations. Consistency does not require forcing both into one lowest-common-denominator component library.
