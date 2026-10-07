import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";

const question = "What do you know about Brooks Campus?";
async function reconstruct(page: Page) {
  await page
    .getByLabel("What do you need to remember?", { exact: true })
    .fill(question);
  await page.getByRole("button", { name: "Ask Recall", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: question, exact: true }),
  ).toBeVisible();
}
async function snapshot(page: Page, name: string, project: string) {
  if (process.env.RECALL_SCREENSHOTS === "1" && project !== "reduced-motion") {
    await page.screenshot({
      path: resolve(
        `docs/implementation/memory-surface/${project}-${name}.jpg`,
      ),
      fullPage: true,
      type: "jpeg",
      quality: 85,
      animations: "disabled",
    });
  }
}
test.beforeEach(async ({ page }, info) => {
  // Set media explicitly as well as in project config for reused browser contexts.
  await page.emulateMedia({
    reducedMotion:
      info.project.use.contextOptions?.reducedMotion ?? "no-preference",
  });
  await page.goto("/?fixture=memory-surface");
  await expect(page.getByText(/Synthetic design world/)).toBeVisible();
});

test("canonical journey preserves evidence, refocus and prior composition", async ({
  page,
}, info) => {
  const sourceRequests: string[] = [];
  page.on("request", (request) => {
    if (/assets\/.*\.png/.test(request.url()))
      sourceRequests.push(request.url());
  });
  await snapshot(page, "home", info.project.name);
  await reconstruct(page);
  await snapshot(page, "reconstruction", info.project.name);
  await page
    .getByRole("button", { name: /Focus memory/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "The July site walk" }),
  ).toBeVisible();
  expect(sourceRequests).toHaveLength(0);
  await snapshot(page, "memory", info.project.name);
  await page.getByRole("button", { name: "Inspect original · page 1" }).click();
  const original = page.getByRole("img", {
    name: "Original evidence · page 1",
  });
  await expect(original).toBeVisible();
  await expect(
    page.getByText("Verified original", { exact: true }),
  ).toBeVisible();
  expect(
    await original.evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBeGreaterThan(0);
  await snapshot(page, "evidence", info.project.name);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Inspect original · page 1" }),
  ).toBeFocused();
  await snapshot(page, "layered-memory", info.project.name);
  await page
    .getByRole("button", { name: "Focus Mara Chen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Mara Chen", exact: true }),
  ).toBeVisible();
  await snapshot(page, "person", info.project.name);
  await page
    .getByRole("region", { name: "Memory through time", exact: true })
    .getByRole("button", { name: /July 18, 2026/ })
    .first()
    .click();
  await expect(
    page.getByText("Historical understanding", { exact: true }),
  ).toBeVisible();
  await snapshot(page, "historical", info.project.name);
  await page
    .getByRole("button", { name: /Focus memory/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "What the source said then." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Correct/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Mara Chen", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "The July site walk" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Correct statement", exact: true })
    .first()
    .click();
  await page
    .getByLabel("What should Recall understand?", { exact: true })
    .fill("Startup moved to March 2027.");
  await page
    .getByRole("button", { name: "Review affected scope", exact: true })
    .click();
  await expect(
    page.getByText(/Original evidence stays unchanged/),
  ).toBeVisible();
  await snapshot(page, "correction", info.project.name);
  await page
    .getByRole("button", { name: "Confirm correction", exact: true })
    .click();
  await expect(page.getByText(/Correction saved/)).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: question, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Understanding changed/)).toBeVisible();
  await expect(page.getByText(/Startup is now expected in March/)).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Ask Recall", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Supporting memories", exact: true }),
  ).toBeVisible();
});

test("keyboard-only Ask and evidence with visible focus and Back restoration", async ({
  page,
}) => {
  await page.keyboard.press("Tab"); // focus was placed at semantic memory stage on initial load
  await expect(
    page.getByLabel("What do you need to remember?", { exact: true }),
  ).toBeFocused();
  await page.keyboard.type(question);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: question, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveAttribute("aria-label", /Inspect source for/);
  expect(
    await focused.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Verified original", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveAttribute(
    "aria-label",
    /Inspect source for/,
  );
});

