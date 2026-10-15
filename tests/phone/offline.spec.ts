// Synthetic content, real browser IndexedDB/service worker and native companion filesystem.
// Does not establish physical iPhone or Tailscale acceptance.
import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
let root: string;
let server: ChildProcess;
async function start(directory: string) {
  server = spawn(
    resolve("apps/desktop/src-tauri/target/debug/recall-phone"),
    [],
    {
      env: {
        ...process.env,
        TYPESAFE_API_KEY: "",
        RECALL_CLAUDE_API_KEY: "",
        RECALL_VAULT_DIR: directory,
        RECALL_PHONE_BIND: "127.0.0.1",
        RECALL_PHONE_PORT: "18787",
      },
      stdio: "pipe",
    },
  );
  await new Promise<void>((done, reject) => {
    server.on("error", reject);
    server.on("exit", (code) => reject(new Error(`Companion exited ${code}`)));
    server.stderr!.on("data", (chunk) => {
      if (String(chunk).includes("Listening on")) done();
    });
  });
}
async function stop() {
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>((done) => {
    server.once("exit", () => done());
    server.kill();
  });
}
test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "recall-phone-synthetic-"));
  await start(root);
});
test.afterEach(async () => {
  await stop();
  await rm(root, { recursive: true, force: true });
});

test("offline capture survives page and desktop restart, then receives one native receipt", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toContainText(
    "Connected to library",
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await stop();
  await context.setOffline(true);
  await page.evaluate(() => {
    location.hash = "write";
  });
  await page
    .getByLabel("Note, in your words")
    .fill("Synthetic: Sarah said the utility schedule is uncertain?");
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByTestId("outbox")).toContainText(
    "Saved on this device",
  );
  await page.reload();
  await expect(page.getByTestId("outbox")).toContainText("Synthetic: Sarah");
  await expect(page.getByTestId("outbox")).not.toContainText(
    "Received by library",
  );
  if (process.env.RECALL_PHONE_EVIDENCE_DIR)
    await page.screenshot({
      path: join(
        process.env.RECALL_PHONE_EVIDENCE_DIR,
        "offline-device-copy.png",
      ),
      fullPage: true,
    });
  await start(root);
  await context.setOffline(false);
  await page.evaluate(() => {
    location.hash = "receipts";
  });
  await page.getByRole("button", { name: "Retry queued captures" }).click();
  await expect(page.getByTestId("outbox")).toContainText("Received by library");
  await page.evaluate(() => {
    location.hash = "receipts";
  });
  await page.getByRole("button", { name: "Retry queued captures" }).click();
  if (process.env.RECALL_PHONE_EVIDENCE_DIR)
    await page.screenshot({
      path: join(
        process.env.RECALL_PHONE_EVIDENCE_DIR,
        "received-by-library.png",
      ),
      fullPage: true,
    });
  const originals = await readdir(join(root, "Recall/Sources"));
  expect(originals).toHaveLength(1);
  expect(
    await readFile(join(root, "Recall/Sources", originals[0]!), "utf8"),
  ).toContain("schedule is uncertain?");
  await page.evaluate(() => {
    location.hash = "ask";
  });
  await page.getByLabel("Ask the notes").fill("utility schedule");
  await page.getByRole("button", { name: "Search notes" }).click();
  await expect(page.locator("body")).toContainText("schedule is uncertain?");
});

test("uncertain network delivery retries the same capture without duplication", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toContainText(
    "Connected to library",
  );
  await page.route("**/capture", async (route) => {
    await route.fetch();
    await route.abort();
  });
  await page.evaluate(() => {
    location.hash = "write";
  });
  await page
    .getByLabel("Note, in your words")
    .fill("Synthetic lost acknowledgement");
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByTestId("outbox")).toContainText(
    "Saved on this device",
  );
  await expect
    .poll(async () => (await readdir(join(root, "Recall/Sources"))).length)
    .toBe(1);
  // The original can exist before fetch/abort finishes; keep interception until it does.
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.getByTestId("outbox")).toContainText("Original retained");
  await page.reload();
  await page.evaluate(() => {
    location.hash = "receipts";
  });
  await page.getByRole("button", { name: "Retry queued captures" }).click();
  await expect(page.getByTestId("outbox")).toContainText("Received by library");
  expect(await readdir(join(root, "Recall/Sources"))).toHaveLength(1);
});

