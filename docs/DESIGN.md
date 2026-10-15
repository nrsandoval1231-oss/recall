# Recall — Desktop Design (Adaptive Memory Surface)

**Visual authority:** [assets/B4063AE0-31B8-4E1D-B9B2-48C3F181E423.png](assets/B4063AE0-31B8-4E1D-B9B2-48C3F181E423.png), the owner-approved four-panel reference (Capture, Processing, Memory Inspection, Graph View). Use that exact file. Don't rename, redraw or replace it. Text and nodes in the mockup are illustrative, not user data. All earlier dashboards, card grids and warm-glass designs are retired.

## Feel

A calm, adaptive external memory, not a dashboard, editor clone or 3D planet graph. Pale ivory full-window canvas, fine taupe/charcoal/gold graph lines in the background, warm dark text, cognac accents, quiet translucency. No literal marble, leather, desks, pens, landscapes or stock photography.

## Global shell

- Top-left Recall wordmark; slim icon rail: Home, Ask, Graph View, Timeline, People, Settings. Cut anything not backed by real data.
- The graph stays mounted across views; pan, zoom, selection and viewport persist.
- A right-side glass **inspector** appears only when there is something to inspect, and becomes an overlay or sheet at narrow widths.
- Center: **Capture** heading with three circular controls: **Camera, Speak, Write**.

## Screens

| # | Screen | Shows | Rules |
|---|---|---|---|
| S0 | Empty library | Wordmark, rail, faint abstract motif, Capture + 3 bubbles | No fake counts, nodes, dates or projects |
| S1 | Camera | Image picker/drop, thumbnail of the chosen image, Cancel/Save | File picker is fine on Windows; don't imply live camera. Save bytes first. |
| S2 | Speak | Real recorder (permission, record/stop/playback, duration) | Until implemented: disabled with an explanation. No fake waveform. |
| S3 | Write | Focused editor, multiline paste, Save/Cancel | No folders or tags required. Draft survives view changes and errors. |
| S4 | Saved / Understanding | Inspector with the source excerpt and pipeline stages | Stages come from real receipts: Saved, Understanding, Connecting, Ready, Needs review, Failed, Uncertain. No timers. Pending links are styled differently. |
| S5 | Inspect | Original beside validated interpretation; provenance; revision; Original / Understanding / Related / History tabs when narrow | Never substitute a description for an unreadable original |
| S6 | Ask | In-place input; retrieved nodes highlight; quoted answer + source links | Label keyword-only; abstain without evidence |
| S7 | Graph View | Denser graph; filters (Memories, People, Places, Projects/Topics, evidence state) | Pan/zoom/keyboard plus an accessible list alternative; explain each link; tentative ≠ confirmed; dragging never edits data |
| S8 | Timeline | Bottom time rail filters graph and sources | Created / revised / superseded kept distinct |
| S9 | Correct | Original held steady; editable interpretation | Revision-safe native save; uncertain ops need explicit review |
| S10 | Settings | Library, provider consent/keys/budgets, phone pairing, accessibility | Never display secrets; no login |

## Graph honesty

The graph is a read-only view derived from library notes, source IDs, `[[links]]` and supported relations. It rebuilds after restart and never writes to the library just for layout. Unconnected nodes are fine. Model-inferred relations show their provenance and evidence state. Graphiti may enrich the graph but is never required.

## Interaction and accessibility

Keyboard-operable everything, visible focus rings, Escape closes the inspector before leaving a mode, 120–300 ms easing, `prefers-reduced-motion` honored, graph animation pauses when hidden. A screen-reader graph alternative is a searchable relationship list. No horizontal scrolling. Honest states exist for empty, offline, consent denied, parse failed, conflict, provider uncertain.

## Phone

Capture and Ask only: fast, simple, no miniature graph.

## Visual acceptance

Check the real Tauri app on Windows at 1536×1024, 1182×789 and 900×700, plus the narrow phone layout, each with an empty and a populated library. Browser screenshots that mock IPC must be labelled synthetic.

Walkthroughs: (A) empty library → Write messy text → Saved → processing or Pending → inspect → restart → Ask with source. (B) handwritten photo → saved → consented interpretation → review uncertainty → correct → restart. (C) node → linked memory → timeline filter → back, viewport preserved. (D) denied consent or failed provider → original kept, no fake Ready. (E) reduced motion, keyboard-only, narrow, zero data.
