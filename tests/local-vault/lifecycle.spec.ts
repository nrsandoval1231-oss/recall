import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installVaultFixture, control } from "./fixture";
import type { VaultMemory } from "../../apps/desktop/src/platform/local-vault";

const note = "SYNTHETIC lifecycle garden note";
const row = (page: Page) => page.getByRole("button", { name: new RegExp(note) });
async function patchMemory(page: Page, patch: Partial<VaultMemory>) {
  // Synthetic native-boundary state only; real rename/missing-file semantics are Rust-tested.
  await page.evaluate(patch => {
    const key = "synthetic.test.native";
    const state = JSON.parse(localStorage.getItem(key)!);
    Object.assign(state.memories[0], patch);
    localStorage.setItem(key, JSON.stringify(state));
  }, patch);
  await page.reload();
}
async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  if (process.env.RECALL_SCREENSHOTS === "1" && info.project.name === "desktop")
    await page.screenshot({ path: `docs/implementation/local-vault-lifecycle/synthetic-${name}.png`, fullPage: true, animations: "disabled" });
}
async function calls(page: Page, command: string) {
  return page.evaluate(command => (window as unknown as { syntheticVault: { calls: { command: string; args: Record<string, unknown> }[] } }).syntheticVault.calls.filter(call => call.command === command), command);
}

test.beforeEach(async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: info.project.use.contextOptions?.reducedMotion ?? "no-preference" });
  await installVaultFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Choose vault", exact: true }).click();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByLabel("Context or note (optional)").fill(note);
  await page.getByRole("button", { name: "Choose photo & save" }).click();
  await expect(row(page)).toBeVisible();
});

test("flat renamed basename is searchable; missing note requires explicit restore and retains history", async ({ page }, info) => {
  await patchMemory(page, { note_path: "SYNTHETIC-renamed-garden.md" });
  await page.getByLabel("Search notes and filenames").fill("renamed-garden");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await row(page).click();
  await expect(page.getByText("SYNTHETIC-renamed-garden.md", { exact: true })).toBeVisible();
  await patchMemory(page, { state: "missing", note_path: null, conflict: "SYNTHETIC Markdown note is missing" });
  await row(page).click();
  await expect(page.getByText("Markdown note missing · decision needed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View original" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Correct note" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Restore missing note" })).toBeEnabled();
  await accessible(page); await screenshot(page, info, "missing");
  await page.getByRole("button", { name: "Restore missing note" }).click();
  await expect(page.getByText("Note restored in vault · This device only", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View original" })).toBeEnabled();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText(/restore · human:recall/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revision 1", exact: true })).toBeVisible();
  await page.reload(); await row(page).click();
  await expect(page.getByText(/Revision 2/)).toBeVisible();
  expect((await calls(page, "vault_restore_note")).length).toBe(0); // Reload never retries a restore.
});

