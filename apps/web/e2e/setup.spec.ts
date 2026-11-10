import { type Page, expect, test } from "@playwright/test";
import { emailCount, signInCode } from "./outbox";

async function signIn(page: Page, email: string) {
  const before = emailCount(email);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.getByLabel("Code").fill(await signInCode(email, before));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function setPolicy(page: Page, policy: "open" | "invite-only") {
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/setup/signups") && r.status() === 204);
  await page.getByLabel("Who can create an account").selectOption(policy);
  await saved;
}

test("an instance admin finishes setup; everyone else gets a 404", async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, "admin@example.com");
  await expect(admin.getByRole("link", { name: "Finish setup" })).toBeVisible();
  await admin.getByRole("link", { name: "Finish setup" }).click();
  await expect(admin.getByRole("heading", { name: "Instance setup" })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Create GitHub App" })).toBeVisible();
  await setPolicy(admin, "invite-only");

  const userCtx = await browser.newContext();
  const user = await userCtx.newPage();
  // Invite-only now: a stranger cannot even sign up.
  await user.goto("/sign-in");
  await user.getByLabel("Email").fill("stranger@example.com");
  await user.getByRole("button", { name: "Email me a sign-in code" }).click();
  await user.getByLabel("Code").fill(await signInCode("stranger@example.com"));
  await user.getByRole("button", { name: "Sign in" }).click();
  await expect(user.getByText("Sign-ups are invite-only on this instance.")).toBeVisible();

  // Switch back so other tests can sign up, and check a non-admin cannot reach /setup.
  await setPolicy(admin, "open");
  await signIn(user, "plain@example.com");
  const res = await user.goto("/setup");
  expect(res?.status()).toBe(404);

  await adminCtx.close();
  await userCtx.close();
});

test("an instance admin sees instance health without secret values; everyone else gets a 404", async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, "admin@example.com");
  await admin.goto("/setup");
  await admin.getByRole("link", { name: "Instance health" }).click();
  await expect(admin.getByRole("heading", { name: "Instance health" })).toBeVisible();
  await expect(admin.getByTestId("health-row")).toHaveCount(6);
  await expect(admin.getByTestId("health-row").filter({ hasText: "GitHub App" })).toContainText("Not set up yet.");
  // The E2E server sends email to a file: a warning, named by variable.
  await expect(admin.getByTestId("config-issues")).toContainText("EMAIL_TRANSPORT");
  await expect(admin.locator("body")).not.toContainText("e2e-secret-e2e-secret");

  const userCtx = await browser.newContext();
  const user = await userCtx.newPage();
  await signIn(user, "plain-health@example.com");
  expect((await user.goto("/setup/health"))?.status()).toBe(404);

  await adminCtx.close();
  await userCtx.close();
});