test("library switch cannot silently receive an older library's offline capture", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toContainText(
    "Connected to library",
  );
  await context.setOffline(true);
  await page.evaluate(() => {
    location.hash = "write";
  });
  await page
    .getByLabel("Note, in your words")
    .fill("Synthetic belongs to the first library");
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByTestId("outbox")).toContainText(
    "Saved on this device",
  );
  await stop();
  const second = await mkdtemp(join(tmpdir(), "recall-other-synthetic-"));
  try {
    await start(second);
    await context.setOffline(false);
    await page.evaluate(() => {
      location.hash = "receipts";
    });
    await page.getByRole("button", { name: "Retry queued captures" }).click();
    await expect(page.getByTestId("outbox")).toContainText("Different library");
    expect(await readdir(join(second, "Recall/Sources"))).toHaveLength(0);
    await expect(page.getByTestId("outbox")).toContainText("Synthetic belongs");
  } finally {
    await stop();
    await rm(second, { recursive: true, force: true });
  }
});

test("offline photo bytes survive reload and transfer; only public shell is cached", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toContainText(
    "Connected to library",
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  const photo = Buffer.from(
    "89504e470d0a1a0a53594e5448455449432d50484f544f",
    "hex",
  );
  await page.evaluate(() => {
    location.hash = "write";
  });
  await page
    .getByLabel("Photo or file, optional")
    .setInputFiles({
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: photo,
    });
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByTestId("outbox")).toContainText("synthetic.png");
  await page.reload();
  await expect(page.getByTestId("outbox")).toContainText(
    "Saved on this device",
  );
  await context.setOffline(false);
  await page.evaluate(() => {
    location.hash = "receipts";
  });
  await page.getByRole("button", { name: "Retry queued captures" }).click();
  await expect(page.getByTestId("outbox")).toContainText("Received by library");
  const originals = await readdir(join(root, "Recall/Sources"));
  expect(originals).toHaveLength(1);
  expect(await readFile(join(root, "Recall/Sources", originals[0]!))).toEqual(
    photo,
  );
  await page.getByRole("link", { name: "· Inspect in library" }).click();
  await expect(page.locator("body")).toContainText("Original");
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (
      await Promise.all(
        keys.map(async (key) =>
          (await (await caches.open(key)).keys()).map(
            (req) => new URL(req.url).pathname,
          ),
        ),
      )
    ).flat();
  });
  expect(cached.sort()).toEqual([
    "/",
    "/brand/favicon.svg",
    "/brand/orbital-mark.svg",
    "/companion.js",
    "/fonts/Inter-Regular.ttf",
    "/fonts/PlayfairDisplay-Regular.ttf",
    "/icon.png",
    "/manifest.webmanifest",
    "/phone-ui.js",
  ]);
});

test("a mismatched receipt never turns a device copy into a received capture", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toContainText(
    "Connected to library",
  );
  await page.route("**/capture", (route) =>
    route.fulfill({
      json: {
        format: "recall-capture-receipt-v1",
        state: "received",
        library_id: "wrong",
        memory_id: "wrong",
        revision: 1,
        source_sha256: "a".repeat(64),
      },
    }),
  );
  await page.evaluate(() => {
    location.hash = "write";
  });
  await page
    .getByLabel("Note, in your words")
    .fill("Synthetic invalid receipt");
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByTestId("outbox")).toContainText(
    "Receipt did not match",
  );
  await expect(page.getByTestId("outbox")).not.toContainText(
    "Received by library",
  );
  expect(await readdir(join(root, "Recall/Sources"))).toHaveLength(0);
});

test("device storage failure retains the form and never sends its original", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.add = function () {
      throw new DOMException("Synthetic quota failure", "QuotaExceededError");
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toContainText(
    "Connected to library",
  );
  await page.evaluate(() => {
    location.hash = "write";
  });
  await page.getByLabel("Note, in your words").fill("Synthetic unsaved draft");
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.locator("#local-status")).toContainText("quota failure");
  await expect(page.getByLabel("Note, in your words")).toHaveValue(
    "Synthetic unsaved draft",
  );
  expect(await readdir(join(root, "Recall/Sources"))).toHaveLength(0);
});

