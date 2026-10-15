import { expect, test } from "@playwright/test";

test("home page shows the product name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gitwork");
});

test("health endpoint reports the SQLite driver", async ({ request }) => {
  const response = await request.get("/api/v1/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true, app: "Gitwork", driver: "sqlite" });
});
