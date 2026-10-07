import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    launchOptions: process.env.RECALL_CHROMIUM
      ? { executablePath: process.env.RECALL_CHROMIUM }
      : {},
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "reduced-motion",
      use: {
        viewport: { width: 1440, height: 1000 },
        contextOptions: { reducedMotion: "reduce" },
      },
    },
  ],
  webServer: {
    command: "npm run dev -w @recall/web -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