test("native Ask locates late evidence and distinguishes linked context", async ({
  page,
  request,
}) => {
  const scope = (await (await request.get("/companion/library")).json()) as {
    library_id: string;
  };
  const headers = {
    accept: "application/json",
    "x-recall-library-id": scope.library_id,
  };
  const target = "11111111-1111-4111-8111-111111111111";
  const source = "22222222-2222-4222-8222-222222222222";
  expect(
    (
      await request.post("/capture", {
        headers,
        form: {
          operation_id: target,
          note: "Synthetic earlier context: the proposed departure was withdrawn.",
        },
      })
    ).ok(),
  ).toBeTruthy();
  const original =
    "Synthetic unrelated preamble. ".repeat(100) +
    `\nThe ceramic ferry booking is tentative; do not assume it is confirmed.\n[[Recall/Memories/${target}|Earlier context]]`;
  expect(
    (
      await request.post("/capture", {
        headers,
        form: { operation_id: source, note: original },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await page.evaluate(() => {
    location.hash = "ask";
  });
  await page
    .getByLabel("Ask the notes")
    .fill("What did we decide about that ceramic ferry?");
  await page.getByRole("button", { name: "Search notes" }).click();
  const direct = page.locator(`article[data-memory="${source}"]`);
  await expect(direct).toContainText(
    "booking is tentative; do not assume it is confirmed.",
  );
  await expect(direct).toContainText("Original excerpt: bytes");
  const linked = page.locator(`article[data-memory="${target}"]`);
  await expect(linked).toContainText(
    "Linked context, not a direct wording match.",
  );
  await expect(linked).toContainText("proposed departure was withdrawn.");
  await expect(page.locator("body")).toContainText("not a generated answer");
});

test("previously authorized pending processing can resume after desktop restart without providers", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toContainText(
    "Connected to library",
  );
  await page.evaluate(() => {
    location.hash = "write";
  });
  await page
    .getByLabel("Note, in your words")
    .fill("Synthetic pending interpretation: 5–10 MW?");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByTestId("outbox")).toContainText("Received by library");
  await page.getByRole("link", { name: "· Inspect in library" }).click();
  await expect(
    page.getByRole("button", {
      name: "Resume previously authorized processing",
    }),
  ).toBeVisible();
  const savedUrl = page.url();
  await stop();
  await start(root);
  await page.goto(savedUrl);
  await page
    .getByRole("button", { name: "Resume previously authorized processing" })
    .click();
  await expect(page).toHaveURL(savedUrl);
  await expect(page.locator("body")).toContainText("Processing: pending");
  await expect(page.locator("body")).toContainText("5–10 MW?");
  const originals = await readdir(join(root, "Recall/Sources"));
  expect(originals).toHaveLength(1);
  const id = originals[0]!.replace(/\.txt$/, "");
  const histories = await readdir(join(root, "Recall/History", id));
  expect(histories).toHaveLength(1);
  expect(
    await readFile(join(root, "Recall/Sources", originals[0]!), "utf8"),
  ).toBe("Synthetic pending interpretation: 5–10 MW?");
});

test("a library switch removes inspection links for already received copies", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toContainText(
    "Connected to library",
  );
  await page.evaluate(() => {
    location.hash = "write";
  });
  await page
    .getByLabel("Note, in your words")
    .fill("Synthetic received in original library");
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByTestId("outbox")).toContainText("Received by library");
  await expect(
    page.getByRole("link", { name: "· Inspect in library" }),
  ).toBeVisible();
  await stop();
  const second = await mkdtemp(join(tmpdir(), "recall-switch-synthetic-"));
  try {
    await start(second);
    await page.evaluate(() => {
      location.hash = "receipts";
    });
    await page.getByRole("button", { name: "Retry queued captures" }).click();
    await expect(
      page.getByRole("link", { name: "· Inspect in library" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("outbox")).toContainText(
      "Synthetic received in original library",
    );
    await expect(
      page.getByRole("link", { name: "Save original copy" }),
    ).toBeVisible();
  } finally {
    await stop();
    await rm(second, { recursive: true, force: true });
  }
});

for (const failFirst of [false, true]) {
  test(`capture queued during upload drains automatically (first fails: ${failFirst})`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("connection-state")).toContainText(
      "Connected to library",
    );
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const attempts: string[] = [];
    await page.route("**/capture", async (route) => {
      const body = route.request().postData() || "";
      attempts.push(body);
      if (attempts.length === 1) {
        await held;
        if (failFirst) {
          await route.fulfill({ status: 503, body: "Synthetic outage" });
          return;
        }
      }
      await route.continue();
    });
    await page.evaluate(() => {
      location.hash = "write";
    });
    await page
      .getByLabel("Note, in your words")
      .fill("Synthetic first in flight");
    await page
      .getByRole("button", { name: "Save capture", exact: true })
      .click();
    await expect.poll(() => attempts.length).toBe(1);
    await page.evaluate(() => {
      location.hash = "write";
    });
    await page
      .getByLabel("Note, in your words")
      .fill("Synthetic second queued during upload");
    await page
      .getByRole("button", { name: "Save capture", exact: true })
      .click();
    await expect(page.getByTestId("outbox")).toContainText(
      "Synthetic second queued",
    );
    release();
    const second = page
      .getByTestId("outbox")
      .locator("article")
      .filter({ hasText: "Synthetic second queued" });
    await expect(second).toContainText("Received by library");
    const first = page
      .getByTestId("outbox")
      .locator("article")
      .filter({ hasText: "Synthetic first in flight" });
    await expect(first).toContainText(
      failFirst ? "Original retained" : "Received by library",
    );
    // A failed row is attempted once in this drain, not retried forever.
    await page.waitForTimeout(300);
    expect(attempts).toHaveLength(2);
    expect(await readdir(join(root, "Recall/Sources"))).toHaveLength(
      failFirst ? 1 : 2,
    );
  });
}

