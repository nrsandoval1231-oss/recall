import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "*.spec.ts", workers: 1, timeout: 30000,
  use: { baseURL: "http://127.0.0.1:18787", viewport: { width: 390, height: 844 },
    launchOptions: process.env.RECALL_CHROMIUM ? { executablePath: process.env.RECALL_CHROMIUM } : {},
    trace: "retain-on-failure" },
});
