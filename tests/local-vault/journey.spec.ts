import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { installVaultFixture, control, finishOrganization, relateToMemory } from "./fixture";

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
async function capturedMemoryId(page: Page, expectedNote: string) {
  return page.evaluate(async expectedNote => {
    const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    const status = await invoke("vault_status") as { vault_id: string };
    const memories = await invoke("vault_list", { expectedVaultId: status.vault_id, query: expectedNote, includeDeleted: false }) as { id: string; note: string }[];
    const matches = memories.filter(memory => memory.note === expectedNote);
    if (matches.length !== 1) throw new Error(`Expected one synthetic capture for ${expectedNote}; found ${matches.length}`);
    return matches[0]!.id;
  }, expectedNote);
}
async function capture(page: Page) {
  await page.getByRole("button", { name: "Choose vault", exact: true }).click();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByLabel("Context or note (optional)").fill("SYNTHETIC garden workshop note");
  await page.getByRole("button", { name: "Choose photo & save" }).click();
  await expect(page.getByRole("button", { name: /SYNTHETIC garden workshop note/ })).toBeVisible();
}

test("text capture survives reload, search and correction while preserving its original", async ({ page }) => {
  const original = "SYNTHETIC thought: call the garden shop\nKeep this exact line.  ";
  await installVaultFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Choose vault" }).click();
  await page.getByRole("button", { name: "Write a note" }).click();
  await page.getByLabel("Your note").fill(original);
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("button", { name: /SYNTHETIC thought: call the garden shop/ })).toBeVisible();
  await page.reload();
  await page.getByLabel("Search notes and filenames").fill("garden shop");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /SYNTHETIC thought: call the garden shop/ }).click();
  await expect(page.getByRole("button", { name: "Read this photo with Claude" })).toHaveCount(0);
  await page.getByRole("button", { name: "Correct note" }).click();
  await page.getByLabel("Your correction").fill("SYNTHETIC corrected thought");
  await page.getByRole("button", { name: "Save correction" }).click();
  await page.getByRole("button", { name: "Back to memories" }).click();
  await page.getByLabel("Search notes and filenames").fill("note.txt");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /SYNTHETIC corrected thought/ }).click();
  await expect(page.getByRole("heading", { name: "SYNTHETIC corrected thought" })).toBeVisible();
  await page.getByText("Note details", { exact: true }).click();
  await expect(page.getByText("Original file · note.txt")).toBeVisible();
  await page.getByRole("button", { name: "View original" }).click();
  await expect(page.getByLabel("Original text")).toHaveText(original);
  await expect(page.getByRole("img", { name: "Original photo" })).toHaveCount(0);
  const photoReadResult = await page.evaluate(async () => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: object) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const status = await api.invoke("vault_status") as { vault_id: string };
    const memory = (await api.invoke("vault_list", { expectedVaultId: status.vault_id, query: "note.txt" }) as { id: string }[])[0]!;
    try { await api.invoke("vault_read_photo", { expectedVaultId: status.vault_id, memoryId: memory.id, expectedRevision: 2, operationId: crypto.randomUUID() }); return "accepted"; }
    catch (error) { return String(error); }
  });
  expect(photoReadResult).toContain("cannot be sent to photo reading");
  await control(page, { switchVault: true }); await page.getByRole("button", { name: "Switch vault" }).click();
  await expect(page.getByText("Nothing captured yet")).toBeVisible();
});

