/* global window, document */
// Explicitly synthetic source records exercise the real graph derivation and shell.
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
const output = path.resolve(
  process.env.RECALL_UI_EVIDENCE_DIR || "test-results/canonical",
);
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.RECALL_CHROMIUM || "/usr/bin/chromium",
});
const names = [
  "Sunday journal",
  "Family notes",
  "Walk by the river",
  "An idea to keep",
  "Project conversation",
  "A small discovery",
];
const rows = names.map((name, i) => ({
  id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
  state: "active",
  revision: 1,
  note_path: `synthetic-${i}.md`,
  note: `---\ntitle: "${name}"\n---\n\nSYNTHETIC TEST DATA ONLY. ${name}. ${i > 0 ? "[[Recall/Memories/synthetic-0.md]]" : ""}`,
  source_name: `synthetic-${i}.txt`,
  source_sha256: "a".repeat(64),
  captured_at: "2026-10-15T09:00:00Z",
  updated_at: "2026-10-15T09:00:00Z",
  conflict: null,
}));
const results = [];
try {
  for (const [width, height, density = 1] of [
    [1536, 1024],
    [1182, 789],
    [900, 640],
    [390, 844],
    [430, 932],
    [900, 640, 2],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: density,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.addInitScript((rows) => {
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd) => {
          if (cmd === "vault_status")
            return {
              root: "SYNTHETIC browser fixture",
              vault_id: "test",
              vault_identity: "11111111-1111-4111-8111-111111111111",
            };
          if (cmd === "vault_list") return rows;
          if (cmd === "librarian_status")
            return {
              ready: false,
              reason: "Synthetic fixture; no providers",
              model: null,
            };
          throw Error("Unavailable in synthetic fixture: " + cmd);
        },
      };
    }, rows);
    await page.goto(process.env.RECALL_UI_URL || "http://127.0.0.1:1420");
    await page
      .getByRole("heading", { name: "Everything is connected." })
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    const axe = await new AxeBuilder({ page }).analyze();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    await page.screenshot({
      path: path.join(output, `populated-${width}${density === 2 ? "-2x" : ""}.png`),
    });
    results.push({
      width,
      overflow,
      violations: axe.violations.map((v) => v.id),
      sources: rows.length,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(
  path.join(output, "populated-verification.json"),
  JSON.stringify(
    {
      kind: "SYNTHETIC browser IPC sources and explicit source links, not user data.",
      results,
    },
    null,
    2,
  ),
);
if (results.some((r) => r.overflow || r.violations.length))
  throw Error(JSON.stringify(results));
process.stdout.write(JSON.stringify(results) + "\n");
