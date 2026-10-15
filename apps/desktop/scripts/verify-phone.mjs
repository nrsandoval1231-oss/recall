/* global document, window */
// Browser evidence against the running native companion; synthetic library only.
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
const output = path.resolve(
  process.env.RECALL_PHONE_EVIDENCE_DIR || "test-results/phone-visual",
);
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.RECALL_CHROMIUM || "/usr/bin/chromium",
});
const results = [];
try {
  for (const [width, height] of [
    [390, 844],
    [430, 932],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.RECALL_PHONE_URL || "http://127.0.0.1:18788");
    await page
      .getByTestId("connection-state")
      .filter({ hasText: "Connected to library" })
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    const shot = async (name) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      const axe = await new AxeBuilder({ page }).analyze();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      await page.screenshot({
        path: path.join(output, `phone-${name}-${width}.png`),
      });
      results.push({
        state: name,
        width,
        overflow,
        violations: axe.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        errors: [...errors],
      });
    };
    await shot("home");
    await page.getByRole("button", { name: /Speak/ }).click({ force: true });
    await page
      .getByText(
        "Voice capture is unavailable in this build. Use Camera or Write.",
      )
      .waitFor();
    await page.getByRole("link", { name: /Write In your words/ }).click();
    await page
      .getByLabel("Note, in your words")
      .fill(
        "A quiet afternoon.\n\nSYNTHETIC TEST DATA: The meeting date is uncertain.",
      );
    await shot("write");
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await page.getByRole("link", { name: /Camera Keep an original/ }).click();
    if (
      !(await page.getByLabel("Note, in your words").inputValue()).includes(
        "SYNTHETIC",
      )
    )
      throw Error("Draft lost during navigation");
    await shot("camera");
    await page
      .getByRole("button", { name: "Save capture", exact: true })
      .click();
    await page
      .getByTestId("outbox")
      .filter({ hasText: "Received by library" })
      .waitFor();
    await shot("receipts");
    await page
      .getByRole("link", { name: "· Inspect in library" })
      .last()
      .click();
    await page
      .getByText("Saved in the desktop vault", { exact: true })
      .waitFor();
    await shot("detail");
    await page.getByRole("link", { name: "Recall home" }).click();
    await page.getByRole("link", { name: "Ask", exact: true }).click();
    await shot("ask");
    await page.getByLabel("Ask the notes").fill("quiet afternoon");
    await page.getByRole("button", { name: "Search notes" }).click();
    await page
      .getByText(/SYNTHETIC TEST DATA/)
      .first()
      .waitFor();
    await shot("results");
    await context.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(
    path.join(output, "phone-verification.json"),
    JSON.stringify(
      {
        kind: "Synthetic browser against native Linux phone server. Not physical iPhone/Tailscale evidence.",
        results,
      },
      null,
      2,
    ),
  );
}
if (results.some((r) => r.overflow || r.violations.length || r.errors.length))
  throw Error(
    JSON.stringify(
      results.filter(
        (r) => r.overflow || r.violations.length || r.errors.length,
      ),
    ),
  );
process.stdout.write(JSON.stringify(results) + "\n");
