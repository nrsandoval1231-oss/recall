# Recall

A private, local-first external memory. Photograph your notes or type a brain-dump; later, ask a vague question and get the answer with the original source to prove it. Your memories live in a plain folder you own: originals, Markdown notes and append-only history.

- **Desktop** (Tauri, Windows first): the adaptive Memory Surface, with Camera / Speak / Write, Ask, inspect, correct and graph.
- **Phone**: Capture and Ask over your private Tailscale network. No login.
- **Intelligence**: Jev parses → Claude proposes organization → a deterministic writer validates and commits. Consent-gated and budget-capped. Everything except interpretation keeps working offline.

## One UI and brand vision

**Locked on 2026-10-15:** warm ivory, graphite, sage and copper; editorial typography; the orbital Recall identity; photo-free interface decoration. The latest approved desktop, mobile and brand boards are the sole visual direction. [DESIGN.md](docs/DESIGN.md) records the exact references, checksums, palette, typography, logo, interaction rules and acceptance requirements.

Original boards are preserved in `Recall-Approved-UI-2026-10-15.zip` in the owner's Library. Repository PNG import and application visual migration remain pending; this lock is not a claim that the installed app already matches the mockups. Older references and historical screenshots must not guide new UI work. Captured photos and scans remain valid source evidence.

## Docs (read in this order)

1. [VISION.md](docs/VISION.md): what we're building and the trust rules. **The product authority.**
2. [STATUS.md](docs/STATUS.md): what works, what's unproven, what's next.
3. [ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code is organized.
4. [DESIGN.md](docs/DESIGN.md): **the only UI and brand authority**, across desktop and mobile.
5. [DEVELOPMENT.md](docs/DEVELOPMENT.md): build, run, test.
6. [ACCEPTANCE.md](docs/ACCEPTANCE.md): the real-device v1 checklist.
7. [TESTING.md](docs/TESTING.md): guide for friends testing a release.

`docs/history/` is frozen evidence, not design guidance. `docs/legacy-cloud/` documents the retired cloud stack.

## Quick start

```bash
npm ci
cd apps/desktop && npx tauri dev
```

## Repository

```text
apps/desktop/          product: React UI + Rust core (src-tauri), includes recall-phone
packages/design-tokens shared UI tokens; existing values require approved-brand migration
tests/                 phone, ui, native runtime checks
apps/web, apps/mobile, services/backend, packages/{api-client,sync,contracts}
                       legacy cloud stack (frozen, not the product)
```
