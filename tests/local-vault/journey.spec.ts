import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installVaultFixture, control } from "./fixture";

test.beforeEach(async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: info.project.use.contextOptions?.reducedMotion ?? "no-preference" });
});

async function screenshot(page: Page, info: TestInfo, name: string) {
  if (process.env.RECALL_SCREENSHOTS === "1" && info.project.name === "desktop")
    await page.screenshot({ path: `docs/implementation/local-vault/synthetic-${name}.png`, fullPage: true, animations: "disabled" });
}
async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
}
async function capture(page: Page) {
  await page.getByRole("button", { name: "Choose vault", exact: true }).click();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByLabel("Context or note (optional)").fill("SYNTHETIC garden workshop note");
  await page.getByRole("button", { name: "Choose photo & save" }).click();
  await expect(page.getByRole("button", { name: /SYNTHETIC garden workshop note/ })).toBeVisible();
}

test("no-config local journey: import, search, original, conflict, history and reload", async ({ page }, info) => {
  const external: string[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") { external.push(url.href); return route.abort(); }
    return route.continue();
  });
  await installVaultFixture(page); await page.goto("/");
  await expect(page.getByText("No account needed. No cloud connection.")).toBeVisible();
  await accessible(page); await screenshot(page, info, "first-use");
  await capture(page); await screenshot(page, info, "home"); await accessible(page);
  await page.getByLabel("Search notes and filenames").fill("  CaRd   GARDEN  ");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("button", { name: /SYNTHETIC garden workshop note/ })).toBeVisible();
  await page.getByLabel("Search notes and filenames").fill("card absent");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(/No matching notes or filenames/)).toBeVisible();
  // This term occurs only in the filename, never in the human note.
  await page.getByLabel("Search notes and filenames").fill("TeSt-CaRd");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Matching memories" })).toBeVisible();
  await page.getByRole("button", { name: /SYNTHETIC garden workshop note/ }).click();
  await page.getByRole("button", { name: "View original" }).click();
  const original = page.getByRole("img", { name: "Original photo" });
  await expect(original).toBeVisible(); await expect(page.getByText(/Original bytes unchanged/)).toBeVisible();
  expect(await original.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(720);
  // Compare displayed blob bytes with an independently requested fixture source/hash.
  expect(await page.evaluate(async () => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: object) => Promise<Record<string, unknown>> } };
    const s = await w.__TAURI_INTERNALS__.invoke("vault_status");
    const calls = (window as unknown as { syntheticVault: { calls: { command: string; args: Record<string, unknown> }[] } }).syntheticVault.calls;
    const focusedId = calls.slice().reverse().find(call => call.command === "vault_source")?.args.memoryId;
    if (typeof focusedId !== "string") throw new Error("Focused source identity missing");
    const source = await w.__TAURI_INTERNALS__.invoke("vault_source", { expectedVaultId: s.vault_id, memoryId: focusedId });
    const bytes = await (await fetch(document.querySelector("img")!.src)).arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    return hash === source.sha256;
  })).toBe(true);
  await accessible(page); await screenshot(page, info, "evidence");
  await page.getByRole("button", { name: "Back to note" }).click();
  await page.getByRole("button", { name: "Correct note" }).click();
  await page.getByLabel("Your correction").fill("SYNTHETIC retained correction");
  await control(page, { conflict: true }); await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("alert")).toContainText("Revision conflict");
  await page.getByRole("button", { name: "Reload latest note" }).click();
  await expect(page.getByText("SYNTHETIC external Obsidian edit", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Your correction")).toHaveValue("SYNTHETIC retained correction");
  await expect(page.getByRole("button", { name: "Save correction" })).toBeDisabled();
  await accessible(page); await screenshot(page, info, "conflict");
  await control(page, { cancelSelect: true }); await page.getByRole("button", { name: "Switch vault" }).click();
  await expect(page.getByLabel("Your correction")).toHaveValue("SYNTHETIC retained correction");
  await page.getByLabel("I reviewed the latest note").check(); await page.getByRole("button", { name: "Save correction" }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Revision 1", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revision 3", exact: true })).toBeVisible();
  await expect(page.getByText(/human:obsidian/)).toBeVisible(); await accessible(page); await screenshot(page, info, "history");
  await page.getByRole("button", { name: "Back to note" }).click(); await page.getByRole("button", { name: "Back to memories" }).click();
  await expect(page.getByLabel("Search notes and filenames")).toHaveValue("TeSt-CaRd");
  await page.reload(); await expect(page.getByRole("button", { name: /SYNTHETIC retained correction/ })).toBeVisible();
  // Optional empty annotation remains retrievable by its filename alone.
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByRole("button", { name: "Choose photo & save" }).click();
  await page.getByLabel("Search notes and filenames").fill("TEST-CARD");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("button", { name: /SYNTHETIC-test-card.png/ })).toBeVisible();
  expect(await page.evaluate(async () => {
    const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    const status = await invoke("vault_status") as { vault_id: string };
    const memories = await invoke("vault_list", { expectedVaultId: status.vault_id, query: "test-card" }) as { id: string; note: string }[];
    return Promise.all(memories.map(async m => ({ note: m.note, revisions: (await invoke("vault_history", { expectedVaultId: status.vault_id, memoryId: m.id }) as unknown[]).length })));
  })).toEqual(expect.arrayContaining([{ note: "SYNTHETIC retained correction", revisions: 3 }, { note: "", revisions: 1 }]));
  expect(external).toEqual([]);
  if (info.project.name === "reduced-motion") {
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    expect(await page.locator(".local-surface button").first().evaluate(el => {
      const style = getComputedStyle(el); return [style.animationName, style.transitionDuration, style.scrollBehavior];
    })).toEqual(["none", "0s", "auto"]);
  }
});

