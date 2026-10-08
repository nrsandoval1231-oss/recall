import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "*.spec.ts", fullyParallel: true, timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:1422", browserName: "chromium",
    viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure",
    launchOptions: process.env.RECALL_CHROMIUM ? { executablePath: process.env.RECALL_CHROMIUM } : {},
  },
  projects: [{ name: "desktop" }, { name: "reduced-motion", use: { contextOptions: { reducedMotion: "reduce" } } }],
  webServer: {
    command: "npm run dev -w @recall/desktop -- --host 127.0.0.1 --port 1422", url: "http://127.0.0.1:1422",
    reuseExistingServer: false,
    // Explicit empties override inherited process configuration and local .env files.
    env: { VITE_API_BASE_URL: "", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
  },
});