test("native text-file import keeps one retry identity, records provenance and renders Markdown inertly", async ({ page }, info) => {
  mkdirSync(".agent/TEXT-FILE-01", { recursive: true });
  await installVaultFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Choose vault" }).click();
  await control(page, { cancelFileImport: true });
  await page.getByRole("button", { name: "Import text file" }).click();
  await expect(page.getByRole("status")).toContainText("File selection cancelled");
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry text file import" })).toBeVisible();
  await control(page, { failFileImportAfterCommit: true });
  await page.getByRole("button", { name: "Retry text file import" }).click();
  await expect(page.getByRole("alert")).toContainText("response was interrupted after commit");
  await page.getByRole("button", { name: "Retry text file import" }).click();
  const imported = page.getByRole("button", { name: /SYNTHETIC imported text/ });
  await expect(imported).toBeVisible();
  const evidence = await page.evaluate(() => {
    const calls = (window as unknown as { syntheticVault: { importCalls: { command: string; args: Record<string, unknown> }[] } }).syntheticVault.importCalls;
    const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    return invoke("vault_status").then(async status => {
      const vaultId = (status as { vault_id: string }).vault_id;
      const rows = await invoke("vault_list", { expectedVaultId: vaultId, query: "SYNTHETIC-import.md", includeDeleted: false }) as { id: string; imported_text?: { original_name: string; original_extension: string; semantic_bytes: number } }[];
      return { calls, rows };
    });
  });
  expect(evidence.calls).toHaveLength(3);
  expect(evidence.calls[0]).toEqual(evidence.calls[1]); expect(evidence.calls[1]).toEqual(evidence.calls[2]);
  expect(Object.keys(evidence.calls[0]!.args).sort()).toEqual(["expectedVaultId", "operationId"]);
  expect(evidence.rows).toHaveLength(1);
  expect(evidence.rows[0]!.imported_text).toMatchObject({ original_name: "SYNTHETIC-import.md", original_extension: "md" });
  await imported.click();
  await expect(page.getByRole("button", { name: "Read this photo with Claude" })).toHaveCount(0);
  await page.getByText("Note details", { exact: true }).click();
  await expect(page.getByText("Original file · SYNTHETIC-import.md")).toBeVisible();
  await page.getByRole("button", { name: "View original" }).click();
  await expect(page.getByLabel("Original text")).toContainText("<script>window.syntheticExecuted = true</script>");
  await expect(page.getByLabel("Original text").locator("script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { syntheticExecuted?: boolean }).syntheticExecuted)).toBeUndefined();
  await expect(page.getByRole("link", { name: "Download original · SYNTHETIC-import.md" })).toHaveAttribute("download", "SYNTHETIC-import.md");
  if (info.project.name === "desktop") await page.screenshot({ path: ".agent/TEXT-FILE-01/text-file-ui.png", fullPage: true, animations: "disabled" });
  await accessible(page);
});

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

test("remembered organization is future-only, recoverable and presents concise text and photo suggestions", async ({ page }, info) => {
  mkdirSync(".agent/ORGANIZE-01", { recursive: true });
  await installVaultFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Choose vault" }).click();
  const identityCheck = await page.evaluate(async () => {
    const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    const selected = await invoke("vault_status") as { vault_id: string; vault_identity: string };
    const capability = await invoke("vault_organization_capability", { expectedVaultId: selected.vault_id }) as { vault_id: string };
    return { session: selected.vault_id, identity: selected.vault_identity, response: capability.vault_id };
  });
  expect(identityCheck.session).not.toBe(identityCheck.identity);
  expect(identityCheck.response).toBe(identityCheck.identity);

  // A note saved before opting in remains local and has no organization operation.
  await page.getByRole("button", { name: "Write a note" }).click();
  await page.getByLabel("Your note").fill("SYNTHETIC before-opt-in note");
  await page.getByRole("button", { name: "Save note" }).click();
  const operationCount = (memoryId: string) => page.evaluate(async memoryId => {
    const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    const selected = await invoke("vault_status") as { vault_id: string };
    return (await invoke("vault_organization_operations", { expectedVaultId: selected.vault_id, memoryId }) as unknown[]).length;
  }, memoryId);
  const preOptInId = await page.evaluate(async () => {
    const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    const selected = await invoke("vault_status") as { vault_id: string };
    return (await invoke("vault_list", { expectedVaultId: selected.vault_id, query: "before-opt-in", includeDeleted: false }) as { id: string }[])[0]!.id;
  });
  expect(await operationCount(preOptInId)).toBe(0);

  await page.getByText("Automatically organize new notes and photos", { exact: true }).click();
  await expect(page.getByText(/Anthropic Claude through your private Recall service/)).toBeVisible();
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText(/Automatic organization is on/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish setup" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Write a note" }).click();
  await page.getByLabel("Your note").fill("SYNTHETIC delayed organization note");
  await page.getByRole("button", { name: "Save note" }).click();
  const row = page.getByRole("button", { name: /SYNTHETIC delayed organization note/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/Organizing in the background|waiting for organization/);
  const optedInId = await capturedMemoryId(page, "SYNTHETIC delayed organization note");
  expect(await operationCount(optedInId)).toBe(1);
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();
  const memoryId = await capturedMemoryId(page, "SYNTHETIC delayed organization note");
  // Complete after the first automatic check so the later backoff check sees a delayed result.
  await page.waitForTimeout(2_200);
  await finishOrganization(page, memoryId);
  await expect(row).toContainText("AI suggestion · not confirmed", { timeout: 10_000 });
  await row.click();
  await expect(page.getByRole("heading", { name: "AI suggestion · not confirmed" })).toBeVisible();
  await expect(page.getByText(/Question · SYNTHETIC question remains uncertain\?/)).toBeVisible();
  await expect(page.getByText(/About this suggestion/)).toBeVisible();
  await expect(page.getByText(/SYNTHETIC source quote/)).toBeVisible();
  await expect(page.getByText(/source-bound to revision|Epistemic status:|Kind: unknown/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View original" })).toHaveCount(1);
  if (info.project.name === "desktop") await page.screenshot({ path: ".agent/ORGANIZE-01/ui-repair-text.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Back to memories" }).click();

  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByLabel("Context or note (optional)").fill("SYNTHETIC photo organization example");
  await page.getByRole("button", { name: "Choose photo & save" }).click();
  const photoRow = page.getByRole("button", { name: /SYNTHETIC photo organization example/ });
  await expect(photoRow).toBeVisible();
  const photoId = await capturedMemoryId(page, "SYNTHETIC photo organization example");
  await page.waitForTimeout(2_200); await finishOrganization(page, photoId);
  await expect(photoRow).toContainText("AI suggestion · not confirmed", { timeout: 10_000 });
  await photoRow.click();
  await expect(page.getByRole("heading", { name: "AI suggestion · not confirmed" })).toBeVisible();
  await expect(page.getByText("Text seen in photo")).toBeVisible();
  await expect(page.getByText("Unclear")).toBeVisible();
  await expect(page.getByRole("button", { name: "Read this photo with Claude" })).toHaveCount(0);
  if (info.project.name === "desktop") await page.screenshot({ path: ".agent/ORGANIZE-01/ui-repair-photo.png", fullPage: true, animations: "disabled" });
  await accessible(page);
});

test("related memory opens by stable ID only after current vault evidence is checked", async ({ page }, info) => {
  await installVaultFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Choose vault" }).click();
  const targetNote = "SYNTHETIC Project Lantern backup power memory";
  await page.getByRole("button", { name: "Write a note" }).click();
  await page.getByLabel("Your note").fill(targetNote);
  await page.getByRole("button", { name: "Save note" }).click();
  const targetId = await capturedMemoryId(page, targetNote);

  await page.getByText("Automatically organize new notes and photos", { exact: true }).click();
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText(/Automatic organization is on/)).toBeVisible();
  const sourceNote = "SYNTHETIC Project Lantern meeting note";
  await relateToMemory(page, targetId);
  await page.getByRole("button", { name: "Write a note" }).click();
  await page.getByLabel("Your note").fill(sourceNote);
  await page.getByRole("button", { name: "Save note" }).click();
  const sourceId = await capturedMemoryId(page, sourceNote);
  const sourceRow = page.getByRole("button", { name: /SYNTHETIC Project Lantern meeting note/ });
  await finishOrganization(page, sourceId);
  await expect(sourceRow).toContainText("AI suggestion · not confirmed", { timeout: 10_000 });
  await sourceRow.click();
  await expect(page.getByRole("region", { name: "Related memories" })).toContainText("Possibly related (unreviewed)");
  await expect(page.getByRole("region", { name: "Related memories" })).toContainText(sourceNote);
  await expect(page.getByRole("region", { name: "Related memories" })).toContainText(targetNote.slice(0, 40));
  if (info.project.name === "desktop") await page.screenshot({ path: ".agent/CONTEXT-01/related-memory.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: /Open related memory/ }).click();
  await expect(page.getByLabel("Original text")).toHaveText(targetNote);
  await page.getByRole("button", { name: "Back to note" }).click();
  await expect(page.getByRole("heading", { name: targetNote })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { syntheticVault: { calls: { command: string; args: Record<string, unknown> }[] } }).syntheticVault.calls.filter(call => call.command === "vault_related_memory").at(-1)?.args)).toEqual({ expectedVaultId: expect.any(String), sourceMemoryId: sourceId, targetMemoryId: targetId });
  expect(await page.evaluate(() => (window as unknown as { syntheticVault: { calls: { command: string }[] } }).syntheticVault.calls.filter(call => call.command === "vault_source").length)).toBe(0);
  await accessible(page);
});

test("interrupted marker commit stays local until explicit future-only recovery", async ({ page }) => {
  await installVaultFixture(page); await page.goto("/");
  await page.getByRole("button", { name: "Choose vault" }).click();
  await control(page, { organizationNeedsSetup: true });
  await page.getByText("Automatically organize new notes and photos", { exact: true }).click();
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText(/Finish setup on this device/i)).toBeVisible();

  const captureAndCount = async (note: string) => {
    await page.getByRole("button", { name: "Write a note" }).click();
    await page.getByLabel("Your note").fill(note);
    await page.getByRole("button", { name: "Save note" }).click();
    return page.evaluate(async note => {
      const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
      const selected = await invoke("vault_status") as { vault_id: string };
      const memory = (await invoke("vault_list", { expectedVaultId: selected.vault_id, query: note, includeDeleted: false }) as { id: string }[])[0]!;
      return (await invoke("vault_organization_operations", { expectedVaultId: selected.vault_id, memoryId: memory.id }) as unknown[]).length;
    }, note);
  };
  expect(await captureAndCount("SYNTHETIC interrupted setup remains local")).toBe(0);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByText(/Automatic organization is on/)).toBeVisible();
  expect(await captureAndCount("SYNTHETIC capture after recovered setup")).toBe(1);
});

test("grounded Ask shows bounded synthetic evidence and opens its verified original", async ({ page }) => {
  await installVaultFixture(page); await page.goto("/");
  await control(page, { askEnabled: true });
  await page.getByRole("button", { name: "Choose vault" }).click();
  await page.getByRole("button", { name: "Write a note" }).click();
  const original = "SYNTHETIC note: the garden workshop moved to Thursday.";
  await page.getByLabel("Your note").fill(original); await page.getByRole("button", { name: "Save note" }).click();
  await page.getByLabel("Your question").fill("What did I write about the garden?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Synthetic source evidence considered for: What did I write about the garden?")).toBeVisible();
  await expect(page.getByRole("button", { name: /Source 1 · Original text/ })).toBeVisible();
  await expect(page.getByText("Current coverage: 1 of 1 eligible records")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { syntheticVault: { calls: { command: string; args: Record<string, unknown> }[] } }).syntheticVault.calls.filter(call => call.command === "vault_ask").at(-1)?.args)).toEqual(expect.objectContaining({ expectedVaultId: expect.any(String), question: "What did I write about the garden?", operationId: expect.any(String) }));
  expect(await page.evaluate(() => Object.keys((window as unknown as { syntheticVault: { calls: { command: string; args: Record<string, unknown> }[] } }).syntheticVault.calls.filter(call => call.command === "vault_ask").at(-1)!.args).sort())).toEqual(["expectedVaultId", "operationId", "question"]);
  mkdirSync(".agent/INTELLIGENCE-01", { recursive: true });
  await page.screenshot({ path: ".agent/INTELLIGENCE-01/ask-answer.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: /Source 1 · Original text/ }).click();
  await expect(page.getByRole("heading", { name: "note.txt" })).toBeVisible();
  await expect(page.getByLabel("Cited source")).toContainText(original);
  await expect(page.getByLabel("Original text")).toHaveText(original);
  await accessible(page);
});

