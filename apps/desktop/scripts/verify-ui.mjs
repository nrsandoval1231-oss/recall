/* global process, window, document, innerWidth, TextEncoder, localStorage */
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.resolve(
  process.env.RECALL_UI_EVIDENCE_DIR ||
    path.join(repo, "test-results/adaptive"),
);
fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, "approved-comparison.jpg"), { force: true });
const uiUrl = process.env.RECALL_UI_URL || "http://127.0.0.1:4173/";

const brandRoot = path.join(repo, "branding/monolith/v1");
const markSource = fs.readFileSync(path.join(brandRoot, "logos/monolith-mark-white.svg"), "utf8");
const appIconSource = fs.readFileSync(path.join(brandRoot, "icons/monolith-app-dark.svg"), "utf8");
const brandTokens = JSON.parse(fs.readFileSync(path.join(brandRoot, "tokens/monolith.tokens.json"), "utf8"));
if (!markSource.includes("<path") || !markSource.includes("L100 91") || /<circle\b/i.test(markSource))
  throw Error("MONOLITH one-color ribbon M source is missing or malformed");
if (!appIconSource.includes("<rect") || !appIconSource.includes("L100 91"))
  throw Error("MONOLITH app icon source is missing or malformed");
if (brandTokens.brand !== "MONOLITH" || brandTokens.typography?.heading !== "Sora" || brandTokens.typography?.body !== "Inter")
  throw Error("MONOLITH brand tokens changed unexpectedly");
const brandSourceCheck = { brand: brandTokens.brand, mark: "logos/monolith-mark-white.svg", appIcon: "icons/monolith-app-dark.svg", typography: brandTokens.typography };
const browser = await chromium.launch(
  process.env.RECALL_CHROMIUM
    ? { executablePath: process.env.RECALL_CHROMIUM }
    : {},
);
const results = [];
const polishFailures = [];
const check = (condition, message) => {
  if (!condition) polishFailures.push(message);
};
const errors = [];
const source =
  "SYNTHETIC UI FIXTURE: Utility late. Call Sarah? Deadline unknown.";
const sha = createHash("sha256").update(source).digest("hex");
const photoBytes = Array.from(
  fs.readFileSync(path.join(repo, "apps/web/src/dev/assets/july-notebook.png")),
);
const photoSha = createHash("sha256")
  .update(Buffer.from(photoBytes))
  .digest("hex");