test("removal requires confirmation; removed history survives reload and stale capture retry", async ({ page }, info) => {
  const originalCapture = (await calls(page, "vault_capture"))[0]!.args;
  await row(page).click(); await page.getByRole("button", { name: "Remove from Recall", exact: true }).click();
  await expect(page.getByRole("region", { name: "Confirm removal" })).toBeVisible();
  await expect(page.getByText(/There is no in-app undo/)).toBeVisible();
  await accessible(page); await screenshot(page, info, "confirmation");
  await page.getByRole("button", { name: "Cancel removal" }).click();
  expect(await calls(page, "vault_remove")).toHaveLength(0);
  await page.getByRole("button", { name: "Remove from Recall", exact: true }).click();
  await page.getByRole("button", { name: "Confirm removal", exact: true }).click();
  await expect(page.getByText("Removed from Recall · files retained", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View original" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Correct note" })).toBeDisabled();
  await page.getByRole("button", { name: "Back to memories" }).click();
  await expect(row(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Removed items", exact: true }).click();
  await expect(row(page)).toBeVisible();
  await expect(page.getByText("Saved in vault · This device only", { exact: true })).toHaveCount(0);
  await accessible(page); await screenshot(page, info, "removed");
  await row(page).click(); await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText(/remove · human:recall/)).toBeVisible();
  await accessible(page); await screenshot(page, info, "removed-history");
  // Restore an old renderer import intent, as after lost acknowledgment; native receipt is current-deleted.
  await page.evaluate(args => {
    const state = JSON.parse(localStorage.getItem("synthetic.test.native")!);
    localStorage.setItem(`recall.local.capture:${JSON.stringify([state.status.root, state.status.vault_identity])}`, JSON.stringify({ operationId: args.operationId, note: args.note }));
  }, originalCapture);
  await page.reload(); await page.getByRole("button", { name: "Retry pending import", exact: true }).click();
  await expect(page.getByText("This memory is already removed · files retained", { exact: true })).toBeVisible();
  await expect(row(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Rebuild local search", exact: true }).click();
  await expect(page.getByText("Local keyword search rebuilt from validated vault records.", { exact: true })).toBeVisible();
  await expect(row(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Removed items", exact: true }).click();
  await expect(row(page)).toHaveCount(1);
});

test("failed removal retains exact decision across cancellation and supports explicit current-state review", async ({ page }) => {
  await row(page).click(); await page.getByRole("button", { name: "Remove from Recall", exact: true }).click();
  await control(page, { failRemovalOnce: true });
  await page.getByRole("button", { name: "Confirm removal", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("SYNTHETIC removal interrupted");
  const submitted = (await calls(page, "vault_remove"))[0]!.args;
  await control(page, { cancelSelect: true }); await page.getByRole("button", { name: "Switch vault" }).click();
  await page.getByRole("button", { name: "Cancel removal" }).click();
  await page.getByRole("button", { name: "Back to memories" }).click(); await row(page).click();
  await expect(page.getByRole("heading", { name: "Pending removal decision" })).toBeVisible();
  await page.getByRole("button", { name: "Reload current state" }).click();
  await expect(page.getByText("Current state · active · revision 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry same removal" }).click();
  await expect(page.getByText("Removed from Recall · files retained", { exact: true })).toBeVisible();
  expect((await calls(page, "vault_remove"))[1]!.args).toEqual(submitted);
});

test("failed rebuild preserves query and stale rows; successful rebuild revalidates and keeps removed mode", async ({ page }, info) => {
  await page.getByLabel("Search notes and filenames").fill("garden"); await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Matching memories" })).toBeVisible();
  await page.getByRole("button", { name: "Rebuild local search", exact: true }).click();
  await expect(page.getByText("Local keyword search rebuilt from validated vault records.", { exact: true })).toBeVisible();
  await control(page, { failRebuildOnce: true }); await page.getByRole("button", { name: "Rebuild local search", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("SYNTHETIC rebuild unavailable");
  await expect(row(page)).toBeVisible(); await expect(page.getByLabel("Search notes and filenames")).toHaveValue("garden");
  await expect(page.getByText(/Previously loaded results · not currently verified/)).toBeVisible();
  await expect(page.getByText("Local keyword search rebuilt from validated vault records.", { exact: true })).toHaveCount(0);
  await accessible(page); await screenshot(page, info, "failed-rebuild");
  await row(page).click(); await expect(page.getByText("Previously loaded memory · current state not verified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to memories" }).click();
  await page.getByRole("button", { name: "Rebuild local search", exact: true }).click();
  await expect(page.getByText(/Previously loaded results/)).toHaveCount(0);
  await page.getByRole("button", { name: "Removed items", exact: true }).click();
  await page.getByRole("button", { name: "Rebuild local search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Removed items", exact: true })).toBeVisible();
  await expect(page.getByText("No removed items.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Search notes and filenames")).toBeHidden();
});

test("late removal reply cannot expose old-vault state after successful selection", async ({ page }) => {
  await row(page).click(); await page.getByRole("button", { name: "Remove from Recall", exact: true }).click();
  await control(page, { delayRemoval: true }); await page.getByRole("button", { name: "Confirm removal", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { syntheticVault: { removalPending: boolean } }).syntheticVault.removalPending)).toBe(true);
  await control(page, { switchVault: true }); await page.getByRole("button", { name: "Switch vault" }).click();
  await expect(page.getByText("/synthetic/vault-b")).toBeVisible();
  await page.evaluate(() => (window as unknown as { syntheticVault: { releaseRemoval: () => void } }).syntheticVault.releaseRemoval());
  await expect(page.getByText("Nothing captured yet")).toBeVisible();
  await expect(page.getByText("Removed from Recall · files retained", { exact: true })).toHaveCount(0);
  await expect(row(page)).toHaveCount(0);
});
