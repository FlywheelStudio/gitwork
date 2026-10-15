import { defineConfig, devices } from "@playwright/test";

const PORT = 3124;
export const E2E_OUTBOX = ".data/e2e-outbox.jsonl";

// E2E against the Node runtime with a fresh database. scripts/smoke.sh covers the Worker runtime.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `rm -f .data/e2e.sqlite* ${E2E_OUTBOX} && pnpm db:migrate && pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/v1/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: "file:.data/e2e.sqlite",
      EMAIL_TRANSPORT: "outbox",
      EMAIL_OUTBOX_PATH: E2E_OUTBOX,
      BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
    },
  },
});
