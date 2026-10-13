# Recall — Autonomous builder instruction: implement the approved adaptive UI
Date: 2026-10-13

You are the senior builder for `nrsandoval1231-oss/recall`. The owner has approved a radically simpler canonical desktop experience: **ivory full-canvas memory graph as the environment; near-empty Home centered on three capture bubbles Camera, Speak, Write; interface adapts to real user intent and persisted memory**.

## Sources of truth
Read `docs/ADAPTIVE-MEMORY-SURFACE-PRD.md`, `docs/ADAPTIVE-MEMORY-SURFACE-SCREENS.md`, current native desktop code, `docs/PILOT-CONTRACT.md` and `docs/MEETING-TO-MEMORY.md`. This UI amendment supersedes the older warm dashboard design; PRs #48/#49 are historical and must NOT be implemented as the new visual direction. PR #26 remains isolated. Graphiti PR #50 may be inspected for compatible derived knowledge, but neither merge it nor make graph rendering depend on it.

The two owner-approved visual references are the minimal ivory graph with Camera/Speak/Write bubbles (Home) and the post-camera capture state with right glass progress panel. They exist as ChatGPT conversation-generated images; if their originals are not present in the repository, obtain/commit the original image bytes for pixel comparison. Do not manufacture a lookalike and report it as the approved image.

## Build, don't just plan
1. Inspect actual Tauri desktop architecture, navigation, native bridge, existing vault reading/index and current tests. Identify working actions and unavailable modes.
2. Build the new responsive shell: graph as full-screen canvas behind all views; semantic DOM controls over it; centered Capture heading and three action bubbles; minimal icon rail including Graph View; warm ivory, charcoal, taupe, cognac and glass treatment. No marble/leather props/textures.
3. Wire Camera to native photo/file intake, Write to durable text capture. Implement Speak only if actual audio source persistence and required permission/processing already exist or can be safely implemented; otherwise show clearly unavailable. Never leave an inert control that pretends to record.
4. Build derived, deterministic graph data from authorized real vault/source records, existing confirmed relations and explicit links. No invented nodes/edges; show visually quiet empty state. Camera capture updates graph from persisted source/index events, never from synthetic timer.
5. Build adaptive inspector for processing receipts and original/interpretation/history, including failed/uncertain and review states. Keep the Obsidian source and revision protections.
6. Wire Ask to existing source-backed retrieval. Graph highlights grounded retrieved source nodes; label keyword fallback honestly.
7. Support pointer graph navigation and accessible list/keyboard alternative. Respect reduced motion and performance with large vaults.
8. Run real UI browser checks plus native tests/build, typecheck, lint, and visual screenshots (1536×1024, 1182×789, 900×700). Independently review and fix regressions.
9. Open an implementation PR with changed paths, before/after screenshot evidence, native capability matrix, exact tests and remaining real Windows/phone acceptance requirements. Do not merge until reviewed.

## Non-negotiables
Obsidian remains durable memory; no login UX or new persistence stack. Preserve immutable originals, user corrections, provenance, safety/consent/provider limits, Jev and Claude pipelines. No rewriting native writer or speculative Graphiti integration for a UI task. No project-card dashboard, no decorative stock content, no windows/pens/stone panels. Do not replace the graph with an orbiting galaxy.

## Definition of done
The real desktop app launches into the approved near-empty Capture Home; Camera and Write genuinely persist originals; Speak is either functional or explicitly unavailable; graph environment is truly derived from vault evidence; each state transition is honest; Ask/inspect/correction/restart behavior works; screenshot comparisons and all relevant checks pass. Distinguish implementation, tests, mock-only screenshots, and installed Windows verification. Repair adjacent UI regressions you find, but resist unrelated architecture churn.