test("historical Ask clarifies before dispatch, recovers its saved interval, and opens the retained revision", async ({ page }) => {
  await installVaultFixture(page); await page.goto("/"); await control(page, { askEnabled: true, unknownHistoryAsk: true });
  await page.getByRole("button", { name: "Choose vault" }).click();
  await page.getByRole("button", { name: "Write a note" }).click();
  const original = "SYNTHETIC retained note says the garden workshop moved to Thursday.";
  await page.getByLabel("Your note").fill(original); await page.getByRole("button", { name: "Save note" }).click();
  await page.getByText("How Ask works and sends data").click();
  await page.getByRole("button", { name: "Allow questions about the past" }).click();
  await expect(page.getByText("Historical Ask is enabled for this workspace.")).toBeVisible();
  await page.getByLabel("Your question").fill("What did I know then?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText(/Which full calendar date should Recall use/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { syntheticVault: { calls: { command: string }[] } }).syntheticVault.calls.some(call => call.command === "vault_ask_history" || call.command === "vault_ask"))).toBe(false);
  await page.getByLabel("Your question").fill("October 8, 2026");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/has not confirmed whether this request finished/)).toBeVisible();
  await expect(page.getByText(/A pending Ask is saved/)).toBeVisible();
  const askSettings = page.locator("details.local-ask-settings").filter({ hasText: "When you ask about the past" });
  if (!(await askSettings.evaluate(element => (element as HTMLDetailsElement).open))) await askSettings.locator("summary").click();
  await expect(page.getByRole("button", { name: "Turn off history" })).toBeDisabled();
  const beforeReload = await page.evaluate(() => (window as unknown as { syntheticVault: { calls: { command: string; args: Record<string, unknown> }[] } }).syntheticVault.calls);
  await page.reload(); await control(page, { askEnabled: true });
  await page.getByText("Ask connection settings").click();
  await page.getByRole("button", { name: "Refresh Ask availability" }).click();
  await expect(page.getByText("Ask is ready for this vault.")).toBeVisible();
  await page.getByText("Ask connection settings").click();
  await expect(page.getByRole("button", { name: "Check Ask status" })).toBeVisible();
  await page.getByRole("button", { name: "Check Ask status" }).click();
  await expect(page.getByText(/Synthetic retained evidence considered for: What did I know then\?/)).toBeVisible();
  await expect(page.getByText("Historical evidence coverage: 1 of 1 eligible items")).toBeVisible();
  await page.getByRole("button", { name: "Open saved note and original" }).click();
  const retainedSource = page.getByRole("region", { name: "Retained historical source" });
  await expect(retainedSource.locator("pre").nth(0)).toHaveText(original);
  await expect(retainedSource.locator("pre").nth(1)).toHaveText(original);
  await page.screenshot({ path: ".agent/HISTORY-01/history-ui.png", fullPage: true });
  const calls = [...beforeReload, ...await page.evaluate(() => (window as unknown as { syntheticVault: { calls: { command: string; args: Record<string, unknown> }[] } }).syntheticVault.calls)];
  const dispatches = calls.filter(call => call.command === "vault_ask_history");
  expect(dispatches).toHaveLength(1);
  expect(dispatches[0]?.args.question).toBe("What did I know then?");
  expect(dispatches[0]?.args.temporal).toMatchObject({ display_date: "2026-10-08", mode: "as_of", display_timezone: expect.any(String) });
  expect(calls.filter(call => call.command === "vault_ask")).toHaveLength(0);
  expect(calls.some(call => call.command === "vault_recover_history_ask")).toBe(true);
});

