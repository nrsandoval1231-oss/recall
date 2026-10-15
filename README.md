# Recall

A private, local-first external memory. Photograph your notes or type a brain-dump; later, ask a vague question and get the answer with the original source to prove it. Your memories live in a plain folder you own: originals, Markdown notes and append-only history.

- **Desktop** (Tauri, Windows first): the adaptive Memory Surface, with Camera / Speak / Write, Ask, inspect, correct and graph.
- **Phone**: Capture and Ask over your private Tailscale network. No login.
- **Intelligence**: Jev parses → Claude proposes organization → a deterministic writer validates and commits. Consent-gated and budget-capped. Everything except interpretation keeps working offline.

## Docs (read in this order)

1. [VISION.md](docs/VISION.md): what we're building and the rules. **The one authority.**
2. [STATUS.md](docs/STATUS.md): what works, what's unproven, what's next.
3. [ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code is organized.
4. [DESIGN.md](docs/DESIGN.md): the desktop UI.
5. [DEVELOPMENT.md](docs/DEVELOPMENT.md): build, run, test.

`docs/history/` is frozen evidence. `docs/legacy-cloud/` documents the retired cloud stack.

## Quick start

```bash
npm ci
cd apps/desktop && npx tauri dev
```

## Repository

```text
apps/desktop/          product: React UI + Rust core (src-tauri), includes recall-phone
packages/design-tokens shared UI tokens
tests/                 phone, ui, native runtime checks
apps/web, apps/mobile, services/backend, packages/{api-client,sync,contracts}
                       legacy cloud stack (frozen, not the product)
```
