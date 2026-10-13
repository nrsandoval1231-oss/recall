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
  server = spawn(resolve("apps/desktop/src-tauri/target/debug/recall-phone"), [], {
    env: { ...process.env, TYPESAFE_API_KEY: "", RECALL_CLAUDE_API_KEY: "", RECALL_VAULT_DIR: directory, RECALL_PHONE_BIND: "127.0.0.1", RECALL_PHONE_PORT: "18787" },
    stdio: "pipe",
  });
  await new Promise<void>((done, reject) => {
    server.on("error", reject);
    server.on("exit", code => reject(new Error(`Companion exited ${code}`)));
    server.stderr!.on("data", chunk => { if (String(chunk).includes("Listening on")) done(); });
  });
}
async function stop() {
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>(done => { server.once("exit", () => done()); server.kill(); });
}
test.beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "recall-phone-synthetic-")); await start(root); });
test.afterEach(async () => { await stop(); await rm(root, { recursive: true, force: true }); });

test("offline capture survives page and desktop restart, then receives one native receipt", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toContainText("Connected to library");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await stop();
  await context.setOffline(true);
  await page.getByLabel("Note, in your words").fill("Synthetic: Sarah said the utility schedule is uncertain?");
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByTestId("outbox")).toContainText("Saved on this device");
  await page.reload();
  await expect(page.getByTestId("outbox")).toContainText("Synthetic: Sarah");
  await expect(page.getByTestId("outbox")).not.toContainText("Received by library");
  if (process.env.RECALL_PHONE_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.RECALL_PHONE_EVIDENCE_DIR, "offline-device-copy.png"), fullPage: true });
  await start(root);
  await context.setOffline(false);
  await page.getByRole("button", { name: "Retry queued captures" }).click();
  await expect(page.getByTestId("outbox")).toContainText("Received by library");
  await page.getByRole("button", { name: "Retry queued captures" }).click();
  if (process.env.RECALL_PHONE_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.RECALL_PHONE_EVIDENCE_DIR, "received-by-library.png"), fullPage: true });
  const originals = await readdir(join(root, "Recall/Sources"));
  expect(originals).toHaveLength(1);
  expect(await readFile(join(root, "Recall/Sources", originals[0]!), "utf8")).toContain("schedule is uncertain?");
  await page.getByLabel("Ask the notes").fill("utility schedule");
  await page.getByRole("button", { name: "Search notes" }).click();
  await expect(page.locator("body")).toContainText("schedule is uncertain?");
});

test("uncertain network delivery retries the same capture without duplication", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toContainText("Connected to library");
  await page.route("**/capture", async route => { await route.fetch(); await route.abort(); });
  await page.getByLabel("Note, in your words").fill("Synthetic lost acknowledgement");
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByTestId("outbox")).toContainText("Saved on this device");
  await expect.poll(async () => (await readdir(join(root, "Recall/Sources"))).length).toBe(1);
  await page.unroute("**/capture");
  await page.reload();
  await page.getByRole("button", { name: "Retry queued captures" }).click();
  await expect(page.getByTestId("outbox")).toContainText("Received by library");
  expect(await readdir(join(root, "Recall/Sources"))).toHaveLength(1);
});

test("library switch cannot silently receive an older library's offline capture", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toContainText("Connected to library");
  await context.setOffline(true);
  await page.getByLabel("Note, in your words").fill("Synthetic belongs to the first library");
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByTestId("outbox")).toContainText("Saved on this device");
  await stop();
  const second = await mkdtemp(join(tmpdir(), "recall-other-synthetic-"));
  try {
    await start(second);
    await context.setOffline(false);
    await page.getByRole("button", { name: "Retry queued captures" }).click();
    await expect(page.getByTestId("outbox")).toContainText("Different library");
    expect(await readdir(join(second, "Recall/Sources"))).toHaveLength(0);
    await expect(page.getByTestId("outbox")).toContainText("Synthetic belongs");
  } finally { await stop(); await rm(second, { recursive: true, force: true }); }
});

test("offline photo bytes survive reload and transfer; only public shell is cached", async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('connection-state')).toContainText('Connected to library');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  const photo = Buffer.from('89504e470d0a1a0a53594e5448455449432d50484f544f', 'hex');
  await page.getByLabel('Photo or file, optional').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: photo });
  await page.getByRole('button', { name: 'Save capture', exact: true }).click();
  await expect(page.getByTestId('outbox')).toContainText('synthetic.png');
  await page.reload();
  await expect(page.getByTestId('outbox')).toContainText('Saved on this device');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Retry queued captures' }).click();
  await expect(page.getByTestId('outbox')).toContainText('Received by library');
  const originals = await readdir(join(root, 'Recall/Sources'));
  expect(originals).toHaveLength(1);
  expect(await readFile(join(root, 'Recall/Sources', originals[0]!))).toEqual(photo);
  await page.getByRole('link', { name: '· Inspect in library' }).click();
  await expect(page.locator('body')).toContainText('Original');
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(req => new URL(req.url).pathname)))).flat();
  });
  expect(cached.sort()).toEqual(['/', '/companion.js', '/icon.png', '/manifest.webmanifest']);
});

