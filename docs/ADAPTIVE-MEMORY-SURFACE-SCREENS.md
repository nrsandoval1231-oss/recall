# Recall — Adaptive Memory Surface screen-by-screen specification
Date: 2026-10-13 | Companion to ADAPTIVE-MEMORY-SURFACE-PRD.md

## Global shell
One continuous ivory edge-to-edge stage, restrained charcoal and cognac iconography, fine graph edges across entire background, top-left Recall brand, slim left navigation, accessible top-level Ask entry, optional contextual user/date area only when real. Graph remains mounted through view transitions; pan/zoom/selection and viewport persist. Avoid permanent sidebar text labels unless expanded/focused. No dashboard grid.

### S0 — Empty vault / first launch
**Visible:** Recall brand, slim icon rail, subtle empty graph motif with clear distinction from real memories, centered Capture headline, Camera / Speak / Write circular controls; concise truthful prompt. No source counts, fictitious memory nodes, saved dates, projects, or progress.
**Actions:** Camera selects real photo input; Write selects editor; Speak opens real recorder if supported, otherwise explains unavailable. Ask leads to honest no-evidence state. Settings opens selected-vault configuration.
**Transitions:** Selected bubble glows subtly while an inline or right-side pane appears; avoid route reload.

### S1 — Camera
**Visible:** Camera emphasized, compact image selection/drop target and thumbnail of *user-selected* image, Cancel/Save controls. On Windows, file picker is valid as camera-equivalent; do not imply hardware camera live preview. Save original bytes first.
**Success:** durable source receipt → S4. **Failure:** actionable error with preserved local draft; never falsely show saved.

### S2 — Speak
**Visible:** Speak emphasized, permission status, record/pause/stop/playback if implemented; source duration and explicit Save.
**If unsupported:** disabled-state explanation and optional supported text capture, no fabricated waveform/audio transcription. Honor native permissions and privacy boundaries.
**Success:** committed original audio → only valid processing path; do not claim Jev handwriting/audio parsing without implementation.

### S3 — Write
**Visible:** focused light editor with multiline paste, optional source/context note, Save and Cancel. No folder/tag decisions required.
**Behavior:** editable draft persists during temporary view changes. On Save, native vault original/text receipt must be acknowledged before starting interpretation. Errors retain draft.

### S4 — Saved / Understanding
**Visible:** graph continues behind an understated right glass inspector, thumbnail/text excerpt only from actual source. Show pipeline steps based on real events: Saved (durable), Understanding (real parser or queued), Connecting (real linking operation/proposal), Ready (validated vault publication), Needs review, Failed, Uncertain.
**Behavior:** stages are data-driven; no fake fixed timers, no automatic resend of uncertain provider delivery, review only with existing consent/budget flows. Camera/Speak/Write remain accessible.
**Graph:** new original-source node enters derived graph as soon as indexed. Link animations occur only after real validated relations; pending proposals use distinct subdued style.

### S5 — Memory ready / inspect
**Visible:** original alongside validated interpretation; title, source timestamp, provenance, explicit unconfirmed flags, revision and Open in Obsidian access. In tight widths switch inspector tabs Original / Understanding / Related / History.
**Actions:** correct, open original, inspect linked memory, return to previous graph focus. Never substitute synthetic description for unreadable original.

### S6 — Ask / reconstruct
**Visible:** in-place Ask input at top/center, same underlying graph, highlighted retrieved nodes, source-backed answer inspector. Relevant nodes animate into emphasis, not fanciful new connections.
**Behavior:** question → authorized local retrieval → evidence identifiers → answer and citations or abstention. Explicitly label keyword-only search. No explanation derived from graph geometry alone; answer tied to actual source evidence.

### S7 — Graph View / explore
**Visible:** graph fills canvas with larger information density; filter controls for Memories, People, Places, Projects/Topics and confidence/evidence; no unrelated panel unless node selected.
**Behavior:** smooth pointer drag/pan, scroll zoom, keyboard focus and list-based alternative, select node → inspector, neighbor highlight, explained link types and source provenance. Node styles distinguish original memories, confirmed identities, tentative aliases, and unresolved mentions. Graph is derived from Obsidian-backed authorized records. For large vaults use stable seeded layout, level-of-detail and capped rendering costs. No destructive edits via dragging visual nodes.
**Graph View button:** toggles deliberate exploration mode; it does NOT swap out the environment.

### S8 — Timeline / evolution
**Visible:** nonintrusive chronological rail/slider on bottom; selected date range filters graph. History of a source and changed interpretations available from inspector.
**Behavior:** source created/revised/superseded date distinctions. No fabricated activity or merged identity. Reset returns full graph.

### S9 — Corrections / review
**Visible:** original held steady; changed interpretation editable in a focused inspector with uncertain/conflicting content distinguished. Source identity, revision, and consequences clearly shown.
**Actions:** save via native revision-safe path, cancel, inspect history. Failed or uncertain operations demand explicit review, not silent replay.

### S10 — Settings / vault health
**Visible:** restrained modal/surface for selected vault, provider consent/configuration/budgets, device connection, accessibility preferences and security controls. Only supported actions active.
**Behavior:** no new login flow. Display real state, never expose secrets. Return to previous graph viewport and draft.

## Global interaction standards
- Alt/shortcut navigation where platform appropriate; Tab/Shift+Tab complete control accessibility; Escape closes inspector before leaving mode.
- Subtle 120–300ms easing; never animate fake progress. honor prefers-reduced-motion. Graph motion halts when hidden or inactive.
- Low-cost graph layout and geometry persistence. Deterministic node positions across reopens where possible.
- Screen reader graph alternative is a searchable relationship list with source explanations.
- Responsive priorities: central capture never obscured; inspector becomes overlay/sheet at narrower widths; no forced horizontal scrolling.
- Empty, offline, consent denied, parsing failed, conflicting note, provider uncertain, and partially supported mode all have honest states.

## Required review walkthroughs
A) New empty vault → Write messy meeting text → Saved → real processing or Pending → inspect original + organized note → restart → Ask with source.
B) Import handwritten photo → original saved → interpretation only if supported and consented → review uncertainty → correct → restart proof.
C) Select source node → inspect linked memory → timeline filter → return, viewport preserved.
D) Denied consent or failed provider → original durable, graph source retained, no fake Ready state.
E) Reduced motion, keyboard-only, narrow viewport and zero-data UI.