const id = "11111111-1111-4111-8111-111111111111";
for (const [w, h] of [
  [1536, 1024],
  [1182, 789],
  [900, 640],
  [390, 844],
  [430, 932],
].filter(([width]) => !process.env.RECALL_UI_WIDTH || width === Number(process.env.RECALL_UI_WIDTH))) {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ id, source, sha, photoBytes, photoSha }) => {
      const saved = JSON.parse(localStorage.getItem("synthetic-row") || "null");
      let rows = saved ? [saved] : [];
      window.__calls = JSON.parse(
        localStorage.getItem("synthetic-calls") || "[]",
      );
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          window.__calls.push(cmd);
          localStorage.setItem(
            "synthetic-calls",
            JSON.stringify(window.__calls),
          );
          if (cmd === "vault_status")
            return {
              root: "Synthetic browser IPC vault",
              vault_id: "test-session",
              vault_identity: id,
            };
          if (cmd === "vault_list") return rows;
          if (cmd === "librarian_status")
            return {
              ready: false,
              reason: "No live providers in synthetic browser test",
              model: null,
            };
          if (cmd === "vault_capture_note" || cmd === "vault_capture") {
            const text = cmd === "vault_capture_note" ? args.note : source;
            const row = {
              id,
              state: "active",
              revision: 1,
              note_path: id + ".md",
              note: text,
              source_name:
                cmd === "vault_capture"
                  ? "synthetic-photo.png"
                  : "synthetic-meeting.txt",
              source_sha256: cmd === "vault_capture" ? photoSha : sha,
              captured_at: "2026-10-13T09:14:00Z",
              updated_at: "2026-10-13T09:14:00Z",
              conflict: null,
              processing: { state: args.processingConsent ? "pending" : "consent-required", message: args.processingConsent ? "Authorized processing pending." : "Original saved. Choose processing before sending this source to AI." },
            };
            rows = [row];
            localStorage.setItem("synthetic-row", JSON.stringify(row));
            return row;
          }
          if (
            cmd === "vault_source" &&
            rows[0]?.source_name === "synthetic-photo.png"
          )
            return {
              bytes: photoBytes,
              mime_type: "image/png",
              sha256: photoSha,
            };
          if (cmd === "vault_source")
            return {
              bytes: Array.from(new TextEncoder().encode(source)),
              mime_type: "text/plain",
              sha256: sha,
            };
          if (cmd === "vault_correct") {
            rows = [
              { ...rows[0], note: args.note, revision: rows[0].revision + 1 },
            ];
            localStorage.setItem("synthetic-row", JSON.stringify(rows[0]));
            return rows[0];
          }
          if (cmd === "vault_history")
            return [
              {
                revision: 1,
                note: source,
                origin: "human:recall",
                kind: "capture",
                recorded_at: "2026-10-13T09:14:00Z",
              },
            ];
          if (cmd === "processing_parse")
            return {
              operation_id: args.operationId,
              memory_id: id,
              expected_revision: rows[0].revision,
              source_sha256: sha,
              state: "parsed",
              message: "Synthetic Jev fixture",
            };
          if (cmd === "capture_processing") {
            if (args.consent !== true) throw Error("Synthetic AI request lacked explicit consent");
            const setProcessing = (state, message) => {
              rows = [{ ...rows[0], processing: {state, message} }];
              localStorage.setItem("synthetic-row", JSON.stringify(rows[0]));
            };
            setProcessing("processing", "Authorized processing is active; original retained.");
            window.__failOrganization = () => setProcessing("failed", "Synthetic HTTP 401 credentials rejected. Original retained.");
            window.__finishOrganization = () => {
              rows = [{ ...rows[0], revision: rows[0].revision + 1, note: `---\nrecall_id: "${id}"\ntitle: "Synthetic meeting"\ntags: ["utility"]\n---\n\n## Observations (source statements)\n- Utility late.\n\n## Unresolved entity mentions\n- "Sarah" - person candidate; identity unresolved\n\n## Open questions and uncertainty\n- Deadline unknown.` }];
              setProcessing("complete", "Organized in Recall. Uncertainty and original evidence preserved.");
            };
            return rows[0].processing;
          }
          if (cmd === "meeting_organize")
            return new Promise((resolve, reject) => {
              window.__failOrganization = () => reject(new Error("Synthetic provider unavailable. Original retained."));
              window.__finishOrganization = () => resolve({});
            });
          if (cmd === "meeting_publish") {
            rows = [
              {
                ...rows[0],
                revision: rows[0].revision + 1,
                note: `---\nrecall_id: "${id}"\ntitle: "Synthetic meeting"\ntags: ["utility"]\n---\n\n## Observations (source statements)\n- Utility late.\n\n## Unresolved entity mentions\n- “Sarah” — person candidate; identity unresolved\n\n## Open questions and uncertainty\n- Deadline unknown.`,
              },
            ];
            localStorage.setItem("synthetic-row", JSON.stringify(rows[0]));
            return rows[0];
          }
          if (cmd === "memory_ask") {
            await new Promise((resolve, reject) => { window.__finishAsk = resolve; window.__failAsk = () => reject(new Error("Synthetic retrieval unavailable")); });
            return {
              question: args.question,
              message:
                window.__emptyAsk ? "No source-backed matches. Try another question." : "Source-backed retrieved quotes; synthetic IPC, no generative answer.",
              hits: (window.__emptyAsk ? [] : rows).map((row) => ({
                memory_id: id,
                revision: row.revision,
                note_basename: id + ".md",
                current_excerpt: row.note,
                original_excerpt: source,
                source_sha256: sha,
                mime_type: "text/plain",
              })),
            };
          }
          throw Error("Forbidden synthetic IPC command: " + cmd);
        },
      };
    },
    { id, source, sha, photoBytes, photoSha },
  );
  await page.goto(uiUrl);
  await page
    .getByRole("heading", { name: "Your memories belong here.", exact: true })
    .waitFor();
  const shot = async (name) => {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      return document.fonts.ready;
    });
    await page.locator(".adaptive-inspector").evaluateAll((panes) =>
      panes.forEach((pane) => {
        pane.scrollTop = 0;
      }),
    );
    const accessibility = await new AxeBuilder({ page }).analyze();
    if (accessibility.violations.length)
      throw Error(
        JSON.stringify({
          state: name,
          width: w,
          violations: accessibility.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
        }),
      );
    if (await page.evaluate(() => document.body.scrollWidth > innerWidth))
      throw Error(`Overflow ${w} ${name}`);
    await page.screenshot({
      path: path.join(output, `${name}-${w}.jpg`),
      type: "jpeg",
      quality: 90,
    });
  };
  await shot("empty");
  const markElement = page.locator(".ms-mark");
  if (await markElement.isVisible()) {
    const markBounds = await markElement.boundingBox();
    const railBounds = await page.locator(".ms-rail").boundingBox();
    check(
      markBounds.x >= railBounds.x - 1 &&
        markBounds.x + markBounds.width <= railBounds.x + railBounds.width + 1,
      `MONOLITH wordmark escapes the navigation rail at ${w}x${h}`,
    );
  }
  const emptyBox = await page.locator(".ms-field-empty").boundingBox();
  const orbBox = await page.locator(".adaptive-graph").boundingBox();
  check(emptyBox.y >= orbBox.y + orbBox.height, `Empty message overlaps orb at ${w}×${h}`);
  let axe = await new AxeBuilder({ page }).analyze();
  if (axe.violations.length)
    throw Error(
      JSON.stringify(
        axe.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ),
    );
  await page.getByRole("button", { name: /Speak/ }).click({ force: true });
  await page.getByText(/Voice capture is unavailable/).waitFor();
  await page.getByRole("button", { name: /Write ·/ }).click();
  await page.getByLabel("Your note").fill(source);
  await shot("write");
  const taskBox = await page.locator(".adaptive-inspector").boundingBox();
  check(w < 761 || taskBox.width >= Math.min(600, w * .65), `Task workspace too narrow at ${w}: ${taskBox.width}`);
  if (await page.getByLabel(/Send this saved source/).isChecked())
    throw Error("Preselected provider consent");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page.getByRole("tab", {name:"Original", exact:true}).click();
  await page.getByTestId("integrity").waitFor();
  await page.getByRole("tab", {name:"Note", exact:true}).click();
  await page
    .getByText(
      /consent-required · Original saved\. Choose processing before sending this source to AI\./,
    )
    .waitFor();
  const beforeConsent = await page.evaluate(() => window.__calls);
  if (beforeConsent.some(cmd => /capture_processing|processing_parse|meeting_organize|meeting_publish|librarian_read/.test(cmd))) throw Error("Saving without consent invoked AI processing");
  await shot("saved");
  await page.getByLabel(/Send this source to Jev and Claude/).check();
  await page.getByRole("button", { name: "Organize this memory" }).click();
  await page.getByText(/processing · Authorized processing is active/).waitFor();
  await shot("processing");
  await page.evaluate(() => window.__failOrganization());
  await page.getByText(/failed · Synthetic HTTP 401 credentials rejected/).waitFor();
  check(await page.getByText(/Authorized processing is active/).count() === 0, "Failed job retains stale active receipt");
  await shot("processing-failed");
  await page.getByLabel(/Send this source to Jev and Claude/).check();
  await page.getByRole("button", {name:"Organize this memory", exact:true}).click();
  await page.getByText(/processing · Authorized processing is active/).waitFor();
  await page.evaluate(() => window.__finishOrganization());
  await page
    .getByText(
      /complete · Organized in Recall\. Uncertainty and original evidence preserved\./,
    )
    .waitFor();
  await shot("ready");
  check(await page.getByText(/Authorized processing is active/).count() === 0, "Completed job retains stale active receipt");
  check(await page.getByRole("heading", {name:"Processing your memory", exact:true}).count() === 0, "Completed processing retains active heading");
  await page
    .getByLabel("Your correction")
    .fill("# Synthetic meeting\n\nDeadline remains uncertain.");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await page.getByText(/original source is unchanged/).waitFor();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await page.getByText("Revision 1", { exact: true }).waitFor();
  await shot("inspection");
  await page.reload();
  await page.getByRole("button", { name: "Graph View", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Relationship list" }).click();
  await page.getByRole("region", { name: "Graph relationship list" }).waitFor();
  await shot("graph");
  await page.getByRole("button", { name: "Relationship list" }).click();
  await page.getByRole("searchbox").fill("utility delay");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByText("Searching…", {exact:true}).waitFor();
  await shot("searching");
  await page.evaluate(() => window.__finishAsk());
  await page
    .getByRole("heading", { name: "Source-backed matches", exact: true })
    .waitFor();
  await shot("ask");
  if (w === 900) {
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await shot("ask-large-text");
    await page.getByRole("button", {name:"Inspect original evidence", exact:true}).scrollIntoViewIfNeeded();
    check(await page.getByRole("button", {name:"Inspect original evidence", exact:true}).isVisible(), "Evidence action unavailable with enlarged text");
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  }
  await page.getByRole("button", {name:"Ask", exact:true}).click();
  await page.getByText("Searching…", {exact:true}).waitFor();
  await page.evaluate(() => window.__failAsk());
  await page.getByText("Search could not finish. Your question is still here; try again.", {exact:true}).waitFor();
  await shot("search-failed");
  check(await page.getByRole("searchbox").inputValue() === "utility delay", "Failed search lost question");
  await page.getByRole("button", {name:"Ask", exact:true}).click();
  await page.getByText("Searching…", {exact:true}).waitFor();
  await page.evaluate(() => { window.__emptyAsk = true; window.__finishAsk(); });
  await page.getByText("No source-backed matches. Try another question.", {exact:true}).waitFor();
  await shot("search-empty");
  await page.getByRole("button", {name:"Ask", exact:true}).click();
  await page.getByText("Searching…", {exact:true}).waitFor();
  await page.evaluate(() => { window.__emptyAsk = false; window.__finishAsk(); });
  await page.getByRole("button", { name: "Inspect original evidence" }).click();
  await page.getByRole("tab", {name:"Original", exact:true}).click();
  await page.getByTestId("integrity").waitFor();
  await page.getByRole("tab", {name:"Note", exact:true}).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Zoom in" }).waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Library settings" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.getByLabel("Source capture month").selectOption("2026-10");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: /Camera ·/ }).click();
  await page.getByRole("button", { name: "Import photo", exact: true }).click();
  await page.getByRole("tab", {name:"Original", exact:true}).click();
  await page
    .getByRole("img", { name: "Original photo synthetic-photo.png" })
    .waitFor();
  await shot("photo");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  axe = await new AxeBuilder({ page }).analyze();
  const calls = await page.evaluate(() => window.__calls);
  if (calls.some((cmd) => /librarian_read/.test(cmd)))
    throw Error("Unexpected photo reader request");
  results.push({
    viewport: [w, h],
    violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact })),
    calls,
  });
  await context.close();
}
fs.writeFileSync(
  path.join(output, "browser-verification.json"),
  JSON.stringify(
    {
      kind: "Synthetic browser IPC checks; not native persistence, installed Windows, or live-provider acceptance",
      brandSourceCheck,
      results,
      errors,
    },
    null,
    2,
  ),
);
await browser.close();
fs.writeFileSync(path.join(output, "polish-checks.json"), JSON.stringify(polishFailures, null, 2));
if (polishFailures.length && !process.env.RECALL_RECORD_BASELINE) throw Error(polishFailures.join("\n"));
if (errors.length || results.some((r) => r.violations.length))
  throw Error("Browser verification failed");
process.stdout.write(JSON.stringify({ results, errors }) + "\n");
