/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), {
    name: "megraph-offline-shell",
    apply: "build",
    generateBundle(_options, bundle) {
      const paths = ["/", "/manifest.webmanifest", "/brand/app-icon-192.png", "/brand/app-icon-512.png", "/fonts/Inter-Regular.ttf", "/fonts/Sora-Variable.ttf",
        ...Object.keys(bundle).map(path => `/${path}`)];
      this.emitFile({type: "asset", fileName: "shell-assets.js", source: `self.MEGRAPH_SHELL = ${JSON.stringify(paths)};`});
    },
  }],
  clearScreen: false,
  server: {
    port: 1420,
    proxy: { "/v1": "http://127.0.0.1:8000" },
    strictPort: true,
    watch: {
      // Windows FSWatcher hits EBUSY on locked Cargo .exe files under src-tauri/target.
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_"],
  test: { environment: "jsdom", globals: false },
});
