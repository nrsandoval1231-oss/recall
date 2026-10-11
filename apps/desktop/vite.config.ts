/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Windows FSWatcher hits EBUSY on locked Cargo .exe files under src-tauri/target.
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_"],
  test: { environment: "jsdom", globals: false },
});
