# Recall — Canonical Experience & Visual System

> **CURRENT PILOT DIRECTIVE — 2026-10-09.** [Pilot Product Contract](PILOT-CONTRACT.md) governs this document wherever older text conflicts. The pilot is a **single iPhone Home Screen installable web app (PWA) and Windows browser app**, **no login or email-auth UI**, with **secure operator provisioned revocable private device access**. Keep the canonical Memory Surface, original evidence and provenance. Native Expo/Tauri flows are **not pilot prerequisites**; earlier email login / deployment / test narratives are **historical**, not current instructions. The separately mentioned visual reference image was not attached; **do not claim exact image match**.


Version: 1.0 | Date: 2026-10-07 | Status: **approved canonical product direction**

This document defines the target Recall experience. It supersedes conventional dashboard/page-navigation interpretations of the earlier UX baseline while preserving Recall's trust, provenance, accessibility, and universal-memory requirements.

## 1. North-star experience

**Your life remembers itself.**

Recall should not feel like a notes app, database, CRM, file manager, knowledge graph, or chatbot with storage attached. It should feel like a quiet external memory: capture disappears into the background; asking brings the right understanding and original evidence back into view.

The primary experience is one continuously transforming **Memory Surface**.

```text
CAPTURE -> UNDERSTAND -> CONNECT -> REMEMBER -> RECALL -> ACT
```

These are not six modules. They are six states of the same environment.

The user should feel that they focus on something and Recall rearranges memory around that intent.

## 2. Canonical design language

Recall's visual materials have semantic meaning:

- **Glass = understanding.** Summaries, interpretations, entities, relationships, timelines, reconstructed context, and controls live on translucent glass.
- **Physical artifacts = evidence.** Notebook pages, photographs, screenshots, emails, PDFs, receipts, documents, and other originals retain their source character.
- **Light = intelligence.** Restrained illumination communicates active context, relationships, new information, uncertainty, and attention.
- **Space = relationships.** Proximity and composition communicate what belongs together without forcing the user to maintain links.
- **Depth = context and focus.** Focused material moves toward the user; supporting context recedes but remains perceptible.
- **Time = memory evolution.** Recall must make “what I knew then” distinct from “what I know now.”

The signature composition is **original evidence beneath a translucent interpretation layer**: evidence underneath; understanding above it.

Glass is not decoration. If removing translucency, depth, or evidence layering leaves the same generic dashboard, the design has failed.

## 3. The Memory Surface

Recall is not organized around routes that expose the data model. The application may use routes internally, but the perceived interaction is one spatial surface.

The surface has five rendering layers:

1. **Environment** — warm, quiet atmosphere with restrained depth; never a distracting 3D scene.
2. **Glass workspace** — translucent semantic boards with hierarchy, refraction/blur, edge response, shadow, and controlled Z-depth.
3. **Evidence** — source artifacts presented materially and legibly, never demoted to generic attachment icons.
4. **Intelligence** — subtle relationship/attention/confidence cues; never neon “AI” spectacle.
5. **Interaction** — Ask, Capture, focus, back, correction, and action remain familiar and accessible.

Implementation should begin DOM/CSS-first. GPU/WebGL effects are justified only where they materially improve the spatial illusion without harming performance, accessibility, or maintainability.

## 4. Interaction grammar

The canonical verbs are deliberately small:

- **Ask -> reconstruct.** Relevant memories assemble around the question.
- **Capture -> remember.** Save first; organizational work is automatic.
- **Focus -> approach.** Selected content moves forward in depth.
- **Inspect -> reveal evidence.** Interpretation yields to its original source.
- **Explore -> reorganize.** Selecting a person/place/project/topic changes the center of gravity rather than opening a database record.
- **Back -> restore context.** The previous spatial arrangement returns.
- **Correct -> update understanding.** Original evidence remains immutable; correction and history remain traceable.
- **Act -> use memory.** Accepted next actions emerge from recalled context without becoming obligations automatically.

Motion rule: **nothing merely pops open when depth can communicate the transition. Memory moves through depth.**

Normal controls remain conventional: click/tap to focus, scroll to explore, Back to return, Ask to reconstruct, Capture to remember. No free-flight camera, mandatory rotation, or spatial-navigation gimmicks.

Reduced-motion mode must preserve the same hierarchy through opacity/layout changes without animated depth.

## 5. Canonical desktop journey

The first production-quality vertical slice is:

```text
Home
  -> Ask “What do you know about Brooks Campus?”
  -> Brooks Campus reconstruction assembles
  -> focus a memory
  -> original notebook evidence rises forward
  -> focus a person
  -> workspace reorganizes around that person
  -> move through historical/current state
  -> correct an interpretation
  -> Back restores Brooks Campus context
```

This is a synthetic design fixture, not customer/project evidence.

### Home

Home is intentionally sparse. Ask is the gravitational center. Capture and recent context are secondary. Avoid a dense dashboard.

Permanent navigation should be minimal: **Recall / Ask / Capture / Recent** or an equivalently small set. People, Places, Projects, Equipment, Topics, and Timeline emerge contextually instead of becoming organizational chores.

### Ask / reconstruction

An answer is not merely prose. Recall reconstructs the relevant memory context:

