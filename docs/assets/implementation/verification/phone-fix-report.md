# Phone review fixes

Commit: `dfa8022` (`fix(phone): focus navigated views and enlarge evidence targets`).

- Receipt direct links, inferred source anchors, legacy main original link and new `.source-action` have 48px minimum height. Adjacent direct receipt links receive 8px separation.
- Each hashchange focuses the visible page heading with temporary tabindex=-1, removed on blur. Covers card/nav/back controls, save-to-receipts, browser back and forward. Initial page loading retains default browser focus. No inputs focused or form data changed.
- Added real native-server Chromium keyboard tests checking Enter navigation, heading focus, subsequent Tab, save receipt focus and browser history. Added bounding-box target/separation tests for live receipts and native original evidence, plus synthetic inferred support DOM matching the server-rendered structure (no graph/provider used).
- `.memory-text { white-space: pre-wrap }` supports root's native memory-detail presentation.
- Preserved root's existing uncommitted shared-brand CSS changes; only own CSS hunks committed.

Exact checks:

1. `npx prettier --write apps/desktop/src-tauri/src/phone/ui.js tests/phone/offline.spec.ts` — exit 0. Existing test formatting churn subsequently reverted; appended tests only retained.
2. `npx eslint apps/desktop/src-tauri/src/phone/ui.js tests/phone/offline.spec.ts` — exit 0; warning that ui.js is excluded by existing lint config.
3. `git diff --cached --check` — exit 0.
4. `npx eslint tests/phone/offline.spec.ts` — exit 0.
5. Root rebuilt native binary, reported exit 0; this agent did not invoke Cargo.
6. `env LD_LIBRARY_PATH=/tmp/recall-sysroot/usr/lib/x86_64-linux-gnu RECALL_CHROMIUM=/usr/bin/chromium npm run test:phone` — exit 0, **14 passed (31.7s)**. Includes all prior twelve phone regressions plus two added tests.
7. `git diff --cached --check` — exit 0 immediately before commit.
8. `git commit -m "fix(phone): focus navigated views and enlarge evidence targets"` — exit 0, commit dfa8022.

Not tested: physical iPhone, installed app/virtual keyboard behavior, real Tailscale connection, assistive technology announcements, live providers. Browser focus assertions confirm focus goes to a noneditable heading, not an input.
