# Canonical desktop UI implementation

Reference: docs/assets/recall-desktop-canonical-2026-10-11.png, 1182×789. Preserve native capture/provider/consent/revision behavior and source identity.

Match composition: 186px navigation rail; 18px main inset; 148px context, flexible 528px center, 254px calendar at reference viewport; 14px gaps; top Ask and chips; project board above recent notes; four bottom actions. Use supplied brand image and matching Phosphor line icons, generated decorative workspace image, Georgia display typography and Segoe UI body. At larger desktop widths scale proportions; at smaller sizes stack without hiding core controls.

Implementation: reshape existing surface, render safe Markdown, keep source-scoped unresolved context, actual capture calendar and explicitly unscheduled source follow-ups. No invented user identities, events or dates. Reference content available only as labeled design fixture.

Verify existing workflow tests and new Markdown/security/navigation/calendar regressions, browser screenshots at1182×789/1536×1024/compact, interaction and console checks, independent review, exact-head CI and Windows installer. Save design-qa.md with comparisons and truthful limits.
