import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { control, installVaultFixture } from "./fixture";

const annotation = "SYNTHETIC photo reading annotation";
async function capture(page: Page) {
  await page.getByRole("button", { name: "Choose vault", exact: true }).click();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByLabel("Context or note (optional)").fill(annotation);
  await page.getByRole("button", { name: "Choose photo & save" }).click();
  await expect(page.getByRole("button", { name: new RegExp(annotation) })).toBeVisible();
}
async function open(page: Page) { await page.getByRole("button", { name: new RegExp(annotation) }).click(); }
async function send(page: Page) {
  await page.getByRole("button", { name: "Read this photo with Claude", exact: true }).click();
  await page.getByRole("button", { name: "Send this photo to Claude", exact: true }).click();
}
async function calls(page: Page, command: string) {
  return page.evaluate(command => (window as unknown as { syntheticVault: { calls: { command: string; args: Record<string, unknown> }[] } }).syntheticVault.calls.filter(c => c.command === command), command);
}
async function accessible(page: Page) { expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]); }
async function screenshot(page: Page, info: TestInfo, name: string) {
  if (process.env.RECALL_SCREENSHOTS === "1" && info.project.name === "desktop") await page.screenshot({ path: `docs/implementation/claude-vault-reading/synthetic-${name}.png`, fullPage: true, animations: "disabled" });
}
test.beforeEach(async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: info.project.use.contextOptions?.reducedMotion ?? "no-preference" });
  await installVaultFixture(page); await page.goto("/"); await capture(page);
});

test("disconnected photo reading preserves local use and never dispatches on capture or focus", async ({ page }, info) => {
  await open(page); await expect(page.getByText(/Claude reading is not connected/)).toBeVisible(); await expect(page.getByRole("button", { name: "Read this photo with Claude" })).toBeDisabled(); expect(await calls(page, "vault_read_photo")).toEqual([]); await accessible(page); await screenshot(page, info, "disconnected");
  await page.getByRole("button", { name: "Back to memories" }).click(); await page.getByLabel("Search notes and filenames").fill("reading annotation"); await page.getByRole("button", { name: "Search", exact: true }).click(); await expect(page.getByRole("button", { name: new RegExp(annotation) })).toBeVisible(); await expect(page.getByText(/sign in|email link/i)).toHaveCount(0);
});

