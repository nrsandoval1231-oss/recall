# MONOLITH

A private, local-first external memory. Photograph your notes or type a brain-dump; later, ask a vague question and get the answer with the original source to prove it. Your memories live in a plain folder you own: originals, Markdown notes and append-only history.

- **Desktop** (Tauri, Windows first): the adaptive Memory Surface, with Camera / Speak / Write, Ask, inspect, correct and graph.
- **Phone/web**: authenticated PWA cloud checkpoint plus the existing private companion; optional Windows cloud mode preserves independent local libraries. See STATUS for incomplete synchronization/processing gates.
- **Intelligence**: Jev parses → Claude proposes organization → a deterministic writer validates and commits. Consent-gated and budget-capped. Everything except interpretation keeps working offline.

## One UI and brand vision

**MONOLITH — Your world. Connected.** The [source guide and M assets](branding/monolith/v1/BRAND_GUIDE.md) are canonical by owner instruction on 2026-10-17. [DESIGN.md](docs/DESIGN.md) applies the smoky-glass black/gray identity, Sora/Inter and accessibility/evidence rules. Earlier Recall boards and MeGraph branding are superseded. Working capture, inspection, corrections, provider settings and offline behavior are preserved.

## Docs (read in this order)

1. [VISION.md](docs/VISION.md): what we're building and the trust rules. **The product authority.**
2. [STATUS.md](docs/STATUS.md): what works, what's unproven, what's next.
3. [ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code is organized.
4. [DESIGN.md](docs/DESIGN.md): **the only UI and brand authority**, across desktop and mobile.
5. [DEVELOPMENT.md](docs/DEVELOPMENT.md): build, run, test.
6. [ACCEPTANCE.md](docs/ACCEPTANCE.md): the real-device v1 checklist.
7. [TESTING.md](docs/TESTING.md): guide for friends testing a release.

`docs/history/` is frozen evidence, not design guidance. `docs/legacy-cloud/` is historical documentation; the backend is reused by the active cloud checkpoint.

## Quick start

```bash
npm ci
cd apps/desktop && npx tauri dev
```

## Repository

```text
apps/desktop/          product: React UI + Rust core (src-tauri), includes recall-phone
packages/design-tokens shared approved palette, typography, spacing and semantic UI tokens
tests/                 phone, ui, native runtime checks
apps/web, apps/mobile, services/backend, packages/{api-client,sync,contracts}
                       backend reused by cloud checkpoint; historical web/mobile clients
```