test("focused phone navigation preserves drafts and consent; Speak stays honest", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your memories belong here." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Speak/ }).click({ force: true });
  await expect(
    page.getByText(
      "Voice capture is unavailable in this build. Use Camera or Write.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: /Write In your words/ }).click();
  await page
    .getByLabel("Note, in your words")
    .fill("Synthetic draft must survive navigation");
  await page.getByRole("checkbox").check();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: /Camera Keep an original/ }).click();
  await expect(page.getByLabel("Note, in your words")).toHaveValue(
    "Synthetic draft must survive navigation",
  );
  await expect(page.getByRole("checkbox")).toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Capture a moment" }),
  ).toBeVisible();
  await page
    .getByLabel("Photo or file, optional")
    .setInputFiles({
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "89504e470d0a1a0a53594e5448455449432d50484f544f",
        "hex",
      ),
    });
  await expect(
    page.getByRole("img", { name: "Selected original photo" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ask Recall" })).toBeVisible();
  await page.getByRole("link", { name: "Write a memory" }).click();
  await expect(
    page.getByRole("img", { name: "Selected original photo" }),
  ).toBeVisible();
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByTestId("outbox")).toContainText("Received by library");
});

test("keyboard hash navigation focuses the visible heading through save and history", async ({
  page,
}) => {
  await page.goto("/");
  const write = page.getByRole("link", { name: /Write In your words/ });
  await write.focus();
  await page.keyboard.press("Enter");
  const captureHeading = page.getByRole("heading", {
    name: "Write a memory",
    exact: true,
  });
  await expect(captureHeading).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Note, in your words")).toBeFocused();
  await expect(captureHeading).not.toHaveAttribute("tabindex");
  await page
    .getByLabel("Note, in your words")
    .fill("Synthetic keyboard receipt");
  await page.getByRole("button", { name: "Save capture", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "On this device" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Retry queued captures" }),
  ).toBeFocused();
  await page.goBack();
  await expect(captureHeading).toBeFocused();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "On this device" }),
  ).toBeFocused();
  await page.getByRole("link", { name: "Ask", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Ask Recall" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Ask the notes")).toBeFocused();
  await page.getByRole("link", { name: "← Home", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Your memories belong here." }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Search your memories…" }),
  ).toBeFocused();
});

test("receipt and original evidence links have separated 48px touch targets", async ({
  page,
}) => {
  await page.goto("/#write");
  await page
    .getByLabel("Note, in your words")
    .fill("Synthetic touch target evidence");
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  const copy = page.getByRole("link", {
    name: "Save original copy",
    exact: true,
  });
  const inspect = page.getByRole("link", { name: "· Inspect in library" });
  await expect(inspect).toBeVisible();
  for (const link of [copy, inspect]) {
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
  }
  const copyBox = (await copy.boundingBox())!;
  const inspectBox = (await inspect.boundingBox())!;
  expect(
    inspectBox.y >= copyBox.y + copyBox.height ||
      inspectBox.x >= copyBox.x + copyBox.width + 8,
  ).toBeTruthy();
  await inspect.click();
  const original = page.getByRole("link", {
    name: "Open original evidence",
    exact: true,
  });
  await expect(original).toBeVisible();
  expect((await original.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  // Synthetic inferred support uses the exact server-rendered structure; no provider is invoked.
  await page.locator("main").evaluate((main) => {
    const article = document.createElement("article");
    article.className = "inferred";
    article.innerHTML =
      '<ul><li><a href="/sources/synthetic">Open original source</a><p>Synthetic support quote</p></li></ul>';
    main.append(article);
  });
  expect(
    (await page
      .getByRole("link", { name: "Open original source", exact: true })
      .boundingBox())!.height,
  ).toBeGreaterThanOrEqual(48);
});