test("explicit consent yields unreviewed original comparison, effective correction search and retained history", async ({ page }, info) => {
  const external: string[] = []; await page.route("**/*", route => { const url = new URL(route.request().url()); if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") { external.push(url.href); return route.abort(); } return route.continue(); });
  await control(page, { readingEnabled: true }); await open(page);
  await page.getByRole("button", { name: "Read this photo with Claude" }).click(); await expect(page.getByRole("region", { name: "Claude reading consent" })).toBeVisible(); await accessible(page); await screenshot(page, info, "consent"); expect(await calls(page, "vault_read_photo")).toHaveLength(0); await page.getByRole("button", { name: "Keep it local" }).click(); expect(await calls(page, "vault_read_photo")).toHaveLength(0);
  await send(page); await expect(page.getByRole("heading", { name: "Unreviewed machine reading", exact: true })).toBeVisible(); await expect(page.getByText("SYNTHETIC seedlings 12?", { exact: true })).toBeVisible(); await expect(page.getByText(/question mark remains unresolved/)).toBeVisible(); await expect(page.getByText(/synthetic-claude/)).toBeVisible(); const image = page.getByRole("img", { name: "Original photo for comparison" }); await expect(image).toBeVisible(); await expect(page.getByText(/Original bytes unchanged/)).toBeVisible(); expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(720); await page.evaluate(() => window.scrollTo(0, 0)); await expect(page.getByText("SYNTHETIC seedlings 12?", { exact: true })).toBeInViewport({ ratio: 1 }); await expect(image).toBeInViewport({ ratio: 1 }); await accessible(page); await screenshot(page, info, "unreviewed-comparison");
  await page.getByRole("button", { name: "Correct reading" }).click(); await page.getByLabel("Your reading correction").fill("SYNTHETIC marigolds 12, still a proposal"); await page.getByRole("button", { name: "Save reading correction" }).click(); await expect(page.getByRole("heading", { name: "Your corrected reading" })).toBeVisible(); await expect(page.getByText(annotation, { exact: true })).toBeVisible(); await accessible(page); await screenshot(page, info, "corrected-comparison");
  await send(page); await expect(page.getByText("Reading saved in your vault.", { exact: true })).toBeVisible(); await expect(page.getByText("SYNTHETIC marigolds 12, still a proposal", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click(); await expect(page.getByText(/machine_reading · machine:anthropic/).first()).toBeVisible(); await expect(page.getByText(/reading_correction · human:recall/)).toBeVisible(); await accessible(page); await screenshot(page, info, "reading-history");
  await page.getByRole("button", { name: "Back to note" }).click(); await page.getByRole("button", { name: "Back to memories" }).click(); await page.getByLabel("Search notes and filenames").fill("marigolds"); await page.getByRole("button", { name: "Search", exact: true }).click(); await expect(page.getByRole("button", { name: new RegExp(annotation) })).toBeVisible(); await page.getByLabel("Search notes and filenames").fill("seedlings"); await page.getByRole("button", { name: "Search", exact: true }).click(); await expect(page.getByText(/No matching notes or filenames/)).toBeVisible();
  await page.reload(); await open(page); await expect(page.getByRole("heading", { name: "Your corrected reading" })).toBeVisible(); expect(await calls(page, "vault_read_photo")).toHaveLength(0); expect(external).toEqual([]);
});

test("pending cancellation rejects delayed completion and keeps possible processing cost visible", async ({ page }, info) => {
  await control(page, { readingEnabled: true, delayReading: true }); await open(page); await send(page); await expect(page.getByText("Reading this photo with Claude…", { exact: true })).toBeVisible(); await accessible(page); await screenshot(page, info, "processing"); const submitted = (await calls(page, "vault_read_photo"))[0]!.args;
  await page.getByRole("button", { name: "Cancel reading", exact: true }).click(); await expect(page.getByText(/Reading cancelled locally/)).toBeVisible(); await page.evaluate(() => (window as unknown as { syntheticVault: { releaseReading: () => void } }).syntheticVault.releaseReading()); await expect(page.getByRole("heading", { name: "Unreviewed machine reading" })).toHaveCount(0); await expect(page.getByText(/Cancellation cannot promise/)).toBeVisible(); expect((await calls(page, "vault_cancel_reading"))[0]!.args.operationId).toBe(submitted.operationId);
});

test("uncertain operation recovery is explicit and preserves the original operation", async ({ page }, info) => {
  await control(page, { readingEnabled: true, unknownReading: true }); await open(page); await send(page); await expect(page.getByText("Reading status: unknown", { exact: true })).toBeVisible(); await expect(page.getByText(/may resend this photo/)).toBeVisible(); await accessible(page); await screenshot(page, info, "reading-recovery"); const submitted = (await calls(page, "vault_read_photo"))[0]!.args;
  await page.getByRole("button", { name: "Retry or recover reading" }).click(); await expect(page.getByRole("heading", { name: "Unreviewed machine reading" })).toBeVisible(); expect((await calls(page, "vault_recover_reading"))[0]!.args.operationId).toBe(submitted.operationId); expect(await calls(page, "vault_read_photo")).toHaveLength(1);
});

test("vault switch cancels old reading and cannot expose its delayed response in the new vault", async ({ page }) => {
  await control(page, { readingEnabled: true, delayReading: true }); await open(page); await send(page); await expect(page.getByText("Reading this photo with Claude…", { exact: true })).toBeVisible(); await control(page, { switchVault: true }); await page.getByRole("button", { name: "Switch vault" }).click(); await expect(page.getByText("/synthetic/vault-b", { exact: true })).toBeVisible(); await page.evaluate(() => (window as unknown as { syntheticVault: { releaseReading: () => void } }).syntheticVault.releaseReading()); await expect(page.getByText("Nothing captured yet")).toBeVisible(); await expect(page.getByText(/SYNTHETIC seedlings/)).toHaveCount(0); await expect(page.getByRole("img")).toHaveCount(0);
});

test("reading correction conflict retains draft and comparison fits a narrow viewport", async ({ page }, info) => {
  await control(page, { readingEnabled: true }); await open(page); await send(page); await page.getByRole("button", { name: "Correct reading" }).click(); await page.getByLabel("Your reading correction").fill("SYNTHETIC retained reading draft"); await control(page, { conflict: true }); await page.getByRole("button", { name: "Save reading correction" }).click(); await expect(page.getByRole("alert")).toContainText("Revision conflict"); await page.getByRole("button", { name: "Reload latest reading" }).click(); await expect(page.getByLabel("Your reading correction")).toHaveValue("SYNTHETIC retained reading draft"); await expect(page.getByRole("button", { name: "Save reading correction" })).toBeDisabled(); await page.getByLabel("I reviewed the latest reading").check(); await page.getByRole("button", { name: "Save reading correction" }).click(); await expect(page.getByRole("heading", { name: "Your corrected reading" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByRole("img", { name: "Original photo for comparison" })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await accessible(page); await screenshot(page, info, "narrow-comparison");
});

test("revision-zero native diagnostic keeps a copyable draft and reload route until repaired", async ({ page }) => {
  await control(page, { readingEnabled: true }); await open(page); await send(page); await page.getByRole("button", { name: "Correct reading" }).click(); await page.getByLabel("Your reading correction").fill("SYNTHETIC precious retained draft"); await control(page, { conflict: true }); await page.getByRole("button", { name: "Save reading correction" }).click(); await expect(page.getByRole("alert")).toContainText("Revision conflict"); await control(page, { diagnosticReading: true }); await page.getByRole("button", { name: "Reload latest reading" }).click(); await expect(page.getByRole("heading", { name: "Memory needs attention" })).toBeVisible(); const draft = page.getByLabel("Your reading correction"); await expect(draft).toHaveValue("SYNTHETIC precious retained draft"); await expect(draft).toHaveAttribute("readonly", ""); await expect(page.getByRole("button", { name: "Save reading correction" })).toBeDisabled(); await expect(page.getByRole("img", { name: "Original photo for comparison" })).toHaveCount(0); await accessible(page);
  await control(page, { diagnosticReading: false }); await page.getByRole("button", { name: "Reload latest reading" }).click(); await expect(draft).toHaveValue("SYNTHETIC precious retained draft"); await page.getByLabel("I reviewed the latest reading").check(); await page.getByRole("button", { name: "Save reading correction" }).click(); await expect(page.getByRole("heading", { name: "Your corrected reading" })).toBeVisible(); await expect(page.getByText("SYNTHETIC precious retained draft", { exact: true })).toBeVisible();
});

test("delayed original remains readable after an uncertain reread", async ({ page }) => {
  await control(page, { readingEnabled: true }); await open(page); await send(page); await expect(page.getByRole("img", { name: "Original photo for comparison" })).toBeVisible(); await page.getByRole("button", { name: "Back to memories" }).click(); await control(page, { delaySource: true, unknownReading: true }); await open(page); await expect(page.getByText("Loading the original photo…", { exact: true })).toBeVisible(); await send(page); await expect(page.getByText("Reading status: unknown", { exact: true })).toBeVisible(); await page.evaluate(() => (window as unknown as { syntheticVault: { releaseSource: () => void } }).syntheticVault.releaseSource()); await expect(page.getByRole("img", { name: "Original photo for comparison" })).toBeVisible(); await expect(page.getByText("Loading the original photo…", { exact: true })).toHaveCount(0); await accessible(page);
});
