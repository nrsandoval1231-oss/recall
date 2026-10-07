import { test, expect, type Page } from "@playwright/test";
import type { MemoryDetail } from "@recall/api-client";

const memoryId = "44444444-4444-4444-8444-444444444444";
const draft = "My synthetic correction must survive conflicts.";
async function setup(page: Page) {
  const userId = "11111111-1111-4111-8111-111111111111",
    workspaceId = "22222222-2222-4222-8222-222222222222";
  let revision = 1;
  const writes: { revision: number; key: string; text: string }[] = [];
  let blockReload: (() => Promise<void>) | null = null;
  const memory = (): MemoryDetail => ({
    memory_id: memoryId,
    capture_id: "capture",
    revision,
    status: "ready",
    summary: `Synthetic concurrent summary ${revision}`,
    context_hint: "Synthetic conflict memory",
    captured_at: "2026-07-01T10:00:00Z",
    page_count: 1,
    model_id: "synthetic",
    created_at: "2026-07-01T10:00:00Z",
    revised_at: "2026-09-01T10:00:00Z",
    timezone: "UTC",
    processor_version: "synthetic",
    interpretation: {
      summary: `Synthetic concurrent summary ${revision}`,
      summary_evidence: [],
      pages: [],
      mentions: [],
      statements: [],
      action_suggestions: [],
      uncertainties: [],
    },
    validation_notes: [],
    labels: {
      transcription: "Machine reading",
      action_suggestions: "Suggestions",
    },
    claims: [
      {
        claim_id: "claim",
        memory_id: memoryId,
        text: `Synthetic concurrent statement ${revision}`,
        kind: "claim",
        epistemic_state: "reported",
        temporal_text: null,
        version: revision,
        evidence: [],
      },
    ],
  });
  await page.route("**/auth/me", (r) =>
    r.fulfill({ json: { user_id: userId, active_workspace_id: workspaceId } }),
  );
  await page.route("**/api/v1/me", (r) =>
    r.fulfill({
      json: {
        user_id: userId,
        active_workspace_id: workspaceId,
        workspaces: [
          { id: workspaceId, name: "Synthetic workspace", role: "owner" },
        ],
      },
    }),
  );
  await page.route("**/api/v1/devices", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/v1/settings/ai", (r) =>
    r.fulfill({
      json: {
        ai_configured: false,
        enabled: false,
        explanation: "Synthetic test, no live AI",
      },
    }),
  );
  await page.route("**/api/v1/captures?*", (r) =>
    r.fulfill({
      json: {
        items: [
          {
            capture_id: "capture",
            memory_id: memoryId,
            status: "stored",
            context_hint: "Synthetic conflict memory",
            captured_at: "2026-07-01T10:00:00Z",
            pages: [],
            processing: null,
          },
        ],
        next_cursor: null,
      },
    }),
  );
  await page.route(`**/api/v1/memories/${memoryId}`, async (r) => {
    if (blockReload) await blockReload();
    await r.fulfill({ json: memory() });
  });
  await page.route(`**/api/v1/memories/${memoryId}/corrections`, async (r) => {
    const incoming = Number(r.request().headers()["if-match"]);
    const body = r.request().postDataJSON();
    writes.push({
      revision: incoming,
      key: r.request().headers()["idempotency-key"]!,
      text: body.text,
    });
    if (incoming !== revision) {
      await r.fulfill({
        status: 409,
        json: {
          error: {
            code: "VERSION_CONFLICT",
            message: "Another synthetic edit",
            retryable: false,
            request_id: "test",
          },
        },
      });
      return;
    }
    revision++;
    const updated = memory();
    updated.claims![0]!.text = body.text;
    await r.fulfill({ json: updated });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Recent", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic conflict memory/ }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic conflict memory" }),
  ).toBeVisible();
  return {
    writes,
    edit: () => {
      revision++;
    },
    block: (wait: () => Promise<void>) => {
      blockReload = wait;
    },
  };
}
async function conflict(page: Page) {
  await page
    .getByRole("button", { name: "Correct statement", exact: true })
    .click();
  await page
    .getByLabel("What should Recall understand?", { exact: true })
    .fill(draft);
  await page
    .getByRole("button", { name: "Review affected scope", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm correction", exact: true })
    .click();
  await expect(page.getByText(/This memory changed while/)).toBeVisible();
}
async function reloadAndReview(page: Page, revision: number) {
  await page
    .getByRole("button", { name: "Reload latest understanding", exact: true })
    .click();
  await expect(
    page.getByText(`Synthetic concurrent statement ${revision}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("What should Recall understand?", { exact: true }),
  ).toHaveValue(draft);
  await expect(
    page.getByRole("button", { name: "Review affected scope", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("I have reviewed the latest understanding", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Review affected scope", exact: true })
    .click();
  await expect(
    page.getByText(new RegExp(`in revision ${revision}`)),
  ).toBeVisible();
}
test("HTTP 409 recovery preserves the draft and uses reviewed fresh If-Match across repeated conflicts", async ({
  page,
}, info) => {
  const server = await setup(page);
  server.edit();
  await conflict(page);
  await page
    .getByRole("button", { name: "Refresh memory", exact: true })
    .click();
  await expect(
    page.getByLabel("What should Recall understand?", { exact: true }),
  ).toHaveValue(draft);
  await reloadAndReview(page, 2);
  server.edit();
  await page
    .getByRole("button", { name: "Confirm correction", exact: true })
    .click();
  await expect(page.getByText(/This memory changed while/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review affected scope", exact: true }),
  ).toBeDisabled();
  await reloadAndReview(page, 3);
  await page.screenshot({
    path: info.outputPath("reviewed-conflict-recovery.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Confirm correction", exact: true })
    .click();
  await expect(page.getByText(/Correction saved/)).toBeVisible();
  await expect(page.getByText(draft, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Synthetic concurrent summary 4", { exact: true }),
  ).toBeVisible();
  expect(server.writes.map((w) => w.revision)).toEqual([1, 2, 3]);
  expect(new Set(server.writes.map((w) => w.key)).size).toBe(3);
  expect(server.writes.every((w) => w.text === draft)).toBe(true);
});
test("cancelling a pending HTTP conflict reload prevents a late response from replacing focused memory", async ({
  page,
}) => {
  const server = await setup(page);
  server.edit();
  await conflict(page);
  let release!: () => void;
  const waiting = new Promise<void>((yes) => {
    release = yes;
  });
  server.block(() => waiting);
  await page
    .getByRole("button", { name: "Reload latest understanding", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reloading understanding…" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel correction", exact: true })
    .click();
  const response = page.waitForResponse((r) =>
    r.url().endsWith(`/memories/${memoryId}`),
  );
  release();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
  await expect(
    page.getByText("Synthetic concurrent statement 1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic concurrent statement 2", { exact: true }),
  ).toHaveCount(0);
  expect(server.writes).toHaveLength(1);
});
