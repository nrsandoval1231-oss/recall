/* global window, document, getComputedStyle, TextEncoder */
// Explicitly synthetic source records exercise the real graph derivation and shell.
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
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
const rows = (process.env.RECALL_DENSE ? Array.from({length: 200}, (_, i) => `Synthetic memory ${i + 1}`) : names).map((name, i) => ({
  id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
  state: "active",
  revision: 1,
  note_path: `synthetic-${i}.md`,
  note: `---\ntitle: "${name}"\n---\n\nSYNTHETIC TEST DATA ONLY. ${name}. ${i > 0 ? "[[Recall/Memories/synthetic-0.md]]" : ""}`,
  source_name: `synthetic-${i}.txt`,
  source_sha256: createHash("sha256").update("SYNTHETIC source evidence").digest("hex"),
  captured_at: "2026-10-15T09:00:00Z",
  updated_at: "2026-10-15T09:00:00Z",
  conflict: null,
}));
const results = [];
try {
  for (const [width, height, density = 1] of [
    [Number(process.env.RECALL_UI_WIDTH || 1536), Number(process.env.RECALL_UI_HEIGHT || 1024)],

  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: density,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    await page.addInitScript((rows) => {
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd) => {
          if (cmd === "vault_source") return { bytes: Array.from(new TextEncoder().encode("SYNTHETIC source evidence")), mime_type: "text/plain", sha256: rows[0].source_sha256 };
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
    await page.screenshot({path: path.join(output, `${process.env.RECALL_DENSE ? "dense" : "graph"}-home.png`)});
    await page.getByRole("button", { name: "Graph View", exact: true }).click();
    const shot = async (state) => page.screenshot({path: path.join(output, `${process.env.RECALL_DENSE ? "dense" : "graph"}-${state}.png`)});
    await shot("default");
    const node = page.locator(".graph-node").first();
    await node.hover({force: true});
    await page.waitForTimeout(350);
    await shot("hover");
    await node.focus();
    await shot("focus");
    await page.keyboard.press("Enter");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(350);
    await shot("selected-inspector");
    // The actual shell hides the mounted graph during inspection. Reveal only
    // for an explicitly labelled renderer-state capture; do not change app flow.
    const reveal = await page.addStyleTag({content: '.adaptive[data-inspector="true"] .ms-memory-field { display: flex !important; } .adaptive-inspector { display: none !important; }'});
    await shot("selected-renderer");
    await reveal.evaluate(el => el.remove());
    if (!process.env.RECALL_RECORD_BASELINE) {
      const selected = page.locator('.graph-node[aria-pressed="true"]');
      if (await selected.count() !== 1) throw Error("Selection is not exposed");
      const opacity = await selected.locator(".node-light").evaluate(el => getComputedStyle(el).opacity);
      if (Number(opacity) !== 1) throw Error(`Selected opacity: ${opacity}`);
      await page.emulateMedia({reducedMotion: "reduce"});
      const duration = await selected.locator(".node-light").evaluate(el => getComputedStyle(el).transitionDuration);
      if (duration !== "0s") throw Error("Reduced motion not honored");
    }
    await page.keyboard.press("Escape");
    const svg = page.getByRole("group", {name: "Vault memory graph"});
    const transform = () => svg.locator(":scope > g").getAttribute("transform");
    const initial = await transform();
    await page.getByRole("button", {name: "Zoom in"}).click();
    if (await transform() === initial) throw Error("Zoom did not update viewport");
    await svg.focus();
    await page.keyboard.press("ArrowRight");
    const beforePan = await transform();
    const box = await svg.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 50, box.y + 40);
    await page.mouse.up();
    if (await transform() === beforePan) throw Error("Pointer pan failed");
    await page.getByRole("button", {name: "Reset view"}).click();
    if (await transform() !== initial) throw Error("Reset did not restore viewport");
    await page.getByRole("button", {name: "Relationship list"}).click();
    await page.getByRole("region", {name: "Graph relationship list"}).waitFor();
    await page.getByRole("button", {name: "Relationship list"}).click();
    const axe = await new AxeBuilder({ page }).analyze();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    await page.screenshot({
      path: path.join(output, `${process.env.RECALL_DENSE ? "dense" : "graph"}-verified.png`),
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
  path.join(output, `${process.env.RECALL_DENSE ? "dense" : "graph"}-verification.json`),
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