test("picker cancellation retains draft; vault switch rejects late evidence", async ({ page }) => {
  await installVaultFixture(page); await page.goto("/"); await capture(page);
  expect(await page.evaluate(async () => {
    const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    const status = await invoke("vault_status") as { vault_id: string };
    return Promise.all(["vault_source", "vault_history"].flatMap(command => [undefined, "unknown-memory"].map(async memoryId => {
      try { await invoke(command, { expectedVaultId: status.vault_id, memoryId }); return "accepted"; }
      catch { return "rejected"; }
    })));
  })).toEqual(["rejected", "rejected", "rejected", "rejected"]);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByLabel("Context or note (optional)").fill("SYNTHETIC cancelled draft");
  await control(page, { cancelCapture: true }); await page.getByRole("button", { name: "Choose photo & save" }).click();
  await expect(page.getByText("Photo selection cancelled. Your note is still here.")).toBeVisible();
  await expect(page.getByLabel("Context or note (optional)")).toHaveValue("SYNTHETIC cancelled draft");
  await page.getByRole("button", { name: "Close capture" }).click();
  await page.getByRole("button", { name: /SYNTHETIC garden workshop note/ }).click();
  await control(page, { delaySource: true }); await page.getByRole("button", { name: "View original" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { syntheticVault: { sourcePending: boolean } }).syntheticVault.sourcePending)).toBe(true);
  await control(page, { switchVault: true }); await page.getByRole("button", { name: "Switch vault" }).click();
  await expect(page.getByText("/synthetic/vault-b")).toBeVisible();
  await page.evaluate(() => (window as unknown as { syntheticVault: { releaseSource: () => void } }).syntheticVault.releaseSource());
  await expect(page.getByText("Nothing captured yet")).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(0);
  await expect(page.getByText(/SYNTHETIC garden workshop/)).toHaveCount(0);
});

test("ordinary browser preview honestly has no native persistence", async ({ page }) => {
  await page.goto("/"); await expect(page.getByText(/This browser preview cannot read or save a native vault/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose vault" })).toHaveCount(0); await accessible(page);
});
