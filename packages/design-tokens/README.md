# Shared design tokens

Platform-neutral token names, scales, semantic capture statuses and user-facing copy used by mobile and desktop.

**Visual authority:** [MONOLITH guide](../../branding/monolith/v1/BRAND_GUIDE.md) and [DESIGN.md](../../docs/DESIGN.md), owner-selected 2026-10-17. Earlier boards and orbital/ivory identity are superseded. Preserve all working evidence and offline behavior.

**Implementation:** `src/index.ts` exports the approved palette, semantic contrast shades, spacing, radii, font names and capture-state language. `src/brand.css` supplies the same palette and self-hosted fonts to both the desktop stylesheet and the Rust phone page (embedded at compile time). A token regression checks palette parity between CSS and TypeScript. SVG masters and licensed fonts live in `apps/desktop/public/brand` and `apps/desktop/public/fonts`; the phone serves those same bytes locally. Neither interface needs a font CDN or network connection to render its identity.

RCL-002 adds reading states, shown only when AI reading is on: **Uploaded · waiting to be read**, **Reading…**, **Ready**, **Ready · check details**, **Couldn't read · original is safe** (`serverStatusKey` maps server status + processing to these). RCL-001 statuses: **Saved on this device**, **Uploading**, **Uploaded**, **Failed — retry available** (plus **Upload incomplete** for a server capture whose pages have not all arrived). Each has a text label and a non-color glyph.

React Native and desktop DOM components stay separate; they share these names and words, not components. Frozen cloud-era consumers are not the current product or a visual reference.
