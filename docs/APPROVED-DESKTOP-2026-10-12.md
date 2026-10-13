# Recall — Approved desktop mockup (2026-10-12)

Status: **Owner-approved visual target.** This supersedes the earlier desktop composition where they differ. Preserve the established Obsidian-first product architecture and all source integrity controls. Do not merge PR #26 into this work.

## Reference handoff

The owner approved the generated desktop screenshot in the ChatGPT conversation on 2026-10-12 with “That's the one!! Save it and make it look exactly like this.” The original image is retained as a conversation artifact named `a_wide_clean_polished_desktop_app_ui_mockup_in_w.png` (1536 × 1024). **The PNG has not yet been committed to GitHub.** Copy the original bytes to `docs/assets/recall-desktop-approved-2026-10-12.png` before visual implementation; do not regenerate or replace it with an approximation. Once committed, that image is the visual acceptance authority.

## Pixel-fidelity implementation contract

- Desktop window: warm ivory background, restrained ambient gradient, thin subtle chrome, charcoal navigation rail occupying about 15% of the width.
- Left rail: Recall wordmark/ring and subtitle; Home, Capture, Ask, Projects, Calendar, Follow-ups, Recent, Corrections; Settings and Help below. Selected item has a warm luminous inset treatment. No decorative photographic sidebar imagery in production.
- Header: broad rounded Ask input with search icon and keyboard shortcut; compact date/greeting on the right. Do not hardcode a user's name.
- Main: two-column content/right-sidebar grid. Main area includes editorial Projects heading, 3-column by 2-row project card grid, Recent Memories list, and bottom Capture action bar. Right area includes monthly Capture Calendar, Follow-ups, and a quiet editorial quotation card.
- Palette: charcoal #252421, ivory #F0E9DF, soft warm cream #E7DDD1, muted gold #B28B4D, taupe borders and shadows. Tune against actual screenshot, not these approximate swatches.
- Typography: elegant editorial serif for brand, headings and project titles; restrained readable sans-serif for controls and metadata.
- Project cards: rounded translucent warm glass, delicate shadows, warm focus outline, readable project name and small metadata. The generated image depicts atmospheric photos in some cards, but **do not add stock or invented imagery**: show only actual user-authorized vault image evidence, otherwise render abstract tonal treatments.
- Recent Memories: compact stacked rows with source-type icon, title, brief evidence-based summary, timestamp, chevron. Do not invent entries.
- Calendar: actual capture dates; distinguish captured memories from scheduled obligations. Follow-ups must be explicitly unscheduled unless real due-date evidence exists.
- Capture bar: paste/drop, record, add photo, add file. Disable or label unsupported capture modes truthfully rather than faking them.
- Right quotation card may use abstract tonal background, never a photographic stock image.

## Interaction contract

- Hover: 120–160ms subtle elevation/edge response. Focus: visible keyboard focus; never hover-only.
- Project selection changes focused board without discarding scroll/context. Memory opens an in-place inspection layer with original evidence and organized note together.
- Ask returns source-backed answers with visible source access and honest uncertainty; keyword retrieval is never labeled AI synthesis.
- Capture acknowledges durable original save before interpreting; processing, needs-review, ready, failure, and retry states remain truthful and recoverable.
- Calendar month navigation, list filtering, capture dropzone, corrections and back navigation work by keyboard and mouse.
- Reduced motion is respected; responsive widths reflow instead of clipping. No mock people, notes, projects, dates or counts in production.

## Acceptance

1. Commit original approved PNG to the path above; verify bytes/dimensions.
2. Produce installed Windows app screenshots at 1536×1024, 1182×789 and 900×700, compare side-by-side with approved image, record discrepancies and repair them.
3. Verify navigation, memory inspect, Ask, capture, correction, calendar, focus, keyboard, reduced motion and empty-vault states against actual native IPC, not solely synthetic browser fixtures.
4. Run desktop tests, lint, typecheck, production build and exact-head CI. No modifications to Jev/Claude provider boundaries or native Obsidian writer for visual polish.

The screenshot is an appearance target, not evidence that its illustrative projects or features already exist.
