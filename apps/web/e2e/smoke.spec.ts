import { expect, test } from "@playwright/test";

test("home redirects to sign-in when signed out", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?next=%2F$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to Gitwork");
});

test("health endpoint reports the SQLite driver", async ({ request }) => {
  const response = await request.get("/api/v1/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true, app: "Gitwork", driver: "sqlite" });
});
