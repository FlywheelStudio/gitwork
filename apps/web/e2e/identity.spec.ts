import { type Page, expect, test } from "@playwright/test";
import { lastEmail, signInCode } from "./outbox";

async function signInWithCode(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.getByLabel("Code").fill(await signInCode(email));
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an owner creates a workspace and a client joins it by invite as Read Only", async ({ browser }) => {
  // Owner: sign in, create the account and first workspace, invite the client.
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await owner.goto("/");
  await signInWithCode(owner, "owner@example.com");
  await owner.getByLabel("Account name").fill("Acme Agency");
  await owner.getByLabel("First workspace").fill("Client Website");
  await owner.getByRole("button", { name: "Create" }).click();
  await expect(owner.getByRole("heading", { name: "Client Website" })).toBeVisible();
  await expect(owner.getByText("Your role: Owner")).toBeVisible();

  await owner.getByRole("link", { name: "Members" }).click();
  await owner.getByLabel("Email").fill("client@example.com");
  await owner.getByLabel("Role").selectOption("read_only");
  await owner.getByRole("button", { name: "Send invite" }).click();
  await expect(owner.getByTestId("invite-row")).toContainText("client@example.com");

  // Client: open the invite link, sign in as the invited email, accept.
  const [, invitePath] = await lastEmail("client@example.com", /http:\/\/localhost:\d+(\/invite\/[A-Za-z0-9_-]+)/);
  const clientCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  await client.goto(invitePath!);
  await expect(client.getByText("You are invited to Client Website as Read Only.")).toBeVisible();
  await client.getByRole("link", { name: "Sign in as client@example.com to accept" }).click();
  await expect(client.getByLabel("Email")).toHaveValue("client@example.com");
  await signInWithCode(client, "client@example.com");
  await client.getByRole("button", { name: "Accept invite" }).click();
  await expect(client.getByRole("heading", { name: "Client Website" })).toBeVisible();
  await expect(client.getByText("Your role: Read Only")).toBeVisible();

  // Read Only sees the members but cannot invite.
  await client.getByRole("link", { name: "Members" }).click();
  await expect(client.getByTestId("member-row")).toHaveCount(2);
  await expect(client.getByRole("button", { name: "Send invite" })).toHaveCount(0);

  // The owner now sees the client as a member and no pending invite.
  await owner.reload();
  await expect(owner.getByTestId("member-row").filter({ hasText: "client@example.com" })).toContainText("Read Only");
  await expect(owner.getByTestId("invite-row")).toHaveCount(0);

  await ownerCtx.close();
  await clientCtx.close();
});

test("the sign-in link signs in only after a click", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("linker@example.com");
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  const [link] = await lastEmail("linker@example.com", /http:\/\/localhost:\d+\/sign-in\/verify#\S+/);
  const url = new URL(link!);

  await page.goto(url.pathname + url.hash);
  // Loading the page must not sign in (link scanners load pages).
  const session = await page.request.get("/api/auth/get-session");
  expect(await session.json()).toBeNull();

  await page.getByRole("button", { name: "Continue as linker@example.com" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
});
