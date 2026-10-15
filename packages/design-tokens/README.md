# Shared design tokens

Platform-neutral token names, scales, semantic capture statuses and user-facing copy used by mobile and desktop.

**UI and brand approved on 2026-10-15:** [docs/DESIGN.md](../../docs/DESIGN.md) is the sole authority. Use the final photo-free desktop/mobile/brand boards, the orbital identity, Playfair Display / Inter and the approved ivory/graphite/sage/copper palette. The previous claim that no palette, logo or UI system had been approved is retired.

**Implementation status:** existing exported numeric values and colors have not yet been migrated to that identity. They are compatibility implementation, not an alternative design system. Migrate consumers and actual foreground/background pairs together, preserving contrast tests, semantic state labels, non-color indicators and capture behavior. Do not assume changing shared tokens alone updates the desktop's independent stylesheet or the phone companion.

RCL-002 adds reading states, shown only when AI reading is on: **Uploaded · waiting to be read**, **Reading…**, **Ready**, **Ready · check details**, **Couldn't read · original is safe** (`serverStatusKey` maps server status + processing to these). RCL-001 statuses: **Saved on this device**, **Uploading**, **Uploaded**, **Failed — retry available** (plus **Upload incomplete** for a server capture whose pages have not all arrived). Each has a text label and a non-color glyph.

React Native and desktop DOM components stay separate; they share these names and words, not components. Frozen cloud-era consumers are not the current product or a visual reference.
