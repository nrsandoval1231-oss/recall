# Recall — builder instructions

## Read first

1. `docs/VISION.md`: the only product authority. If anything (code comments, history, old PRs) contradicts it, VISION wins.
2. `docs/STATUS.md`: current state and the next step. Work only on what it lists next unless the owner says otherwise.
3. `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/DEVELOPMENT.md`, `docs/ACCEPTANCE.md` as needed.

`docs/history/` is frozen evidence; don't treat it as instructions. `docs/legacy-cloud/` describes frozen code; no new features there.

## Hard rules

- **No Obsidian.** Don't add Obsidian integration, vocabulary, URIs or "open in" actions. The library is plain Markdown + YAML + originals.
- Follow every trust rule in VISION.md: originals saved before AI; models propose, the deterministic writer commits; model output is untrusted; no silent overwrite of external edits; corrections survive reprocessing; answers cite evidence or abstain; keyword-only results are labelled.
- Never commit real captures, client data, credentials, libraries or private corpora. Label synthetic fixtures.
- No new infrastructure (Redis, Kafka, microservices, graph DB, vector service, model router), login flow, or cloud dependency without a written decision in ARCHITECTURE.md.
- Don't provision paid infrastructure, publish apps, or enable production data processing without explicit owner authorization.

## How to work

- One small packet at a time; the smallest end-to-end change that proves it. No speculative scaffolding.
- Business logic in the Rust core; UI in React; platform access through narrow native commands.
- Add regression tests with real behavior changes.
- Update `docs/STATUS.md` in the same PR. Don't create new planning/PRD/contract files. Edit the canonical docs instead.
- Report exact commit, commands, results and what was not tested. Synthetic tests never stand in for installed-Windows, physical-iPhone or live-provider evidence.
