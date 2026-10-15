# Recall — Development

How to build, run and test the product (desktop + phone). The frozen cloud-era setup is in [legacy-cloud/DEVELOPMENT.md](legacy-cloud/DEVELOPMENT.md).

## Prerequisites

- Node ≥ 22, Rust stable.
- Windows: MSVC build tools + WebView2. Linux: GTK/WebKit dev libraries for Tauri.

```bash
npm ci                      # once, from the repo root
```

## Desktop

```bash
cd apps/desktop
npm run dev                 # browser preview only: synthetic fixture, cannot write a library
npx tauri dev               # real app: choose a folder or "Use default library" (Documents/Recall)
npx tauri build             # NSIS installer (unsigned)
```

`RECALL_VAULT_DIR=<absolute path>` sends the default-library command to another folder. The library layout is in [ARCHITECTURE.md](ARCHITECTURE.md#the-recall-library-on-disk).

### Turning on Jev + Claude

Models are off until a key, model, prices and budget caps are configured. The normal way is **Settings → AI providers**, which saves them in the OS credential store (service `app.recall.desktop.providers`); the webview can save or clear them but only ever sees a masked key. Environment variables still work as a fallback, and a saved value wins over the environment. Never put keys in `VITE_` variables, the webview or a committed file.

```bash
export RECALL_CLAUDE_API_KEY=...            # never commit
export RECALL_CLAUDE_MODEL=claude-sonnet-5-5
export RECALL_CLAUDE_INPUT_USD_PER_MTOK=... # use current published prices
export RECALL_CLAUDE_OUTPUT_USD_PER_MTOK=...
export RECALL_CLAUDE_DAILY_BUDGET_USD=2
export RECALL_CLAUDE_MONTHLY_BUDGET_USD=20
# Jev: TYPESAFE_API_KEY, RECALL_JEV_MODEL, RECALL_JEV_INPUT_USD_PER_MTOK, RECALL_JEV_DAILY_BUDGET_USD, RECALL_JEV_MONTHLY_BUDGET_USD
```

Processing runs only after per-source consent. A spent budget, missing price or uncertain provider outcome is shown as such and never silently retried. Optional Graphiti: `RECALL_GRAPH_URL`, `RECALL_GRAPH_TOKEN`.

## Phone companion

```bash
cd apps/desktop && npm run phone        # = cargo run --bin recall-phone
cargo build --release --bin recall-phone   # from src-tauri
```

- Uses `RECALL_VAULT_DIR`, or the library the desktop last selected. It never creates a second library.
- Binds the Tailscale IPv4 (`tailscale ip -4`) on port 8787, or `RECALL_PHONE_PORT`. `RECALL_PHONE_BIND=tailscale|loopback|<ip>`. All interfaces requires both `RECALL_PHONE_ALLOW_ALL_INTERFACES=1` and `RECALL_PHONE_BIND=0.0.0.0`; don't do that on an untrusted network.
- On the iPhone (Tailscale connected): open `http://<tailscale-ip>:8787/` in Safari. Add to Home Screen is optional.
- Windows firewall: allow the port on the Tailscale adapter only. Never port-forward.
- No login: a Tailscale ACL is the access boundary. Cross-site requests are refused. The phone never calls a model; captures queue for desktop processing.
- Gaps: plain HTTP (no TLS); not yet tested on a physical iPhone.

## Tests

```bash
npm run check                                    # lint + typecheck + all TS tests
cd apps/desktop/src-tauri && cargo test --locked --lib   # native core (needs GTK/WebKit on Linux)
npm run test:phone                               # phone page (Playwright)
npm run test:visual -w @recall/desktop           # UI screenshots; run `npm run dev -w @recall/desktop -- --host 127.0.0.1 --port 4173 --strictPort` first
```

Browser and visual tests use explicitly synthetic native IPC. They are not proof of native persistence, live providers or installed Windows behavior. Record real-device results in [STATUS.md](STATUS.md).

## CI

`.github/workflows/ci.yml` runs TS checks, Playwright, native Rust tests on Linux and Windows, the Windows installer artifact, and the legacy backend suite. An Actions artifact is not installed-app acceptance.

## Tester releases

Pushing a tag like `v0.1.0-beta.1` runs `.github/workflows/release.yml`: native tests, then the unsigned NSIS installer attached to a public GitHub pre-release. Tag only builds the owner has approved for testers. Tester instructions: [TESTING.md](TESTING.md).
