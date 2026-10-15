import { defineConfig, devices } from "@playwright/test";

const PORT = 3124;

// E2E against the Node runtime. scripts/smoke.sh covers the Worker runtime.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm db:migrate && pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/v1/health`,
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