test("Ask connection setup is separately scoped and keeps preparation, claim and disconnect available", async ({ page }) => {
  await installVaultFixture(page); await page.goto("/"); await page.getByRole("button", { name: "Choose vault" }).click();
  await page.getByText("Ask connection settings").click();
  await page.getByRole("button", { name: "Prepare Ask connection" }).click();
  await expect(page.getByText("Ask connection · pending_owner_approval")).toBeVisible();
  await page.getByLabel("Owner-issued Ask invitation").fill("SYNTHETIC-owner-issued-invitation");
  await page.getByRole("button", { name: "Claim Ask invitation" }).click();
  await expect(page.getByText("Ask connection · connected")).toBeVisible();
  await page.getByLabel("Your question").fill("Synthetic pairing check");
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Disconnect Ask" }).click();
  await expect(page.getByText("Ask connection · disconnected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { syntheticVault: { calls: { command: string }[] } }).syntheticVault.calls.filter(call => call.command.includes("intelligence_pairing")).map(call => call.command))).toEqual(["vault_intelligence_pairing_prepare", "vault_intelligence_pairing_claim", "vault_intelligence_pairing_disconnect"]);
});

test("home stays sparse and a new photo reading shows its unreviewed summary with evidence", async ({ page }) => {
  await installVaultFixture(page); await page.goto("/"); await capture(page);
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh memories" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Removed items" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Rebuild local search" })).toBeHidden();
  await page.getByText("Memory tools").focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Removed items" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Removed items" })).toBeHidden();
  if (process.env.RECALL_REVIEW_SCREENSHOTS === "1" && page.context().browser()?.browserType().name() === "chromium") {
    mkdirSync(".agent/REALIGN-01", { recursive: true });
    await page.screenshot({ path: ".agent/REALIGN-01/ui-home.png", fullPage: true, animations: "disabled" });
  }
  await control(page, { readingEnabled: true });
  await page.getByRole("button", { name: /SYNTHETIC garden workshop note/ }).click();
  await page.getByRole("button", { name: "Read this photo with Claude" }).click();
  await page.getByRole("button", { name: "Send this photo to Claude" }).click();
  await expect(page.getByText("The source mentions seedlings; the count is unclear.")).toBeVisible();
  await expect(page.getByText("SYNTHETIC seedlings 12?").first()).toBeVisible();
  await expect(page.getByText("Summary · unreviewed")).toBeVisible();
  if (process.env.RECALL_REVIEW_SCREENSHOTS === "1" && page.context().browser()?.browserType().name() === "chromium")
    await page.screenshot({ path: ".agent/REALIGN-01/ui-reading.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Back to memories" }).click();
  await page.getByLabel("Search notes and filenames").fill("unclear");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("button", { name: /SYNTHETIC garden workshop note/ })).toBeVisible();
  await page.getByLabel("Search notes and filenames").fill("storm");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("button", { name: /SYNTHETIC garden workshop note/ })).toBeVisible();
});