test("a mismatched receipt never turns a device copy into a received capture", async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('connection-state')).toContainText('Connected to library');
  await page.route('**/capture', route => route.fulfill({ json: { format: 'recall-capture-receipt-v1',
    state: 'received', library_id: 'wrong', memory_id: 'wrong', revision: 1, source_sha256: 'a'.repeat(64) } }));
  await page.getByLabel('Note, in your words').fill('Synthetic invalid receipt');
  await page.getByRole('button', { name: 'Save capture', exact: true }).click();
  await expect(page.getByTestId('outbox')).toContainText('Receipt did not match');
  await expect(page.getByTestId('outbox')).not.toContainText('Received by library');
  expect(await readdir(join(root, 'Recall/Sources'))).toHaveLength(0);
});

test("device storage failure retains the form and never sends its original", async ({ page }) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.add = function () { throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await expect(page.getByTestId('connection-state')).toContainText('Connected to library');
  await page.getByLabel('Note, in your words').fill('Synthetic unsaved draft');
  await page.getByRole('button', { name: 'Save capture', exact: true }).click();
  await expect(page.locator('#local-status')).toContainText('quota failure');
  await expect(page.getByLabel('Note, in your words')).toHaveValue('Synthetic unsaved draft');
  expect(await readdir(join(root, 'Recall/Sources'))).toHaveLength(0);
});

test('native Ask locates late evidence and distinguishes linked context', async ({ page, request }) => {
  const scope = await (await request.get('/companion/library')).json() as { library_id: string };
  const headers = { accept: 'application/json', 'x-recall-library-id': scope.library_id };
  const target = '11111111-1111-4111-8111-111111111111';
  const source = '22222222-2222-4222-8222-222222222222';
  expect((await request.post('/capture', { headers, form: { operation_id: target, note: 'Synthetic earlier context: the proposed departure was withdrawn.' } })).ok()).toBeTruthy();
  const original = 'Synthetic unrelated preamble. '.repeat(100) + `\nThe ceramic ferry booking is tentative; do not assume it is confirmed.\n[[Recall/Memories/${target}|Earlier context]]`;
  expect((await request.post('/capture', { headers, form: { operation_id: source, note: original } })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByLabel('Ask the notes').fill('What did we decide about that ceramic ferry?');
  await page.getByRole('button', { name: 'Search notes' }).click();
  const direct = page.locator(`article[data-memory="${source}"]`);
  await expect(direct).toContainText('booking is tentative; do not assume it is confirmed.');
  await expect(direct).toContainText('Original excerpt: bytes');
  const linked = page.locator(`article[data-memory="${target}"]`);
  await expect(linked).toContainText('Linked context, not a direct wording match.');
  await expect(linked).toContainText('proposed departure was withdrawn.');
  await expect(page.locator('body')).toContainText('not a generated answer');
});

test('previously authorized pending processing can resume after desktop restart without providers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('connection-state')).toContainText('Connected to library');
  await page.getByLabel('Note, in your words').fill('Synthetic pending interpretation: 5–10 MW?');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save capture', exact: true }).click();
  await expect(page.getByTestId('outbox')).toContainText('Received by library');
  await page.getByRole('link', { name: '· Inspect in library' }).click();
  await expect(page.getByRole('button', { name: 'Resume previously authorized processing' })).toBeVisible();
  const savedUrl = page.url();
  await stop(); await start(root);
  await page.goto(savedUrl);
  await page.getByRole('button', { name: 'Resume previously authorized processing' }).click();
  await expect(page).toHaveURL(savedUrl);
  await expect(page.locator('body')).toContainText('Processing: pending');
  await expect(page.locator('body')).toContainText('5–10 MW?');
  const originals = await readdir(join(root, 'Recall/Sources'));
  expect(originals).toHaveLength(1);
  const id = originals[0]!.replace(/\.txt$/, '');
  const histories = await readdir(join(root, 'Recall/History', id));
  expect(histories).toHaveLength(1);
  expect(await readFile(join(root, 'Recall/Sources', originals[0]!), 'utf8')).toBe('Synthetic pending interpretation: 5–10 MW?');
});
