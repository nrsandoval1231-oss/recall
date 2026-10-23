import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installVaultFixture, control, finishAudioOrganization } from "./fixture";

// Synthetic fixture only: the test harness fabricates a silent WAV and a canned transcript. No microphone or real speech is involved.
test.beforeEach(async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: info.project.use.contextOptions?.reducedMotion ?? "no-preference" });
});
async function accessible(page: import("@playwright/test").Page) {
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
}

test("one-gesture recording saves first, transcribes afterwards, plays back and takes a human correction", async ({ page }) => {
  await installVaultFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Choose vault" }).click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop & save" })).toBeFocused();
  await expect(page.getByRole("timer", { name: "Elapsed recording time" })).toBeVisible();
  await accessible(page);
  await page.getByRole("button", { name: "Stop & save" }).click();
  await expect(page.getByText("Saved on this computer · transcribing on this computer…")).toBeVisible();
  await accessible(page);
  await control(page, { audioTranscribe: true });
  await expect(page.getByText("Saved on this computer · transcript ready")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Open recording" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Voice recording" })).toBeVisible();
  await expect(page.getByText("SYNTHETIC remember to water the seedlings.")).toBeVisible();
  await expect(page.getByText("Machine transcript · unreviewed")).toBeVisible();
  await expect(page.locator("audio[controls]").first()).toBeVisible();
  await expect(page.getByText("Machine transcript may omit or mishear words; check the recording.")).toBeAttached();
  // Audio is not organized and its transcript is never presented as verified.
  await expect(page.getByText(/AI suggestion/)).toHaveCount(0);
  await accessible(page);
  // The recording and its machine transcript survive a restart of the renderer.
  await page.reload();
  await page.getByRole("button", { name: /Voice recording/ }).click();
  await expect(page.getByText("SYNTHETIC remember to water the seedlings.")).toBeVisible();
  await page.getByRole("button", { name: "Correct transcript" }).click();
  await page.getByLabel("Your transcript correction").fill("Water the seedlings on Friday.");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("heading", { name: "Your corrected transcript" })).toBeVisible();
  await expect(page.getByText("Water the seedlings on Friday.")).toBeVisible();
  await expect(page.getByText("Machine transcript kept in history · unreviewed")).toBeVisible();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "Transcript", exact: true })).toBeVisible();
  await expect(page.getByText(/audio_transcript_correction/)).toBeVisible();
});

test("a denied microphone is explained without saving anything", async ({ page }) => {
  await installVaultFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Choose vault" }).click();
  await control(page, { audioDenied: true });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText(/Microphone access was denied/)).toBeVisible();
  await expect(page.getByText(/Nothing was saved\./)).toBeVisible();
  await expect(page.getByText("Nothing captured yet")).toBeVisible();
  await accessible(page);
});

test("voice-note organization is a separate remembered choice and yields unreviewed proposals under the transcript", async ({ page }) => {
  await installVaultFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Choose vault" }).click();
  await page.getByText("Organize voice notes automatically", { exact: true }).click();
  await expect(page.getByText(/The recording or audio file itself is never sent/)).toBeVisible();
  await expect(page.getByText("Voice-note organization is off. New voice notes stay local.")).toBeVisible();
  await page.getByRole("button", { name: "Turn on voice organization" }).click();
  await expect(page.getByText(/Voice-note organization is on with Anthropic Claude/)).toBeVisible();
  // The text/photo control is untouched by the voice decision.
  await page.getByText("Automatically organize new notes and photos", { exact: true }).click();
  await expect(page.getByText("Automatic organization is off. New captures stay local.")).toBeVisible();
  await accessible(page);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop & save" }).click();
  await control(page, { audioTranscribe: true });
  await expect(page.getByText("Saved on this computer · transcript ready")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Open recording" }).click();
  await expect(page.getByText("Queued for organization")).toBeVisible();
  const id = await page.evaluate(async () => {
    const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    const status = await invoke("vault_status") as { vault_id: string };
    return ((await invoke("vault_list", { expectedVaultId: status.vault_id, query: "", includeDeleted: false }) as { id: string }[])[0]!).id;
  });
  await finishAudioOrganization(page, id);
  await expect(page.getByRole("heading", { name: "Unreviewed machine proposals derived from an unreviewed machine transcript" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("SYNTHETIC voice summary: water the seedlings")).toBeVisible();
  await expect(page.getByRole("button", { name: /approve|verify|confirm/i })).toHaveCount(0);
  await accessible(page);
});
