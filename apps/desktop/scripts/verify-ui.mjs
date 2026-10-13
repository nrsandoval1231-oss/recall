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
  process.env.RECALL_UI_EVIDENCE_DIR || path.join(repo, "docs/audits/adaptive"),
);
fs.mkdirSync(output, { recursive: true });
const uiUrl = process.env.RECALL_UI_URL || "http://127.0.0.1:4173/";
const reference = path.join(
  repo,
  "docs/assets/B4063AE0-31B8-4E1D-B9B2-48C3F181E423.png",
);
const referenceBytes = fs.readFileSync(reference);
if (
  createHash("sha1")
    .update(
      Buffer.concat([
        Buffer.from(`blob ${referenceBytes.length}\0`),
        referenceBytes,
      ]),
    )
    .digest("hex") !== "6abf5192ab4ee96708984174ed15e3648c668bf0"
)
  throw Error("Approved reference changed");
const browser = await chromium.launch(
  process.env.RECALL_CHROMIUM
    ? { executablePath: process.env.RECALL_CHROMIUM }
    : {},
);
const results = [];
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
  [900, 700],
  [390, 844],
]) {
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
      window.__calls = JSON.parse(localStorage.getItem("synthetic-calls") || "[]");
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          window.__calls.push(cmd);
        localStorage.setItem("synthetic-calls", JSON.stringify(window.__calls));
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
          if (cmd === "meeting_organize")
            return new Promise((resolve) => {
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
          if (cmd === "memory_ask")
            return {
              question: args.question,
              message:
                "Source-backed retrieved quotes; synthetic IPC, no generative answer.",
              hits: rows.map((row) => ({
                memory_id: id,
                revision: row.revision,
                note_basename: id + ".md",
                current_excerpt: row.note,
                original_excerpt: source,
                source_sha256: sha,
                mime_type: "text/plain",
              })),
            };
          throw Error("Forbidden synthetic IPC command: " + cmd);
        },
      };
    },
    { id, source, sha, photoBytes, photoSha },
  );
  await page.goto(uiUrl);
  await page.getByRole("heading", { name: "Capture", exact: true }).waitFor();
  const shot = async (name) => {
    if (await page.evaluate(() => document.body.scrollWidth > innerWidth))
      throw Error(`Overflow ${w} ${name}`);
    await page.screenshot({
      path: path.join(output, `${name}-${w}.jpg`),
      type: "jpeg",
      quality: 90,
    });
  };
  await shot("empty");
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
  if (await page.getByLabel(/Send this saved source/).isChecked())
    throw Error("Preselected provider consent");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page.getByTestId("integrity").waitFor();
  await page
    .getByText(
      "Saved locally. Agree before sending this source to Jev and Claude.",
    )
    .waitFor();
  await shot("saved");
  await page.getByLabel(/Send this source to Jev and Claude/).check();
  await page.getByRole("button", { name: "Organize this memory" }).click();
  await page.getByText("Claude is organizing source-linked memory…").waitFor();
  await shot("processing");
  await page.evaluate(() => window.__finishOrganization());
  await page
    .getByText(
      "Organized in Obsidian. Uncertainty and original evidence preserved.",
    )
    .waitFor();
  await shot("ready");
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
  await page
    .getByRole("heading", { name: "Source-backed matches", exact: true })
    .waitFor();
  await shot("ask");
  await page.getByRole("button", { name: "Inspect original evidence" }).click();
  await page.getByTestId("integrity").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Zoom in" }).waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Vault settings" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.getByLabel("Source capture month").selectOption("2026-10");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: /Camera ·/ }).click();
  await page.getByRole("button", { name: "Import photo", exact: true }).click();
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
const comparison = await browser.newPage({
  viewport: { width: 1536, height: 1548 },
});
await comparison.setContent(
  `<style>body{margin:0;background:#eee9e0}h2{font:18px Georgia;margin:12px}img{width:1536px;display:block}</style><h2>Unchanged owner-approved reference · illustrative content</h2><img src="data:image/png;base64,${referenceBytes.toString("base64")}"><h2>Implemented empty native-mode UI · synthetic browser IPC evidence</h2><img src="data:image/jpeg;base64,${fs.readFileSync(path.join(output, "empty-1536.jpg")).toString("base64")}">`,
);
await comparison.screenshot({
  path: path.join(output, "approved-comparison.jpg"),
  type: "jpeg",
  quality: 90,
  fullPage: true,
});
fs.writeFileSync(
  path.join(output, "browser-verification.json"),
  JSON.stringify(
    {
      kind: "Synthetic browser IPC checks; not native persistence, installed Windows, or live-provider acceptance",
      referenceBlob: "6abf5192ab4ee96708984174ed15e3648c668bf0",
      results,
      errors,
    },
    null,
    2,
  ),
);
await browser.close();
if (errors.length || results.some((r) => r.violations.length))
  throw Error("Browser verification failed");
process.stdout.write(JSON.stringify({ results, errors }) + "\n");