- concise grounded answer;
- supporting evidence;
- relevant people/places/projects/things/topics;
- temporal context;
- uncertainty/conflict when material;
- source access.

Supporting boards may sit behind or beside the focused answer. They are contextual views over canonical memory, not independent mini-apps.

### Focus and evidence

Selecting a memory moves it toward the user. Opening evidence causes the interpretation layer to become visually subordinate while the original source moves forward.

The user must be able to answer two questions immediately:

1. What does Recall currently understand?
2. Why does Recall believe that?

### Entity/context focus

Selecting a person, place, project, thing, event, or topic recenters the surface around that concept. Do not default to a literal node-link graph. Relationships should emerge through composition, grouping, depth, and contextual boards. Explicit graph visualization is optional future tooling, not the core metaphor.

### Temporal focus

Time is first-class. A user can distinguish current understanding from historical state and, where evidence supports it, move to an earlier point to inspect what Recall knew then. The UI must never imply historical certainty the data model does not support.

### Correction

Correction should operate on human statements, not raw metadata. The user selects questionable understanding, states the correction, sees the affected scope, and confirms. Original evidence and prior interpretations remain available according to the canonical correction/history model.

## 6. Mobile adaptation

Mobile is not desktop shrunk down.

**Mobile = Remember + Recall.**

- Camera/capture and Ask dominate.
- Present one primary glass board at a time.
- Related context may peek behind the focused board like a physical stack.
- Evidence remains one gesture away.
- Deep comparison/exploration can simplify into sequential focus states.
- No required title, folder, tag, entity selection, transcript approval, or taxonomy maintenance for normal capture.

Desktop is the richer **Think + Explore** surface. Both share the same materials, language, states, provenance, and interaction grammar.

## 7. Capture

Capture must be almost frictionless:

1. photograph/import;
2. durable Save;
3. optional context hint;
4. leave.

Normal capture requires no title, folder, tags, project, entity, or note type. AI processing happens after durable source preservation. Honest local/upload/processing/ready/review/error states remain required.

Do not turn the capture confirmation screen into an organization form.

## 8. Visual character

Recall should feel:

**quiet · human · permanent · trustworthy · cinematic · warm**

Preferred qualities:
- warm ivory/charcoal tonal system;
- excellent editorial typography;
- translucent material with readable contrast;
- restrained blur/refraction and edge light;
- source photography/paper texture allowed to feel physical;
- generous negative space;
- slow, purposeful spatial transitions;
- subtle environmental depth.

Avoid:
- generic SaaS dashboard grids;
- neon AI gradients;
- glowing sci-fi orbs;
- excessive glass on every surface;
- tiny floating-card constellations;
- gratuitous 3D;
- permanent taxonomy sidebars;
- chat bubbles as the dominant memory representation;
- fake certainty/confidence theater.

## 9. Glass-board rules

A board exists because it represents a coherent piece of understanding, not because the layout needs another card.

Hierarchy:
- one primary focused board;
- a small number of supporting contextual boards;
- evidence artifacts beneath/behind the interpretation;
- peripheral material fades/recedes before it competes with focus.

Glass must maintain accessibility: sufficient contrast, legible type, visible focus states, keyboard traversal, scalable text, and non-color-only status. Decorative blur must degrade gracefully.

Pointer-responsive highlights/parallax may reinforce materiality on desktop, but interaction cannot depend on them.

## 10. Trust is visible

The visual system must reinforce the existing trust model:

- originals remain recognizable as originals;
- interpretation is visibly separate from evidence;
- corrections do not overwrite source artifacts;
- uncertainty/conflict is understandable without exposing internal model machinery;
- material answer claims lead to support;
- unsupported questions abstain honestly;
- historical and current state are visually distinguishable.

Recall should feel intelligent because it can show its memory, not because it performs AI theatrics.

## 11. Implementation principle

Do not hard-code the canonical Brooks Campus mockup as a special screen.

Build reusable primitives driven by Recall's actual memory model, for example:

- `MemorySurface`
- `GlassBoard`
- `FocusBoard`
- `EvidenceArtifact`
- `Reconstruction`
- `ContextBoard`
- `TimelineBoard`
- `AskSurface`
- `CaptureSurface`
- `CorrectionSurface`
- `DepthTransition`

Names are illustrative, not mandated architecture. Reuse existing components/contracts where they already express these responsibilities.

The first implementation should prove the vertical slice before creating a large component library or broad redesign.

## 12. Acceptance bar for the design

The canonical experience is successful when:

- a new user can Ask or Capture without learning Recall's schema;
- Ask feels like reconstruction, not a search-results page;
- evidence is visually and interactively inseparable from trustworthy recall;
- selecting context feels like refocusing the same memory environment rather than navigating an admin application;
- historical/current state is understandable;
- the experience remains usable with reduced motion and assistive technology;
- mobile preserves the same mental model with one focused board at a time;
- the UI works with real canonical data and honest empty/loading/error/uncertain states;
- screenshots are visually distinctive enough that Recall cannot be mistaken for a generic notes or AI-chat application.

## 13. Canonical phrase

The product loop remains:

**CAPTURE · UNDERSTAND · CONNECT · REMEMBER · RECALL · ACT**

The experience-level rule beneath it is:

> **Evidence underneath. Understanding above it. Memory moves through depth.**
