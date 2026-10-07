/* global window, performance, requestAnimationFrame, PerformanceObserver */
import process from "node:process";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const browser = await chromium.launch({
  executablePath: process.env.RECALL_CHROMIUM || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://127.0.0.1:5173/?fixture=memory-surface");
await page
  .getByLabel("What do you need to remember?", { exact: true })
  .waitFor();
await page.evaluate(() => {
  const samples = { frames: [], tasks: [], running: true };
  window.recallMeasurement = samples;
  let last = performance.now();
  const frame = (now) => {
    if (!samples.running) return;
    samples.frames.push(now - last);
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) samples.tasks.push(entry.duration);
  }).observe({ type: "longtask", buffered: false });
});
await page
  .getByLabel("What do you need to remember?", { exact: true })
  .fill("What do you know about Brooks Campus?");
await page.getByRole("button", { name: "Ask Recall", exact: true }).click();
await page
  .getByRole("button", { name: /Focus memory/ })
  .first()
  .click();
await page.getByRole("button", { name: "Inspect original · page 1" }).click();
await page.getByText("Verified original", { exact: true }).waitFor();
await page.getByRole("button", { name: "Back", exact: true }).click();
await page
  .getByRole("button", { name: "Focus Mara Chen", exact: true })
  .click();
await page.getByRole("heading", { name: "Mara Chen", exact: true }).waitFor();
const results = await page.evaluate(() => {
  const data = window.recallMeasurement;
  data.running = false;
  const frames = data.frames.sort((a, b) => a - b);
  return {
    frames: frames.length,
    frameP50Ms: frames[Math.floor(frames.length * 0.5)],
    frameP95Ms: frames[Math.floor(frames.length * 0.95)],
    longestFrameMs: frames.at(-1),
    longTaskCount: data.tasks.length,
    longestTaskMs: Math.max(0, ...data.tasks),
  };
});
const report = {
  measuredAt: new Date().toISOString(),
  environment:
    "Headless system Chromium, 1440×1000, Vite development fixture; local automation, not device or production latency",
  ...results,
};
await writeFile(
  "docs/implementation/memory-surface/performance.json",
  JSON.stringify(report, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(report) + "\n");
await browser.close();
