import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "core", root: "packages/core", include: ["src/**/*.test.ts"] } },
      { test: { name: "server", root: "packages/server", include: ["test/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 } },
      { test: { name: "db", root: "packages/db", include: ["test/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 } },
      // Framework-free browser code (stores, keymap matching). Components are covered by Playwright.
      { test: { name: "web", root: "apps/web", include: ["src/**/*.test.ts"] } },
    ],
  },
});
