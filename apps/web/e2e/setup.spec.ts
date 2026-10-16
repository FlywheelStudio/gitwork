import { type Page, expect, test } from "@playwright/test";
import { signInCode } from "./outbox";

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.getByLabel("Code").fill(await signInCode(email));
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
