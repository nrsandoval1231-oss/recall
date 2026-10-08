import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "*.spec.ts", fullyParallel: true, timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:1420", browserName: "chromium",
    viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure",
    launchOptions: process.env.RECALL_CHROMIUM ? { executablePath: process.env.RECALL_CHROMIUM } : {},
  },
  projects: [{ name: "desktop" }, { name: "reduced-motion", use: { contextOptions: { reducedMotion: "reduce" } } }],
  webServer: {
    command: "npm run dev -w @recall/desktop -- --host 127.0.0.1", url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
  },
});
