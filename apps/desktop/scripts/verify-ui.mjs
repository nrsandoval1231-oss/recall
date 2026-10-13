/* global process, window, document, innerWidth, TextEncoder */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.resolve(
  process.env.RECALL_UI_EVIDENCE_DIR || path.join(repo, "docs/audits/ui"),
);
fs.mkdirSync(output, { recursive: true });
const uiUrl = process.env.RECALL_UI_URL || "http://127.0.0.1:4173/";
const launchOptions = process.env.RECALL_CHROMIUM
  ? { executablePath: process.env.RECALL_CHROMIUM }
  : {};
// UI fixtures below emulate IPC only. They never prove native persistence or live inference.
const source =
  "Brad says maybe 5–10 MW? Utility late. Call Sarah. Need generators by Dec? Prism doing electrical? Site access north? Ask operator about gas. Crossed out: 8 MW confirmed.";
const sha = createHash("sha256").update(source).digest("hex");
const id = "11111111-1111-4111-8111-111111111111";
const note = `---\nrecall_id: "${id}"\ntitle: "Utility meeting"\n---\n\n# Utility meeting\n\n## Observations (source statements)\n\n- “Utility late.” — source bytes 27–40\n\n## Follow-ups (not confirmed commitments)\n\n- [ ] “Call Sarah.” — source bytes 41–52\n\n## Unresolved entity mentions\n\n- “Brad” — person candidate; identity unresolved\n- “Sarah” — person candidate; identity unresolved\n- “north” — location candidate; identity unresolved\n\n## Open questions and uncertainty\n\n- “Need generators by Dec?”\n`;
(async () => {
  const browser = await chromium.launch({ ...launchOptions });
  const results = [];
  for (const [w, h] of [
    [1182, 789],
    [1536, 1024],
    [900, 700],
    [390, 844],
  ]) {
    const page = await browser.newPage({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto(uiUrl + "?design=canonical");
    await page.waitForTimeout(100);
    await page.screenshot({
      type: "jpeg",
      quality: 92,
      path: path.join(output, `reference-${w}.jpg`),
    });
    if (await page.evaluate(() => document.body.scrollWidth > innerWidth))
      throw new Error(`Overflow at${w}`);
    results.push({ viewport: [w, h], errors });
    await page.close();
  }
  const nativeContext = await browser.newContext({
    viewport: { width: 1182, height: 789 },
    deviceScaleFactor: 1,
  });
  const page = await nativeContext.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.addInitScript(
    ({ id, source, sha, note }) => {
      let row = {
        id,
        state: "active",
        revision: 2,
        note_path: id + ".md",
        note,
        source_name: "meeting.txt",
        source_sha256: sha,
        captured_at: "2026-10-12T12:00:00Z",
        updated_at: "2026-10-12T12:00:00Z",
        conflict: null,
      };
      window.__calls = [];
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          window.__calls.push({ cmd, args });
          if (cmd === "vault_status")
            return {
              root: "Synthetic UI test vault",
              vault_id: "test-session",
              vault_identity: id,
            };
          if (cmd === "vault_list") return [row];
          if (cmd === "librarian_status")
            return {
              ready: false,
              reason: "Providers disabled in browser UI test",
              model: null,
            };
          if (cmd === "vault_source")
            return {
              bytes: Array.from(new TextEncoder().encode(source)),
              mime_type: "text/plain",
              sha256: sha,
            };
          if (cmd === "vault_correct") {
            row = { ...row, revision: row.revision + 1, note: args.note };
            return row;
          }
          if (cmd === "memory_ask")
            return {
              question: args.question,
              message:
                "Source-backed matches; synthetic browser bridge fixture.",
              hits: [
                {
                  memory_id: id,
                  revision: row.revision,
                  note_basename: id + ".md",
                  current_excerpt: row.note,
                  original_excerpt: source,
                  source_sha256: sha,
                  mime_type: "text/plain",
                },
              ],
            };
          throw Error("Forbidden in UI test: " + cmd);
        },
      };
    },
    { id, source, sha, note },
  );
  await page.goto(uiUrl + "?design=canonical");
  await page
    .getByRole("heading", { name: "Utility meeting", exact: true })
    .waitFor();
  if (await page.getByText(/Design preview|Synthetic demo/).count())
    throw Error("Design fixture leaked into native mode");
  await page.screenshot({
    type: "jpeg",
    quality: 92,
    path: path.join(output, "native-fixture-home.jpg"),
  });
  await page
    .getByRole("button", {
      name: "Open original: Utility meeting",
      exact: true,
    })
    .click();
  await page
    .getByText("Hash matches the vault record. Original bytes are unchanged.")
    .waitFor();
  await page
    .getByRole("heading", { name: "Observations (source statements)" })
    .waitFor();
  await page.screenshot({
    type: "jpeg",
    quality: 92,
    path: path.join(output, "native-fixture-evidence.jpg"),
  });
  await page
    .getByLabel("Your correction")
    .fill("# Utility meeting\n\nHuman correction: deadline remains unknown.");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await page.getByText(/original source is unchanged/).waitFor();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page
    .getByRole("searchbox")
    .fill("What was going on with that utility delay?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByRole("heading", { name: "Source-backed matches" }).waitFor();
  await page.getByText(source, { exact: true }).waitFor();
  await page.screenshot({
    type: "jpeg",
    quality: 92,
    path: path.join(output, "native-fixture-search.jpg"),
  });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Vault settings" }).waitFor();
  await page.keyboard.press("Escape");
  if (await page.getByRole("dialog").count())
    throw Error("Escape did not close settings");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByLabel("Optional note").fill("Messy source?");
  if (await page.getByLabel(/Send this saved source/).isChecked())
    throw Error("Capture consent was preselected");
  const calls = await page.evaluate(() => window.__calls);
  if (calls.some((x) => /processing_|meeting_|librarian_read/.test(x.cmd)))
    throw Error("UI test made a provider request");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const axe = await new AxeBuilder({ page }).analyze();
  fs.writeFileSync(
    path.join(output, "browser-smoke.json"),
    JSON.stringify(
      {
        kind: "Browser UI test with synthetic native IPC fixture, not live providers or native persistence",
        results,
        errors,
        calls,
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    JSON.stringify({
      results,
      errors,
      violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact })),
    }) + "\n",
  );
  const comparison = await browser.newPage({
    viewport: { width: 2364, height: 789 },
    deviceScaleFactor: 1,
  });
  const sourcePath = path.join(
    repo,
    "docs/assets/recall-desktop-canonical-2026-10-11.png",
  );
  await comparison.setContent(
    `<style>body{margin:0;display:flex}img{width:1182px;height:789px;flex:none}</style><img src="data:image/png;base64,${fs.readFileSync(sourcePath).toString("base64")}"><img src="data:image/jpeg;base64,${fs.readFileSync(path.join(output, "reference-1182.jpg")).toString("base64")}">`,
  );
  await comparison.screenshot({
    type: "jpeg",
    quality: 92,
    path: path.join(output, "canonical-comparison.jpg"),
  });
  if (
    errors.length ||
    results.some((result) => result.errors.length) ||
    axe.violations.length
  )
    throw new Error(
      "Browser UI verification failed; inspect browser-smoke.json",
    );
  await browser.close();
})();
