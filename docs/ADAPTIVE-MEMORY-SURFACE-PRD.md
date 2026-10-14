> **CURRENT PRODUCT AUTHORITY — 2026-10-13:** [Native Memory Product Contract](NATIVE-MEMORY-PRODUCT-CONTRACT.md) supersedes Obsidian-as-required-application, Obsidian-only editing/opening, and previous dashboard/UI directions. Obsidian references below describe **historical pilot implementation or optional Markdown compatibility**, not the intended required user workflow. The user-owned local-first Markdown/source library stays; **no storage migration or PR #26 merge is authorized**. The approved photo-free ivory graph-field Camera/Speak/Write UI remains canonical. Preserve evidence and implementation status; do not assume new product behavior is already built.

# Recall — Adaptive Memory Surface (canonical UI amendment)
Date: 2026-10-13
Status: owner-approved visual and interaction direction; implementation not yet verified

## Verified owner-approved visual reference

The owner committed the final four-panel, photo-free adaptive Recall UI reference to `main` at [docs/assets/B4063AE0-31B8-4E1D-B9B2-48C3F181E423.png](https://github.com/nrsandoval1231-oss/recall/blob/main/docs/assets/B4063AE0-31B8-4E1D-B9B2-48C3F181E423.png). Its Git blob SHA is `6abf5192ab4ee96708984174ed15e3648c668bf0`. This is the **canonical visual authority** for Capture, Processing, Memory Inspection, and Graph View. Use the exact existing PNG; do not rename, move, redraw, substitute generated images, or commit a duplicate. Illustrative text and nodes in the mockup are not user data. The separate, earlier three-bubble and post-capture concept images are historical supporting references only.

## Authority and supersession
This document supersedes prior Recall desktop visual compositions (including the warm dashboard / project-card grid described in PR #48, draft PR #49, and earlier UX-SPEC imagery) **for desktop UI layout and interactions only**. Existing Obsidian-first, Tauri, Jev, Claude, source integrity, no-login product and security contracts continue unchanged. PR #26 remains isolated. Draft PR #50's Graphiti work is an independent data capability and must not become a rendering dependency or source of unverified facts. Historical design assets may be retained as labeled history, not competing authorities.

The owner selected the ivory graph-field design on 2026-10-12/13: graph connections fill the background, with an initially near-empty screen centered around three circular capture actions: Camera, Speak, Write. A second approved concept shows the same surface adapting after camera capture with a source-backed right-side processing/inspection panel. Concept renders are illustrative and are not evidence of actual functionality. The final four-screen image is committed on `main` at the canonical reference above. Use it directly for visual verification; do not approximate it.

## Product objective
Recall should feel like a calm, continuously adaptive external memory rather than a dashboard, editor, Obsidian replica, or 3D planet graph. A new or returning user sees the same signature open ivory mindspace: a genuine navigable graph background, a restrained left rail and center capture controls. Details emerge only after a concrete action: capture, search, select graph node, inspect evidence, correct, or navigate time.

## Primary desktop experience
- Nearly full-window pale ivory canvas with subdued light gradients, tiny taupe/charcoal/gold graph nodes and fine relationship lines. The graph is the background environment, not a separate card. A Graph View control changes emphasis to exploratory graph mode while retaining the same world.
- Top-left Recall logotype and short subtitle. Thin icon rail with Home, Ask, Graph View, History/Timeline, People (only grounded view), Settings. Unnecessary destinations should be cut.
- Center headline **Capture** and three outlined circular controls: **Camera**, **Speak**, **Write**. Comfortable hit targets, clear labels and keyboard access.
- Materials (marble, iron, leather, glass) are references for ivory tones, warm dark text, cognac accents, precise edges and quiet translucency; **no literal stone, leather, windows, desks, pens, landscapes or decorative photography**.
- Do not display pretend projects, people, claims, graph links, dates, or capabilities in production. An empty vault may show an extremely faint abstract background motif distinct from actual data. Once memories exist, graph nodes and links must derive from current authorized, provenance-backed vault facts.

## Adaptive behavior
1. Idle / Home: three capture actions and minimal graph. No project tiles, calendar columns, permanent inspector or activity feed.
2. Capture: selected bubble emphasizes; native or supported file/text input opens. Preserve original source before AI begins. Voice either uses an actually implemented permissioned audio flow or is explicitly unavailable, never a fake recording control.
3. Saved / Processing: expand a restrained glass inspector from the right without changing the environment. States reflect actual native receipts, not timers: Saved, Understanding, Connecting, Ready, Needs review, Failed/Uncertain. Stages may be skipped when no corresponding pipeline exists. "Connecting" is not claimed if links are still proposals.
4. Ready / Inspect: show original bytes or accessible source and separately the current validated interpretation. Preserve uncertain claims, traceable source, revision and correction controls.
5. Ask: form input appears in place; relevant graph nodes highlight based on actual retrieval provenance; answer appears with quotations/source links; search-only fallback clearly identified, unsupported answers abstain.
6. Graph exploration: zoom/pan/keyboard navigation, selectable nodes with source counts and explanation of each connection. Nodes are meaningful entities/memories, not decorative random particles. Unknown or tentative relationships are shown differently and never promoted silently.
7. Timeline: accessible time filter changes the visible graph and source list without implying inferred temporal certainty.
8. Correct: focused correction preserves immutable original and auditable history; follow existing native revisions and review requirements.
9. Restore: closing inspector or clearing query restores prior graph viewport and focus without losing capture drafts.

## Data/graph honesty
The Obsidian vault is the durable memory authority. Build a read-only derived visual graph/index from real eligible vault notes, source IDs, existing wikilinks, and explicitly supported relations. It must survive refresh and rebuild from vault state. Do not write or mutate vault records merely to lay out the graph. Unconnected nodes should be allowed. Pending Graphiti integration is optional, not the sole path to a functioning graph. Model-inferred relationships need provenance and confidence indication, not false certainty.

## Design and accessibility
Accessible contrast on ivory, readable text, keyboard-operable bubbles, Escape/back navigation, focus rings, screen reader descriptions for graph selections, reduced-motion support, no costly constant animations, restrained easing, smooth responsive transitions. Desktop-first; phone companion keeps capture/ask fast and simple rather than reproducing a tiny full graph.

## Delivery and acceptance
- Real Tauri desktop, not a standalone demonstration or synthetic data page.
- Commit the owner-approved home and post-capture reference images when their original bytes are available. Screenshots under tests must be clearly marked synthetic if IPC/native provider mocked.
- Verify Windows UI at 1536×1024, 1182×789 and 900×700 plus narrow companion layout; empty and populated vaults.
- End-to-end text capture and photo capture must retain original, recover after restart, and expose source evidence. Voice must either work genuinely or be shown unavailable.
- Graph derives from vault state, has keyboard and pointer navigation, respects uncertainty, can reconstruct after restart.
- Ask, inspect, correction, history and settings continue to function; no unauthorized native changes.
- Lint/typecheck/tests/build and independent review; exact-head CI. Record installed Windows acceptance separately from browser simulation.

## Anti-goals
No CRUD dashboard, project card grid, literal material textures, stock scenes, fake graph links, new authentication, storage rewrite, forced Graphiti dependency, duplicate backend, expansive agent architecture, or PR #26 merge.
