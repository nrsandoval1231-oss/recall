import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/dist/**", "**/.expo/**", "**/target/**", "**/coverage/**", "**/.wrangler/**",
      "services/**", "apps/desktop/src-tauri/**", "apps/mobile/ios/**", "apps/mobile/android/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: {
      globals: {
        URL: "readonly",
        Response: "readonly",
        caches: "readonly",
        fetch: "readonly",
        self: "readonly",
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
);
