# Shared design tokens

Platform-neutral token names, scales, semantic capture statuses, and user-facing copy used by mobile and desktop. **Provisional**: no final palette, logo, or UI system has been approved; values are plain and WCAG-AA-checked (`tokens.test.ts`), not a brand.

RCL-002 adds reading states, shown only when AI reading is on: **Uploaded · waiting to be read**, **Reading…**, **Ready**, **Ready · check details**, **Couldn't read · original is safe** (`serverStatusKey` maps server status + processing to these). RCL-001 statuses: **Saved on this device**, **Uploading**, **Uploaded**, **Failed — retry available** (plus **Upload incomplete** for a server capture whose pages have not all arrived). Each has a text label and a non-color glyph.

React Native and desktop DOM components stay separate; they share these names and words, not components.