test("narrow viewport and reduced motion preserve semantic hierarchy", async ({
  page,
}, info) => {
  await reconstruct(page);
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  await expect(
    page.getByRole("region", { name: "Reconstructed understanding" }),
  ).toBeVisible();
  if (info.project.name === "reduced-motion") {
    await expect(page.locator("main")).toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
    expect(
      await page
        .locator(".primary-board")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
  }
  if (info.project.name === "mobile") {
    const primary = await page.locator(".primary-board").boundingBox();
    const context = await page.locator(".context-board").boundingBox();
    expect(context!.y).toBeGreaterThan(primary!.y + primary!.height - 1);
  }
});

for (const scenario of [
  "empty",
  "unavailable",
  "ambiguous",
  "corrupt",
  "slow",
]) {
  test(`honest ${scenario} state`, async ({ page }) => {
    await page.goto(`/?fixture=memory-surface&scenario=${scenario}`);
    await reconstruct(page);
    if (scenario === "empty")
      await expect(
        page.getByText("Not enough evidence yet", { exact: true }),
      ).toBeVisible();
    if (scenario === "unavailable") {
      await expect(
        page.getByText("Understanding is unavailable", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Focus memory/ }).first(),
      ).toBeVisible();
    }
    if (scenario === "ambiguous")
      await expect(
        page.getByText("More than one possibility", { exact: true }),
      ).toBeVisible();
    if (scenario === "corrupt") {
      await page
        .getByRole("button", { name: /Inspect source for/ })
        .first()
        .click();
      await expect(
        page.getByText("Original failed integrity verification.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("img")).toHaveCount(0);
    }
    if (scenario === "slow")
      await expect(page.locator(".surface-stage")).toHaveAttribute(
        "aria-busy",
        "false",
      );
  });
}

test("actual browser capture survives reload and retries the preserved original", async ({
  page,
}, info) => {
  const { createHash } = await import("node:crypto");
  let failUpload = true;
  let saved: import("@recall/api-client").ServerCapture | null = null;
  const userId = "11111111-1111-4111-8111-111111111111",
    workspaceId = "22222222-2222-4222-8222-222222222222",
    sourceId = "33333333-3333-4333-8333-333333333333";
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      json: { user_id: userId, active_workspace_id: workspaceId },
    }),
  );
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      json: {
        user_id: userId,
        active_workspace_id: workspaceId,
        workspaces: [
          { id: workspaceId, name: "Synthetic test workspace", role: "owner" },
        ],
      },
    }),
  );
  await page.route("**/api/v1/devices", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/v1/settings/ai", (route) =>
    route.fulfill({
      json: {
        ai_configured: false,
        enabled: false,
        explanation: "Synthetic capture test. AI is disabled.",
      },
    }),
  );
  await page.route("**/api/v1/captures?*", (route) =>
    route.fulfill({
      json: {
        items: saved?.status === "stored" ? [saved] : [],
        next_cursor: null,
      },
    }),
  );
  await page.route("**/api/v1/captures", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { items: [], next_cursor: null } });
      return;
    }
    if (failUpload) {
      await route.abort("failed");
      return;
    }
    const manifest = route
      .request()
      .postDataJSON() as import("@recall/api-client").CaptureManifest;
    saved = {
      capture_id: "44444444-4444-4444-8444-444444444444",
      client_capture_id: manifest.client_capture_id,
      status: "awaiting_upload",
      source_kind: manifest.source_kind,
      captured_at: manifest.captured_at,
      timezone: manifest.timezone,
      context_hint: manifest.context_hint,
      created_at: manifest.captured_at,
      stored_at: null,
      version: 1,
      memory_id: null,
      processing: null,
      pages: manifest.pages.map((page) => ({
        ...page,
        source_id: sourceId,
        declared_sha256: page.sha256,
        server_sha256: null,
        upload_state: "pending",
      })),
    };
    await route.fulfill({ json: saved });
  });
  await page.route("**/api/v1/captures/*/upload-authorizations", (route) =>
    route.fulfill({
      json: {
        authorizations: [
          {
            source_id: sourceId,
            method: "PUT",
            url: "/v1/uploads/synthetic",
            expires_at: "2099-01-01T00:00:00Z",
            required_headers: { "Content-Type": "image/png" },
            max_bytes: 25 * 1024 * 1024,
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/uploads/synthetic", (route) => {
    const bytes = route.request().postDataBuffer()!;
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(hash).toBe(saved!.pages[0]!.declared_sha256);
    saved!.pages[0]!.server_sha256 = hash;
    saved!.pages[0]!.upload_state = "verified";
    return route.fulfill({ json: { sha256: hash, byte_size: bytes.length } });
  });
  await page.route("**/api/v1/captures/*/finalize", (route) => {
    saved!.status = "stored";
    saved!.stored_at = new Date().toISOString();
    saved!.version++;
    return route.fulfill({ json: saved });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page
    .getByLabel("Choose a photo of your note", { exact: true })
    .setInputFiles(resolve("apps/web/src/dev/assets/july-notebook.png"));
  await snapshot(page, "capture", info.project.name);
  await page
    .getByRole("button", { name: "Save original", exact: true })
    .click();
  await expect(
    page
      .getByText(
        "Upload failed · original saved on this device. Retry in Capture.",
        { exact: true },
      )
      .last(),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry upload", exact: true }),
  ).toBeVisible();
  failUpload = false;
  await page.getByRole("button", { name: "Retry upload", exact: true }).click();
  await expect(
    page.getByText("Saved original uploaded successfully.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry upload", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Recent", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Captured original/ }),
  ).toBeVisible();
});

test("semantic controls and contrast meet automated accessibility checks", async ({
  page,
}) => {
  for (const state of ["home", "reconstruction", "memory", "evidence"]) {
    if (state === "reconstruction") await reconstruct(page);
    if (state === "memory")
      await page
        .getByRole("button", { name: /Focus memory/ })
        .first()
        .click();
    if (state === "evidence") {
      await page
        .getByRole("button", { name: /Inspect original/ })
        .first()
        .click();
      await expect(
        page.getByText("Verified original", { exact: true }),
      ).toBeVisible();
    }
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations, state).toEqual([]);
  }
});

test("correction keyboard preview and cancellation restore the originating control", async ({
  page,
}) => {
  await reconstruct(page);
  await page
    .getByRole("button", { name: /Focus memory/ })
    .first()
    .click();
  const origin = page.getByRole("button", {
    name: "Correct understanding",
    exact: true,
  });
  await origin.focus();
  await page.keyboard.press("Enter");
  const text = page.getByLabel("What should Recall understand?", {
    exact: true,
  });
  await expect(text).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("The fictional campus summary changed.");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Confirm correction", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Cancel correction", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(origin).toBeFocused();
});

test("320px viewport preserves readable focus and immediate source access", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await reconstruct(page);
  await page
    .getByRole("button", { name: /Focus memory/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Inspect original · page 1" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});
